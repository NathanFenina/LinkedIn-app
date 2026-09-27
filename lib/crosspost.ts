import { getServerSupabase } from '@/lib/supabase'
import { unipileFetch, getOwnProfile, listUnipileAccounts, getUserPostsFull, createPost } from '@/lib/unipile'

// Cross-post : LinkedIn → Instagram (Unipile) + Facebook (presse-papier en v1).
// Détection par cron (Unipile n'a pas de webhook "nouveau post"), génération
// des variantes via l'API Claude (touche légère : le texte reste quasi
// identique), validation manuelle dans /cross-post, jamais de publication
// automatique.

type Db = ReturnType<typeof getServerSupabase>

export interface Variants { instagram: string; facebook: string }

export async function getSetting(db: Db, key: string): Promise<string> {
  const { data } = await db.from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as string) || ''
}
export async function setSetting(db: Db, key: string, value: string) {
  await db.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
}

// Compte LinkedIn source : réglage explicite, sinon le compte par défaut de l'app.
export async function sourceLinkedInAccount(db: Db): Promise<string> {
  const chosen = await getSetting(db, 'crosspost_linkedin_account_id')
  if (chosen) return chosen
  const { data } = await db.from('linkedin_accounts').select('unipile_account_id').order('is_default', { ascending: false }).limit(1).maybeSingle()
  return (data?.unipile_account_id as string) || ''
}

// provider_id (ACoAA…) du propriétaire du compte, mémorisé.
async function ownerMemberId(db: Db, accountId: string): Promise<string> {
  const key = `crosspost_member_id:${accountId}`
  const cached = await getSetting(db, key)
  if (cached) return cached
  const me = await getOwnProfile(accountId)
  const id = me.provider_id || ''
  if (id) await setSetting(db, key, id)
  return id
}

// ---- Génération (API Claude) — touche légère ----
const CLAUDE_MODEL = process.env.CROSSPOST_CLAUDE_MODEL || 'claude-sonnet-5'

export async function generateVariants(sourceText: string, hasImage: boolean): Promise<{ variants: Variants; note: string }> {
  const fallback: Variants = { instagram: sourceText.slice(0, 2200), facebook: sourceText }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { variants: fallback, note: 'ANTHROPIC_API_KEY absente : variantes = texte d’origine' }
  const prompt = `Tu adaptes un post LinkedIn pour Instagram et Facebook. CONSIGNE PRINCIPALE : rester au plus près du texte d'origine — même ton, mêmes phrases, mêmes retours à la ligne. Tu ne réécris pas, tu ajustes à la marge.

INSTAGRAM : garde le texte tel quel (coupe seulement si > 2 000 caractères, en gardant le sens), supprime les mentions LinkedIn (@) et les liens http (Instagram ne les rend pas cliquables : remplace par "lien en bio" si un lien était essentiel), termine par une ligne vide puis 3 à 5 hashtags pertinents en français. Pas d'emoji ajouté si le texte d'origine n'en a pas.${hasImage ? '' : ' Le post n’a pas d’image.'}
FACEBOOK : texte identique à l'origine, mentions LinkedIn (@) retirées, liens conservés.

Réponds UNIQUEMENT avec ce JSON, sans markdown : {"instagram": "...", "facebook": "..."}

TEXTE D'ORIGINE :
"""
${sourceText}
"""`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) return { variants: fallback, note: `Claude ${res.status} : variantes = texte d’origine` }
    const data = await res.json()
    const text: string = (data.content || []).map((c: { text?: string }) => c.text || '').join('')
    const first = text.indexOf('{'), last = text.lastIndexOf('}')
    const parsed = JSON.parse(text.slice(first, last + 1)) as Partial<Variants>
    return {
      variants: {
        instagram: (parsed.instagram || fallback.instagram).slice(0, 2200),
        facebook: parsed.facebook || fallback.facebook,
      },
      note: '',
    }
  } catch (err) {
    return { variants: fallback, note: `Génération échouée (${String(err).slice(0, 80)}) : variantes = texte d’origine` }
  }
}

// ---- Détection ----
export async function detectNewPosts(db: Db, opts: { limit?: number; generate?: boolean } = {}): Promise<{ scanned: number; added: number; account: string; error?: string }> {
  const accountId = await sourceLinkedInAccount(db)
  if (!accountId) return { scanned: 0, added: 0, account: '', error: 'Aucun compte LinkedIn source' }
  const me = await ownerMemberId(db, accountId)
  if (!me) return { scanned: 0, added: 0, account: accountId, error: 'Impossible de lire le profil du compte' }

  const posts = await getUserPostsFull(accountId, me, opts.limit ?? 10)
  const ids = posts.map((p) => p.id).filter(Boolean)
  const { data: known } = await db.from('cross_posts').select('linkedin_post_id').eq('source_account_id', accountId).in('linkedin_post_id', ids)
  const seen = new Set((known || []).map((k) => k.linkedin_post_id as string))

  // Première détection : on mémorise l'historique sans le proposer (sinon 10
  // vieux posts remonteraient d'un coup). Réglage "amorcé" par compte.
  const primedKey = `crosspost_primed:${accountId}`
  const primed = await getSetting(db, primedKey)

  let added = 0
  for (const p of posts) {
    if (!p.id || seen.has(p.id)) continue
    if (p.is_repost) continue // on ne republie pas les reposts
    const images = p.images
    const skipAsHistory = !primed
    let variants: Variants = { instagram: p.text.slice(0, 2200), facebook: p.text }
    let note = ''
    if (!skipAsHistory && opts.generate !== false && p.text.trim()) {
      const g = await generateVariants(p.text, images.length > 0)
      variants = g.variants; note = g.note
    }
    const { error } = await db.from('cross_posts').insert({
      source_account_id: accountId,
      linkedin_post_id: p.id,
      social_id: p.social_id || null,
      share_url: p.share_url || null,
      source_text: p.text,
      source_images: images,
      posted_at: p.posted_at,
      variants,
      generated_at: skipAsHistory ? null : new Date().toISOString(),
      generation_note: skipAsHistory ? 'historique (avant activation)' : note || null,
      ig_status: skipAsHistory ? 'skipped' : 'pending',
      fb_status: skipAsHistory ? 'skipped' : 'pending',
    })
    if (!error) added++
  }
  if (!primed) await setSetting(db, primedKey, new Date().toISOString())
  return { scanned: posts.length, added, account: accountId }
}

// ---- Publication Instagram ----
export async function publishToInstagram(db: Db, id: string, text: string): Promise<{ post_id: string | null }> {
  const igAccount = await getSetting(db, 'crosspost_instagram_account_id')
  if (!igAccount) throw new Error('Aucun compte Instagram choisi (réglages de la page Cross-post)')
  const { data: row } = await db.from('cross_posts').select('*').eq('id', id).maybeSingle()
  if (!row) throw new Error('Post introuvable')
  const images = (row.source_images as string[]) || []
  if (!images.length) throw new Error('Instagram exige au moins une image : ce post LinkedIn n’en a pas')
  const res = await createPost(igAccount, text, images.slice(0, 10))
  await db.from('cross_posts').update({ ig_status: 'published', ig_post_id: res.post_id, ig_published_at: new Date().toISOString(), ig_error: null, updated_at: new Date().toISOString() }).eq('id', id)
  return { post_id: res.post_id }
}

export { listUnipileAccounts, unipileFetch }
