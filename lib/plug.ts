import { getServerSupabase } from './supabase'
import { getActiveAccountId } from './account'
import { getChatAttendees, getChatMessages, getChats, getUserProfile, searchLinkedIn, sendLinkedInInvitation, sendMessage, startNewChat } from './unipile'
import { guard, logAction, MIN_GAP_SEC, secondsSinceLastSend } from './limits'

// ---------------------------------------------------------------------------
// PLUG : une file unique d'actions à valider (page /plug).
// Les générateurs remplissent plug_actions (status 'todo'), Nathan modifie,
// supprime, tague ou valide ; « Envoyer » passe l'action en 'queued' et le
// cron /api/cron/plug-send en envoie UNE par appel (espacée, jamais en rafale).
// Rien ne part sans un clic de Nathan.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getServerSupabase>

export type ActionType =
  | 'engager_dm' // engageur 1er degré : message personnalisé
  | 'engager_invite' // engageur 2e degré : invitation sans note
  | 'relance' // mon dernier message sans réponse
  | 'reply' // message reçu sans réponse de ma part
  | 'lk_comment' // post LinkedIn à commenter (à la main)
  | 'x_reply' // post X à commenter (lien d'intention)
  | 'mission' // mission freelance pour postuler (à la main)

// Types envoyés par PLUG (les autres = « Ouvrir » puis « Fait »).
export const SENDABLE: ActionType[] = ['engager_dm', 'engager_invite', 'relance', 'reply']

export const ENGAGER_CAMPAIGNS = ['Engageurs de mes posts', 'Engageurs — mes connexions']

// Personnes que Nathan gère lui-même : jamais remontées en relance.
const MANUAL_ONLY = /pascal cottereau|romain bailleul|rapha[eë]l richard/i

export const ICP = "décideurs (CEO, fondateur, dirigeant, directeur, responsable, head of, CMO) d'entreprises B2B ou e-commerce qui pourraient acheter un accompagnement SEO/GEO (être visible sur Google et cité par ChatGPT, Gemini, Perplexity). Exclure : agences et consultants SEO/marketing, freelances, étudiants, coachs, agences IA concurrentes, personnes sans entreprise."

const REAL_FIGURES = '+320 000 clics/trimestre (B2B tech), +17 % de positions en 6 mois chez les clients, données structurées en 30 min au lieu de 7 jours, 15 mois de Claude Code'

// ---------------- Gemini ----------------

const GEMINI_MODEL = 'gemini-2.5-flash'

export async function geminiCall(prompt: string, opts: { search?: boolean } = {}): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY manquant')
  const body: Record<string, unknown> = { contents: [{ role: 'user', parts: [{ text: prompt }] }] }
  if (opts.search) body.tools = [{ google_search: {} }]
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status} : ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const parts = (data?.candidates?.[0]?.content?.parts || []) as Array<{ text?: string }>
  return parts.map((p) => p.text || '').join('').trim()
}

export function parseJson<T>(raw: string): T | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0)
  if (!starts.length) return null
  const first = Math.min(...starts)
  const closer = cleaned[first] === '[' ? ']' : '}'
  const last = cleaned.lastIndexOf(closer)
  try { return JSON.parse(cleaned.slice(first, last + 1)) as T } catch { return null }
}

// ---------------- Modèles de messages ----------------

export async function getTemplate(db: Db, key: string): Promise<string> {
  const { data } = await db.from('plug_templates').select('body').eq('key', key).maybeSingle()
  return (data?.body as string) || ''
}

export function fill(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m))
}

export function firstName(full: string | null | undefined): string {
  const w = (full || '').replace(/[^\p{L}\s'’-]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!w.length) return ''
  // « DUPONT Jean » : prénom après le nom en capitales.
  const pick = w.length > 1 && w[0] === w[0].toUpperCase() && w[0].length > 2 && w[1] !== w[1].toUpperCase() ? w[1] : w[0]
  return pick.length <= 2 ? pick.toUpperCase() : pick.charAt(0).toUpperCase() + pick.slice(1).toLowerCase()
}

// ---------------- Insertion (dédoublonnée) ----------------

export async function upsertAction(db: Db, a: Record<string, unknown> & { type: ActionType; dedupe_key: string }): Promise<boolean> {
  const { data: exists } = await db.from('plug_actions').select('id').eq('dedupe_key', a.dedupe_key).maybeSingle()
  if (exists) return false
  const { error } = await db.from('plug_actions').insert(a)
  return !error
}

// ---------------- Envoi (UNE action par appel) ----------------

export async function sendNextQueued(db: Db): Promise<{ sent: number; wait?: boolean; remaining: number; name?: string; error?: string }> {
  const { count: remaining } = await db.from('plug_actions').select('id', { count: 'exact', head: true }).eq('status', 'queued')
  if (!remaining) return { sent: 0, remaining: 0 }
  if ((await secondsSinceLastSend(db)) < MIN_GAP_SEC) return { sent: 0, wait: true, remaining }
  const { data: a } = await db.from('plug_actions').select('*').eq('status', 'queued').order('updated_at', { ascending: true }).limit(1).maybeSingle()
  if (!a) return { sent: 0, remaining: 0 }
  const acc = await getActiveAccountId()
  const now = new Date().toISOString()
  try {
    if (a.type === 'engager_invite') {
      const g = await guard(db, acc, 'invite')
      if (!g.allowed) return { sent: 0, wait: true, remaining, error: g.reason }
      if (!a.provider_id) throw new Error('provider_id manquant')
      await sendLinkedInInvitation(acc, a.provider_id)
      if (a.target_id) await db.from('outreach_targets').update({ status: 'invited', invited_at: now }).eq('id', a.target_id)
    } else {
      const text = String(a.message || '').trim()
      if (!text) throw new Error('Message vide')
      const g = await guard(db, acc, 'dm')
      if (!g.allowed) return { sent: 0, wait: true, remaining, error: g.reason }
      let chatId = a.chat_id as string | null
      if (chatId) await sendMessage(chatId, text)
      else if (a.provider_id) {
        const r = (await startNewChat(acc, a.provider_id, text)) as { chat_id?: string; id?: string }
        chatId = r.chat_id || r.id || null
      } else throw new Error('Ni conversation ni provider_id')
      await logAction(db, acc, 'dm')
      await db.from('plug_actions').update({ chat_id: chatId }).eq('id', a.id)
      if (a.target_id) await db.from('outreach_targets').update({ status: 'msg1_sent', last_sent_at: now, chat_id: chatId, variant: null }).eq('id', a.target_id)
    }
    await db.from('plug_actions').update({ status: 'sent', sent_at: now, error: null, updated_at: now }).eq('id', a.id)
    return { sent: 1, remaining: remaining - 1, name: a.person_name || undefined }
  } catch (err) {
    await db.from('plug_actions').update({ status: 'error', error: String(err).slice(0, 300), updated_at: now }).eq('id', a.id)
    return { sent: 0, remaining: remaining - 1, error: String(err).slice(0, 300) }
  }
}

// ---------------- Générateur : engageurs ----------------

type EngagerResearch = {
  in_icp: boolean
  reason?: string
  company?: string
  site?: string
  question?: string
  brands?: string[]
  brand_cited?: boolean
}

async function researchEngager(name: string, headline: string, post: string): Promise<EngagerResearch | null> {
  const prompt = `Tu aides Nathan Fenina, consultant et agence SEO/GEO, à préparer un message LinkedIn.
Personne : ${name} — titre LinkedIn : « ${headline} » — elle a commenté son post « ${post} ».
1. Est-elle dans la cible ? Cible : ${ICP}
   Juge UNIQUEMENT sur son titre et son entreprise : avoir commenté un post de Nathan sur le SEO ou l'IA ne fait PAS d'elle un consultant SEO.
2. Si oui : trouve son entreprise actuelle et le site officiel (recherche Google).
3. Formule UNE question en français qu'un client potentiel de cette entreprise poserait à ChatGPT pour trouver ce type d'offre (ex. « quel logiciel de PPM pour une DSI ? »).
4. Fais la recherche et relève les 2 à 4 marques qui ressortent en premier. Indique si la marque de la personne en fait partie.
Réponds UNIQUEMENT en JSON : {"in_icp":true|false,"reason":"1 phrase","company":"","site":"","question":"","brands":["",""],"brand_cited":true|false}`
  const raw = await geminiCall(prompt, { search: true })
  return parseJson<EngagerResearch>(raw)
}

export async function generateEngagers(db: Db, limit = 8): Promise<{ added: number; skipped: number; checked: number }> {
  const { data: camps } = await db.from('outreach_campaigns').select('id').in('name', ENGAGER_CAMPAIGNS)
  const ids = (camps || []).map((c) => c.id)
  const { data: targets } = await db.from('outreach_targets').select('id, name, headline, company, profile_url, public_identifier, provider_id, chat_id, connected_at, context, score, status')
    .in('campaign_id', ids).in('status', ['sourced', 'approved', 'connected']).order('score', { ascending: false }).limit(200)
  const { data: done } = await db.from('plug_actions').select('target_id').not('target_id', 'is', null)
  const seen = new Set((done || []).map((d) => d.target_id))
  const tplC = await getTemplate(db, 'B_concurrent')
  const tplM = await getTemplate(db, 'B_marque_citee')
  let added = 0, skipped = 0, checked = 0
  for (const t of targets || []) {
    if (seen.has(t.id) || !t.provider_id) continue
    if (checked >= limit) break
    checked++
    const profile = t.profile_url || `https://www.linkedin.com/in/${t.public_identifier || t.provider_id}`
    const post = String(t.context || '').slice(0, 120)
    let r: EngagerResearch | null = null
    try { r = await researchEngager(t.name || '', t.headline || '', post) } catch { r = null }
    if (!r) continue
    if (!r.in_icp) {
      await db.from('outreach_targets').update({ status: 'skipped', error: `Hors cible PLUG : ${r.reason || ''}`.slice(0, 200) }).eq('id', t.id)
      await upsertAction(db, { type: 'engager_dm', dedupe_key: `engager:${t.id}`, target_id: t.id, status: 'dismissed', person_name: t.name, headline: t.headline, profile_url: profile, provider_id: t.provider_id, context: `Hors cible : ${r.reason || ''}` })
      skipped++
      continue
    }
    const brands = (r.brands || []).filter(Boolean)
    const marque = r.company || t.company || 'votre marque'
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9à-ÿ ]/g, ' ').replace(/\b(france|sas|group|groupe|software|consulting)\b/g, ' ').replace(/\s+/g, ' ').trim()
    const own = norm(marque)
    const isOwn = (b: string) => { const nb = norm(b); return !!own && !!nb && (nb.includes(own) || own.includes(nb)) }
    const concurrents = brands.filter((b) => !isOwn(b)).slice(0, 2).join(' et ') || 'vos concurrents'
    const vars = { prenom: firstName(t.name), question: r.question || '', concurrents, marque }
    const firstDegree = !!t.connected_at
    const message = fill(r.brand_cited ? tplM : tplC, vars)
    const base = {
      dedupe_key: `engager:${t.id}`, target_id: t.id, person_name: t.name, headline: t.headline, company: marque,
      profile_url: profile, provider_id: t.provider_id, chat_id: t.chat_id, score: t.score,
      title: post ? `A commenté « ${post} »` : null,
      context: `Question : ${r.question || '?'}\nMarques qui ressortent : ${brands.join(', ') || '?'}${r.site ? `\nSite : ${r.site}` : ''}\n⚠️ Vérifie dans ChatGPT avant d'envoyer.`,
      template_key: r.brand_cited ? 'B_marque_citee' : 'B_concurrent',
      meta: { question: r.question, brands, site: r.site, brand_cited: !!r.brand_cited },
    }
    if (firstDegree) await upsertAction(db, { ...base, type: 'engager_dm', message })
    else await upsertAction(db, { ...base, type: 'engager_invite', message: null, template_key: 'INV_sans_note', meta: { ...base.meta, later_message: `Merci d'avoir accepté mon invitation ! ${message}` } })
    added++
  }
  return { added, skipped, checked }
}

// Invitations PLUG acceptées → message personnalisé prêt (1er degré).
export async function promoteAcceptedInvites(db: Db, limit = 10): Promise<number> {
  const since = new Date(Date.now() - 86400000).toISOString()
  const { data: rows } = await db.from('plug_actions').select('*').eq('type', 'engager_invite').eq('status', 'sent').lt('sent_at', since).limit(limit)
  if (!rows?.length) return 0
  const acc = await getActiveAccountId()
  let n = 0
  for (const a of rows) {
    try {
      const g = await guard(db, acc, 'profile_view')
      if (!g.allowed) break
      const p = await getUserProfile(acc, a.provider_id)
      const first = p.is_relationship === true || /FIRST|DISTANCE_1/i.test(p.network_distance || '')
      if (!first) continue
      const later = String((a.meta as Record<string, unknown>)?.later_message || '')
      await upsertAction(db, { ...stripId(a), type: 'engager_dm', status: 'todo', dedupe_key: `engager-dm:${a.target_id || a.provider_id}`, message: later, template_key: (a.meta as Record<string, unknown>)?.brand_cited ? 'B_marque_citee' : 'B_concurrent', sent_at: null })
      await db.from('plug_actions').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', a.id)
      n++
    } catch { /* profil illisible : on réessaiera */ }
  }
  return n
}

function stripId(a: Record<string, unknown>) {
  const rest = { ...a }
  delete rest.id
  delete rest.created_at
  delete rest.updated_at
  return rest
}

// ---------------- Générateur : relances & réponses à traiter ----------------

type Msg = { text?: string; is_sender?: number | boolean; timestamp?: string }
const isMine = (m: Msg) => m.is_sender === 1 || m.is_sender === true

export async function generateConversations(db: Db, opts: { days?: number; maxChats?: number } = {}): Promise<{ scanned: number; relances: number; replies: number; replied_marked: number }> {
  const acc = await getActiveAccountId()
  const horizon = Date.now() - (opts.days ?? 30) * 86400000
  const chats: Array<{ id: string; attendee_provider_id: string; timestamp: string }> = []
  let cursor: string | undefined
  for (let page = 0; page < 5; page++) {
    const { items, cursor: next } = await getChats(acc, 100, cursor)
    for (const c of items) if (Date.parse(c.timestamp) >= horizon) chats.push(c)
    const oldest = items[items.length - 1]
    if (!next || !items.length || (oldest && Date.parse(oldest.timestamp) < horizon)) break
    cursor = next
  }
  const relTpl = await getTemplate(db, 'C_relance')
  let relances = 0, replies = 0, replied_marked = 0, scanned = 0
  for (const c of chats.slice(0, opts.maxChats ?? 120)) {
    scanned++
    const msgs = ((await getChatMessages(c.id, 12)) as Msg[]).filter((m) => m.timestamp)
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    if (!msgs.length) continue
    const last = msgs[msgs.length - 1]
    const theirs = msgs.filter((m) => !isMine(m))
    // Réponse reçue après un envoi PLUG → marque l'action comme « répondu ».
    const lastTheirs = theirs[theirs.length - 1]
    if (lastTheirs) {
      const { data: sentActs } = await db.from('plug_actions').select('id, sent_at').eq('chat_id', c.id).eq('status', 'sent').is('replied_at', null)
      for (const s of sentActs || []) {
        if (s.sent_at && String(lastTheirs.timestamp) > String(s.sent_at)) {
          await db.from('plug_actions').update({ replied_at: lastTheirs.timestamp, reply_text: (lastTheirs.text || '').slice(0, 500) }).eq('id', s.id)
          replied_marked++
        }
      }
    }
    if (!theirs.length) continue // jamais répondu (ex. message de bienvenue) → pas une conversation chaude
    const ageDays = (Date.now() - Date.parse(String(last.timestamp))) / 86400000
    const lastMine = isMine(last)
    if (lastMine && (ageDays < 3 || ageDays > 21)) continue
    if (!lastMine && ageDays > 14) continue
    const type: ActionType = lastMine ? 'relance' : 'reply'
    const dedupe = `${type}:${c.id}:${String(last.timestamp).slice(0, 16)}`
    const { data: exists } = await db.from('plug_actions').select('id').eq('dedupe_key', dedupe).maybeSingle()
    if (exists) continue
    // Conversation écartée récemment par Nathan → on ne la remonte pas.
    const { data: dismissed } = await db.from('plug_actions').select('id').eq('chat_id', c.id).eq('status', 'dismissed').gte('updated_at', new Date(Date.now() - 30 * 86400000).toISOString()).limit(1)
    if (dismissed?.length) continue
    let name = '', headline = '', profile = ''
    try {
      const att = ((await getChatAttendees(c.id)) as unknown as Array<Record<string, unknown>>).find((x) => !x.is_self) || {}
      name = String(att.name || '')
      headline = String((att.specifics as Record<string, unknown>)?.occupation || att.occupation || '')
      profile = String(att.profile_url || (att.public_identifier ? `https://www.linkedin.com/in/${att.public_identifier}` : ''))
    } catch { /* pas bloquant */ }
    if (MANUAL_ONLY.test(name)) continue
    const transcript = msgs.slice(-8).map((m) => `${isMine(m) ? 'NATHAN' : 'LUI/ELLE'} (${String(m.timestamp).slice(0, 10)}) : ${(m.text || '').slice(0, 400)}`).join('\n')
    let message = ''
    try {
      message = await geminiCall(`Tu es Nathan Fenina (consultant et agence SEO/GEO, expert Claude Code). Rédige ${lastMine ? 'UNE relance courte' : 'UNE réponse courte'} à envoyer sur LinkedIn à ${name || 'cette personne'}.
Règles : français, garde le tutoiement ou le vouvoiement déjà utilisé dans la conversation, 1 à 3 phrases, naturel, sans flatterie, sans lien calendar.app.google. Lien de rendez-vous si utile : https://decupler.com/rendez-vous/. N'invente aucun chiffre ; chiffres autorisés : ${REAL_FIGURES}.
${lastMine ? `Inspire-toi de ce modèle de relance : « ${relTpl} ».` : 'Réponds précisément à son dernier message et propose la suite logique (ressource, échange de 20 min, question).'}
Conversation (la plus récente en bas) :
${transcript}
Renvoie UNIQUEMENT le texte du message.`)
    } catch { message = lastMine ? fill(relTpl, { prenom: firstName(name) }) : '' }
    await upsertAction(db, {
      type, dedupe_key: dedupe, chat_id: c.id, provider_id: c.attendee_provider_id, person_name: name || null, headline: headline || null,
      profile_url: profile || null,
      title: lastMine ? `Sans réponse depuis ${Math.round(ageDays)} j` : `T'a écrit il y a ${Math.round(ageDays)} j`,
      context: transcript.split('\n').slice(-4).join('\n'), message: message.replace(/^["«\s]+|["»\s]+$/g, ''),
      template_key: lastMine ? 'C_relance' : null,
    })
    if (lastMine) relances++
    else replies++
  }
  return { scanned, relances, replies, replied_marked }
}

// ---------------- Générateur : posts X à commenter ----------------

export async function generateXReplies(db: Db, limit = 10): Promise<number> {
  const { data: rows } = await db.from('x_reply_targets').select('*').eq('status', 'todo').gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('created_at', { ascending: false }).limit(40)
  let n = 0
  for (const r of rows || []) {
    if (n >= limit) break
    const draft = ((r.drafts as string[]) || [])[0] || ''
    const ok = await upsertAction(db, {
      type: 'x_reply', dedupe_key: `x:${r.tweet_id}`, person_name: `@${r.author_username}`, headline: r.author_followers ? `${r.author_followers} abonnés` : null,
      url: `https://x.com/${r.author_username}/status/${r.tweet_id}`, context: String(r.text || '').slice(0, 400), message: draft,
      meta: { tweet_id: r.tweet_id },
    })
    if (ok) n++
  }
  return n
}

// ---------------- Générateur : missions & posts LinkedIn à commenter ----------------

const MISSION_QUERIES = ['mission freelance SEO', 'recherche un freelance SEO', 'freelance GEO', 'consultant GEO mission', 'mission freelance ingénieur IA', 'freelance agents IA mission', 'freelance automatisation IA mission']
const COMMENT_QUERIES = ['GEO SEO', 'Claude Code', 'AI Overviews', 'SEO IA', 'agents IA marketing', 'référencement ChatGPT']

type LkPost = { text?: string; share_url?: string; social_id?: string; parsed_datetime?: string; date?: string; reaction_counter?: number; comment_counter?: number; author?: { name?: string; headline?: string; public_identifier?: string; is_company?: boolean } | string }

async function searchPosts(acc: string, q: string, period: 'past-24h' | 'past-week'): Promise<LkPost[]> {
  const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}&datePosted=%22${period}%22&sortBy=%22date_posted%22`
  const { items } = await searchLinkedIn<LkPost>(acc, { url, limit: 50 } as never)
  return items
}

export async function generateLinkedInPosts(db: Db, part: 'missions' | 'comments'): Promise<number> {
  const acc = await getActiveAccountId()
  const queries = part === 'missions' ? MISSION_QUERIES : COMMENT_QUERIES
  const pool: LkPost[] = []
  for (const q of queries) {
    try { pool.push(...(await searchPosts(acc, q, part === 'missions' ? 'past-week' : 'past-week'))) } catch { /* requête suivante */ }
  }
  const uniq = new Map<string, LkPost>()
  for (const p of pool) if (p.share_url && !uniq.has(p.share_url)) uniq.set(p.share_url, p)
  const fresh: LkPost[] = []
  for (const p of uniq.values()) {
    const { data } = await db.from('plug_actions').select('id').eq('url', p.share_url).maybeSingle()
    const author = typeof p.author === 'object' ? p.author : undefined
    if (!data && !/nathan fenina/i.test(author?.name || '')) fresh.push(p)
  }
  if (!fresh.length) return 0
  const list = fresh.slice(0, 30).map((p, i) => {
    const a = typeof p.author === 'object' ? p.author : undefined
    return `#${i} | ${a?.name || '?'} (${(a?.headline || '').slice(0, 80)}) | ${p.parsed_datetime || p.date || ''} | ${p.reaction_counter || 0} réactions, ${p.comment_counter || 0} commentaires\n${(p.text || '').slice(0, 600).replace(/\n+/g, ' ')}`
  }).join('\n\n')
  const prompt = part === 'missions'
    ? `Tu tries des posts LinkedIn pour Nathan Fenina, consultant SEO/GEO senior, expert Claude Code et automatisation IA (aucun filtre de TJM). Garde UNIQUEMENT les posts qui expriment un VRAI besoin client de freelance ou de prestataire (SEO, GEO, visibilité IA, ingénieur/expert IA, agents IA, automatisation). Exclus : freelances qui se vendent, « open to work », CDI, formations, autopromotion, Codeur.com.
Pour chaque post gardé : score /100 vs le profil de Nathan et 1 phrase de pourquoi.
Réponds UNIQUEMENT en JSON : [{"i":0,"title":"intitulé court de la mission","score":80,"why":"..."}]
Posts :
${list}`
    : `Tu choisis des posts LinkedIn à commenter pour la visibilité de Nathan Fenina (consultant et agence SEO/GEO, expert Claude Code). Garde 8 posts maximum, écrits par des créateurs ou décideurs FRANCOPHONES, sur SEO, GEO, IA marketing, Claude Code ou agents IA, avec le meilleur engagement. Exclus offres d'emploi, autopromotion creuse, posts de Nathan.
Pour chacun : résumé en 1 phrase et un commentaire de 1 à 3 phrases, franc, qui apporte un vrai point de vue, sans flatterie. Chiffres autorisés seulement s'ils sont pertinents : ${REAL_FIGURES}. N'invente aucun autre chiffre.
Réponds UNIQUEMENT en JSON : [{"i":0,"summary":"...","comment":"..."}]
Posts :
${list}`
  const picked = parseJson<Array<{ i: number; title?: string; score?: number; why?: string; summary?: string; comment?: string }>>(await geminiCall(prompt)) || []
  let n = 0
  for (const k of picked) {
    const p = fresh[k.i]
    if (!p?.share_url) continue
    const a = typeof p.author === 'object' ? p.author : undefined
    const ok = await upsertAction(db, {
      type: part === 'missions' ? 'mission' : 'lk_comment', dedupe_key: `${part}:${p.share_url}`, url: p.share_url,
      person_name: a?.name || null, headline: a?.headline || null,
      profile_url: a?.public_identifier ? `https://www.linkedin.com/in/${a.public_identifier}` : null,
      title: part === 'missions' ? k.title || 'Mission' : k.summary || null,
      context: (p.text || '').slice(0, 700), score: part === 'missions' ? k.score ?? null : p.reaction_counter ?? null,
      message: part === 'missions' ? k.why || null : k.comment || null,
    })
    if (ok) n++
  }
  return n
}

// ---------------- Résumé (notifications) ----------------

export async function summary(db: Db) {
  const { data } = await db.from('plug_actions').select('type, status')
  const todo: Record<string, number> = {}
  let queued = 0
  for (const r of data || []) {
    if (r.status === 'todo') todo[r.type] = (todo[r.type] || 0) + 1
    if (r.status === 'queued') queued++
  }
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const { count: sentWeek } = await db.from('plug_actions').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', weekAgo)
  const { count: repliesWeek } = await db.from('plug_actions').select('id', { count: 'exact', head: true }).gte('replied_at', weekAgo)
  return { todo, total_todo: Object.values(todo).reduce((s, v) => s + v, 0), queued, sent_week: sentWeek || 0, replies_week: repliesWeek || 0 }
}
