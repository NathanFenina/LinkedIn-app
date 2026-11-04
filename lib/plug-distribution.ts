import { getServerSupabase } from './supabase'
import { geminiCall, parseJson } from './plug'

// ---------------------------------------------------------------------------
// PLUG Distribution : un post n'a pas le même format partout.
//   format   : texte | image | carrousel | video
//   statuts  : idee → script → a_tourner → monte → draft → scheduled → published (ou error)
//   réseaux  : suggérés selon le format (une vidéo va en Reel/Short, un texte en thread…)
//   variants : un texte adapté par réseau, généré depuis le texte LinkedIn validé, puis relu
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getServerSupabase>

export const FORMATS = ['texte', 'image', 'carrousel', 'video'] as const
export type Format = (typeof FORMATS)[number]

export const STATUSES = [
  { key: 'idee', label: 'Idée' },
  { key: 'script', label: 'Script' },
  { key: 'a_tourner', label: 'À tourner' },
  { key: 'monte', label: 'Monté' },
  { key: 'draft', label: 'Brouillon' },
  { key: 'scheduled', label: 'Planifié' },
  { key: 'published', label: 'Publié' },
  { key: 'error', label: 'Erreur' },
] as const
export const STATUS_KEYS = STATUSES.map((s) => s.key) as string[]

// Réseaux conseillés par format. Instagram et TikTok ne prennent pas de texte seul.
export const NETWORKS_BY_FORMAT: Record<Format, string[]> = {
  video: ['linkedin', 'instagram', 'facebook', 'youtube', 'tiktok', 'x'],
  image: ['linkedin', 'instagram', 'facebook', 'x'],
  carrousel: ['linkedin', 'instagram', 'facebook'],
  texte: ['linkedin', 'x', 'facebook', 'substack'],
}

// Règles d'adaptation données à Gemini, réseau par réseau.
const RULES: Record<string, string> = {
  x: "X : même texte, resserré si possible. Le découpage en thread est automatique : ne numérote pas, n'écris pas « thread », pas de hashtag.",
  instagram: "Instagram (légende) : 2 200 caractères maximum. Garde le texte et sa structure, raccourcis seulement si nécessaire (l'accroche en premier), puis 5 hashtags pertinents en français à la fin.",
  facebook: "Facebook (page) : même texte que LinkedIn, ton un peu plus conversationnel si besoin.",
  facebook_profil: "Facebook (profil perso de Nathan) : même texte que LinkedIn, ton plus personnel si besoin.",
  youtube: "YouTube : première ligne = titre de 100 caractères maximum, sans emoji en début ; ligne vide ; description de 2 à 4 phrases ; 3 hashtags.",
  tiktok: 'TikTok : légende de 150 caractères maximum, accroche + 3 hashtags.',
  substack: 'Substack (Note) : 300 caractères maximum, l\'idée la plus forte du post, avec sa voix, pas de hashtag.',
}
// Appel à l'action : seulement s'il existe déjà dans le post (jamais inventé).
const FORMAT = "Mise en forme : une ligne vide entre chaque paragraphe, aucune ligne vide entre les puces d'une liste (→, -, ☐), jamais de markdown (pas de **, de # ni de liens entre crochets), emojis seulement s'il y en a dans l'original."
const CTA = "Appel à l'action : uniquement si le post d'origine en a un. Un « commente … » (qui ne marche que sur LinkedIn) devient « Réponds « MOT » » sur X et « Écris-moi « MOT » en message privé » sur Instagram et Facebook. Sinon, n'en ajoute AUCUN et ne promets rien (ressource, pistes, guide) que le texte ne contient pas."

export function suggestNetworks(format: string, hasImage: boolean): string[] {
  const nets = NETWORKS_BY_FORMAT[(FORMATS as readonly string[]).includes(format) ? (format as Format) : 'texte']
  return format === 'texte' && hasImage ? [...nets, 'instagram'] : nets
}

// Génère les variantes pour les réseaux du post (LinkedIn garde le texte d'origine).
export async function generateVariants(db: Db, id: string): Promise<Record<string, string>> {
  const { data: p, error } = await db.from('plug_posts').select('body, format, networks, variants').eq('id', id).single()
  if (error || !p) throw new Error('Post introuvable')
  const targets = ((p.networks as string[]) || []).filter((n) => n !== 'linkedin' && RULES[n])
  if (!targets.length) return (p.variants as Record<string, string>) || {}
  const raw = await geminiCall(`Tu adaptes un post LinkedIn de Nathan Fenina (agence SEO/GEO Décupler) pour d'autres réseaux.
Format du post : ${p.format}. Change le MOINS possible : même voix, même personne grammaticale (si le post dit « tu », garde « tu »), même structure, mêmes phrases quand elles conviennent déjà au réseau. Tu adaptes seulement la longueur et l'appel à l'action. N'ajoute JAMAIS de morale, de conclusion ni d'appel à l'action si le post d'origine n'en a pas : la chute reste la dernière phrase. Tutoiement, phrases courtes, zéro jargon corporate, aucun chiffre inventé ni ajouté.
Règles par réseau :
${targets.map((n) => `- ${RULES[n]}`).join('\n')}
${FORMAT}
${CTA}
Réponds UNIQUEMENT en JSON : {${targets.map((n) => `"${n}":"..."`).join(',')}}
Post LinkedIn :
${p.body}`)
  const out = parseJson<Record<string, string>>(raw)
  if (!out) throw new Error('Réponse Gemini illisible')
  const variants = { ...((p.variants as Record<string, string>) || {}) }
  for (const n of targets) if (typeof out[n] === 'string' && out[n].trim()) variants[n] = out[n].trim()
  await db.from('plug_posts').update({ variants, updated_at: new Date().toISOString() }).eq('id', id)
  return variants
}
