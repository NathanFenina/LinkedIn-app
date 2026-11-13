import { getServerSupabase } from './supabase'
import { getActiveAccountId } from './account'
import { getChatAttendees, getChatMessages, getChats, getUserProfile, handleInvitation, searchLinkedIn, sendLinkedInInvitation, sendMessage, sendPostComment, startNewChat } from './unipile'
import { checkLimit, guard, logAction, MIN_GAP_SEC, secondsSinceLastSend, type ActionType as LimitType } from './limits'

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
  | 'fb_group' // post d'un groupe Facebook BTP (commenter / ajouter à la main)
  | 'fb_add' // artisan repéré dans un groupe : ajouter en ami (à la main), message après acceptation
  | 'comment_reply' // réponse publique sous un commentaire (meta.social_id, meta.comment_id)
  | 'accept_invite' // accepter une invitation reçue (meta.invitation_id, meta.shared_secret)

// Types envoyés par PLUG (les autres = « Ouvrir » puis « Fait »).
export const SENDABLE: ActionType[] = ['engager_dm', 'engager_invite', 'relance', 'reply', 'comment_reply', 'accept_invite']

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

// Plafond LinkedIn concerné par chaque type d'action envoyée.
function limitType(t: string): LimitType {
  if (t === 'engager_invite') return 'invite'
  if (t === 'comment_reply') return 'comment'
  if (t === 'accept_invite') return 'accept'
  return 'dm'
}

// Après un envoi réussi : libère les actions qui en dépendaient (meta.release_ids,
// status 'waiting' → 'queued'), en tête de file.
async function releaseDependents(db: Db, a: { meta: Record<string, unknown> | null }) {
  const ids = ((a.meta as { release_ids?: string[] } | null)?.release_ids || []).filter(Boolean)
  if (!ids.length) return
  await db.from('plug_actions').update({ status: 'queued', updated_at: '2026-01-01T00:00:00Z' }).in('id', ids).eq('status', 'waiting')
}

export async function sendNextQueued(db: Db, onlyId?: string): Promise<{ sent: number; wait?: boolean; remaining: number; name?: string; error?: string; skipped?: string }> {
  const { count: remaining } = await db.from('plug_actions').select('id', { count: 'exact', head: true }).eq('status', 'queued')
  if (!remaining) return { sent: 0, remaining: 0 }
  if ((await secondsSinceLastSend(db)) < MIN_GAP_SEC) return { sent: 0, wait: true, remaining }
  const acc = await getActiveAccountId()
  // Première action en file dont le plafond du jour n'est pas atteint
  // (un plafond plein, ex. invitations, ne bloque pas les autres types).
  let q = db.from('plug_actions').select('*').eq('status', 'queued')
  if (onlyId) q = q.eq('id', onlyId)
  const { data: cands } = await q.order('updated_at', { ascending: true }).limit(1000)
  type QA = { id: string; type: string; provider_id: string | null; chat_id: string | null; message: string | null; target_id: string | null; tag: string | null; person_name: string | null; created_at: string; meta: Record<string, unknown> | null }
  let a: QA | null = null
  const blocked = new Map<string, string>()
  // Préférence de Nathan : pas de messages privés le matin (avant 14 h, heure de
  // Paris) pour les envois en file automatique. Commentaires, invitations et
  // acceptations partent toute la journée. Un clic « Envoyer » (onlyId) passe.
  const parisHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).find((x) => x.type === 'hour')?.value ?? 0)
  if (!onlyId && parisHour < 14) blocked.set('dm', 'messages privés seulement l’après-midi')
  for (const c of cands || []) {
    const lt = limitType(c.type)
    if (blocked.has(lt)) continue
    const chk = await checkLimit(db, acc, lt)
    if (chk.allowed) { a = c as QA; break }
    blocked.set(lt, chk.reason || 'plafond')
  }
  if (!a) return { sent: 0, wait: true, remaining, error: [...blocked.values()][0] }
  // Garde-fou : si Nathan a déjà écrit à la main dans cette conversation ces
  // dernières heures, on n'envoie pas un second message.
  if (a.chat_id && !['engager_invite', 'comment_reply', 'accept_invite'].includes(a.type)) {
    try {
      const last = ((await getChatMessages(a.chat_id, 3)) as Msg[]).sort((x, y) => String(y.timestamp).localeCompare(String(x.timestamp)))[0]
      if (last && isMine(last) && Date.now() - Date.parse(String(last.timestamp)) < 6 * 3600000 && Date.parse(String(last.timestamp)) > Date.parse(a.created_at)) {
        await db.from('plug_actions').update({ status: 'done', tag: 'Message envoyé', note: 'Déjà envoyé à la main : pas de doublon', updated_at: new Date().toISOString() }).eq('id', a.id)
        return { sent: 0, remaining: remaining - 1, skipped: 'déjà envoyé à la main' }
      }
    } catch { /* lecture impossible : on envoie quand même */ }
  }
  const now = new Date().toISOString()
  const meta = (a.meta || {}) as { social_id?: string; comment_id?: string; invitation_id?: string; shared_secret?: string }
  try {
    if (a.type === 'engager_invite') {
      if (!a.provider_id) throw new Error('provider_id manquant')
      await logAction(db, acc, 'invite')
      // Note d'invitation facultative (ex. « je t'envoie la ressource dès qu'on est connectés »).
      const note = String(a.message || '').trim().slice(0, 300)
      await sendLinkedInInvitation(acc, a.provider_id, note || undefined)
      if (a.target_id) await db.from('outreach_targets').update({ status: 'invited', invited_at: now }).eq('id', a.target_id)
    } else if (a.type === 'comment_reply') {
      const text = String(a.message || '').trim()
      if (!text || !meta.social_id || !meta.comment_id) throw new Error('Réponse : texte, social_id ou comment_id manquant')
      await logAction(db, acc, 'comment')
      await sendPostComment(acc, meta.social_id, text, meta.comment_id)
    } else if (a.type === 'accept_invite') {
      if (!meta.invitation_id) throw new Error('invitation_id manquant')
      await logAction(db, acc, 'accept')
      await handleInvitation(acc, meta.invitation_id, 'accept', meta.shared_secret || null)
    } else {
      const text = String(a.message || '').trim()
      if (!text) throw new Error('Message vide')
      await logAction(db, acc, 'dm')
      let chatId = a.chat_id as string | null
      if (chatId) await sendMessage(chatId, text)
      else if (a.provider_id) {
        const r = (await startNewChat(acc, a.provider_id, text)) as { chat_id?: string; id?: string }
        chatId = r.chat_id || r.id || null
      } else throw new Error('Ni conversation ni provider_id')
      await db.from('plug_actions').update({ chat_id: chatId }).eq('id', a.id)
      if (a.target_id) await db.from('outreach_targets').update({ status: 'msg1_sent', last_sent_at: now, chat_id: chatId, variant: null }).eq('id', a.target_id)
    }
    const tag = a.tag || ({ engager_invite: 'Invitation envoyée', comment_reply: 'Commentaire publié', accept_invite: 'Invitation acceptée' } as Record<string, string>)[a.type] || 'Message envoyé'
    await db.from('plug_actions').update({ status: 'sent', sent_at: now, error: null, tag, updated_at: now }).eq('id', a.id)
    await releaseDependents(db, a)
    return { sent: 1, remaining: remaining - 1, name: a.person_name || undefined }
  } catch (err) {
    await db.from('plug_actions').update({ status: 'error', error: String(err).slice(0, 300), updated_at: now }).eq('id', a.id)
    return { sent: 0, remaining: remaining - 1, error: String(err).slice(0, 300) }
  }
}

// Envoie jusqu'à `max` actions en file dans le même appel, espacées de ~100 s
// (crons Vercel quotidiens : chaque passage vide un peu la file).
export async function drainQueue(db: Db, max = 2): Promise<Array<Awaited<ReturnType<typeof sendNextQueued>>>> {
  const out = []
  for (let i = 0; i < max; i++) {
    const r = await sendNextQueued(db)
    out.push(r)
    if (!r.remaining || r.error) break
    await new Promise((res) => setTimeout(res, (MIN_GAP_SEC + 10 + Math.floor(Math.random() * 20)) * 1000))
  }
  return out
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
  // Invitations automatiques aux engageurs 2e degré : coupables via app_settings
  // (engager_auto_invite = 'false') → la carte attend alors la validation.
  const { data: ai } = await db.from('app_settings').select('value').eq('key', 'engager_auto_invite').maybeSingle()
  const autoInvite = String(ai?.value ?? 'true') !== 'false'
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
    // 2e degré : invitation sans note envoyée automatiquement (choix de Nathan) ;
    // la carte revient avec un message une fois l'invitation acceptée.
    else await upsertAction(db, { ...base, type: 'engager_invite', status: autoInvite ? 'queued' : 'todo', message: null, template_key: 'INV_sans_note', meta: { ...base.meta, sujet: post } })
    added++
  }
  return { added, skipped, checked }
}

// Invitations PLUG acceptées → message personnalisé prêt (1er degré).
// Message après acceptation : deux versions testées en alternance (A/B) —
// ACC_question (où en êtes-vous sur le SEO ?) et ACC_video (3 leviers + vidéo).
async function acceptedMessage(db: Db, seed: string, vars: Record<string, string>): Promise<{ text: string; key: string }> {
  const { data } = await db.from('plug_templates').select('key, body').in('key', ['ACC_question', 'ACC_video']).eq('active', true)
  const tpls = (data || []).sort((a, b) => a.key.localeCompare(b.key))
  if (!tpls.length) return { text: '', key: '' }
  const h = [...seed].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
  const t = tpls[h % tpls.length]
  return { text: fill(t.body, vars).replace(/ « » /g, ' ').replace(/ sur mon post « »/g, ' sur mon post'), key: t.key }
}

// Invitations acceptées → message prêt (1er degré). Couvre les invitations PLUG
// et les invitations « Engageurs » envoyées avant PLUG (outreach_targets invited).
export async function promoteAcceptedInvites(db: Db, limit = 25): Promise<number> {
  const since = new Date(Date.now() - 86400000).toISOString()
  const { data: rows } = await db.from('plug_actions').select('*').eq('type', 'engager_invite').eq('status', 'sent').lt('sent_at', since).limit(limit)
  const { data: camps } = await db.from('outreach_campaigns').select('id').in('name', ENGAGER_CAMPAIGNS)
  const { data: legacy } = await db.from('outreach_targets').select('id, name, headline, company, profile_url, public_identifier, provider_id, chat_id, context, score')
    .in('campaign_id', (camps || []).map((c) => c.id)).eq('status', 'invited').lt('invited_at', since).order('invited_at', { ascending: true }).limit(limit)
  const acc = await getActiveAccountId()
  type Cand = { kind: 'plug' | 'legacy'; row: Record<string, unknown> }
  const cands: Cand[] = [...(rows || []).map((r) => ({ kind: 'plug' as const, row: r })), ...(legacy || []).map((r) => ({ kind: 'legacy' as const, row: r }))]
  let n = 0
  for (const c of cands.slice(0, limit)) {
    const r = c.row
    const providerId = String(r.provider_id || '')
    if (!providerId) continue
    try {
      const g = await guard(db, acc, 'profile_view')
      if (!g.allowed) break
      const p = await getUserProfile(acc, providerId)
      const first = p.is_relationship === true || /FIRST|DISTANCE_1/i.test(p.network_distance || '')
      if (!first) continue
      const targetId = String(c.kind === 'plug' ? r.target_id || '' : r.id)
      const name = String(c.kind === 'plug' ? r.person_name || '' : r.name || '')
      const meta = (c.kind === 'plug' ? (r.meta as Record<string, unknown>) : {}) || {}
      const sujet = String(meta.sujet || (c.kind === 'legacy' ? r.context || '' : '')).slice(0, 80)
      const marque = String((c.kind === 'plug' ? r.company : r.company) || 'votre entreprise')
      // Message prévu à l'avance (ex. ressource promise + offre) sinon modèle A/B.
      const m = typeof meta.after_accept === 'string' && meta.after_accept.trim()
        ? { text: meta.after_accept, key: 'after_accept' }
        : await acceptedMessage(db, providerId, { prenom: firstName(name), sujet, marque })
      await upsertAction(db, {
        type: 'engager_dm', status: meta.auto_send ? 'queued' : 'todo', dedupe_key: `engager-dm:${targetId || providerId}`, target_id: targetId || null,
        person_name: name, headline: (r.headline as string) || null, company: marque,
        profile_url: (r.profile_url as string) || (r.public_identifier ? `https://www.linkedin.com/in/${r.public_identifier}` : `https://www.linkedin.com/in/${providerId}`),
        provider_id: providerId, chat_id: (r.chat_id as string) || null, score: (r.score as number) ?? null,
        title: '✅ Invitation acceptée — message prêt', context: (r.context as string) || null, message: m.text, template_key: m.key || null, meta,
      })
      if (c.kind === 'plug') await db.from('plug_actions').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', r.id as string)
      else await db.from('outreach_targets').update({ status: 'connected', connected_at: new Date().toISOString() }).eq('id', r.id as string)
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
      meta: part === 'missions' ? { source: 'LinkedIn posts' } : {},
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
  const { count: accepted } = await db.from('plug_actions').select('id', { count: 'exact', head: true }).eq('status', 'todo').like('dedupe_key', 'engager-dm:%')
  return { todo, total_todo: Object.values(todo).reduce((s, v) => s + v, 0), queued, sent_week: sentWeek || 0, replies_week: repliesWeek || 0, invitations_acceptees_a_traiter: accepted || 0 }
}

// ---------------- Générateur : offres de missions (job boards) ----------------
// LinkedIn Jobs (sans filtre remote), Free-Work (télétravail 100 % uniquement)
// et Collective.work. Une seule passe Gemini trie et note le tout.

const JOB_KEYWORDS = ['consultant SEO', 'SEO freelance', 'consultant GEO', 'ingénieur IA', 'AI engineer', 'expert IA', 'développeur IA agents']
const BOARD_KEYWORDS = ['SEO', 'GEO', 'IA', 'agent IA']

type JobCand = { source: string; title: string; client: string; url: string; extra: string }

async function boardLinks(url: string, pattern: RegExp, source: string): Promise<JobCand[]> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PLUG-veille/1.0)', 'Accept-Language': 'fr-FR' } })
  if (!res.ok) return []
  const html = await res.text()
  const out: JobCand[] = []
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 40) {
    const href = m[1]
    if (!pattern.test(href)) continue
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    if (text.length < 6) continue
    const abs = href.startsWith('http') ? href : new URL(href, url).toString()
    if (!out.some((o) => o.url === abs)) out.push({ source, title: text.slice(0, 160), client: '', url: abs, extra: '' })
  }
  return out
}

export async function generateJobBoards(db: Db): Promise<{ candidates: number; added: number }> {
  const acc = await getActiveAccountId()
  const cands: JobCand[] = []
  for (const kw of JOB_KEYWORDS) {
    try {
      const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&f_JT=C&f_TPR=r604800&location=France`
      const { items } = await searchLinkedIn<Record<string, unknown>>(acc, { url, limit: 25 } as never)
      for (const it of items) {
        const company = (it.company as Record<string, unknown>)?.name || it.company_name || it.company || ''
        const id = it.id || it.job_id
        const link = String(it.url || it.job_url || it.share_url || (id ? `https://www.linkedin.com/jobs/view/${id}` : ''))
        if (link) cands.push({ source: 'LinkedIn offres', title: String(it.title || ''), client: String(company), url: link, extra: String(it.location || '') })
      }
    } catch { /* mot-clé suivant */ }
  }
  for (const kw of BOARD_KEYWORDS) {
    try { cands.push(...await boardLinks(`https://www.free-work.com/fr/tech-it/jobs?query=${encodeURIComponent(kw)}&contracts=contractor&remote=full`, /\/job-mission\//, 'Free-Work (100 % télétravail)')) } catch { /* suivant */ }
    try { cands.push(...await boardLinks(`https://www.collective.work/jobs/fr?search=${encodeURIComponent(kw)}`, /\/jobs\/fr\/[a-z0-9-]+-[a-z0-9]{4}$/i, 'Collective.work')) } catch { /* suivant */ }
  }
  const uniq = new Map<string, JobCand>()
  for (const c of cands) if (c.url && !uniq.has(c.url)) uniq.set(c.url, c)
  const fresh: JobCand[] = []
  for (const c of uniq.values()) {
    const { data } = await db.from('plug_actions').select('id').eq('url', c.url).maybeSingle()
    if (!data) fresh.push(c)
  }
  if (!fresh.length) return { candidates: uniq.size, added: 0 }
  const list = fresh.slice(0, 80).map((c, i) => `#${i} | ${c.source} | ${c.title} | ${c.client} | ${c.extra}`).join('\n')
  const picked = parseJson<Array<{ i: number; title?: string; client?: string; mode?: string; score?: number; why?: string }>>(await geminiCall(`Tu tries des offres de missions pour Nathan Fenina, consultant SEO/GEO senior, expert Claude Code et automatisation IA. Métiers visés : consultant SEO / SEO-GEO senior, visibilité IA / GEO, automatisation de contenu SEO par IA, ingénieur IA, expert IA (Claude), agents IA. Aucun filtre de TJM. Garde UNIQUEMENT les missions freelance / contrat pertinentes (pas de CDI pur, pas d'annotation de données pour l'IA, jamais Codeur.com). Pour chacune : intitulé court, client si connu, mode (remote / hybride / sur site si indiqué), score /100 vs le profil, 1 phrase de pourquoi. Sois exigeant sur le score : 85+ seulement si la mission combine SEO/GEO ou visibilité IA avec un vrai besoin client ; un poste de développeur IA générique (Python, MLOps, SAP, Copilot…) ne dépasse pas 65 ; la rédaction de contenu ne dépasse pas 55.
Réponds UNIQUEMENT en JSON : [{"i":0,"title":"","client":"","mode":"","score":70,"why":""}]
Offres :
${list}`)) || []
  let added = 0
  for (const k of picked) {
    const c = fresh[k.i]
    if (!c) continue
    const ok = await upsertAction(db, {
      type: 'mission', dedupe_key: `job:${c.url}`, url: c.url, person_name: k.client || c.client || null, headline: c.source,
      title: k.title || c.title, context: [k.mode, c.extra].filter(Boolean).join(' · ') || null, score: k.score ?? null, message: k.why || null,
      meta: { source: c.source },
    })
    if (ok) added++
  }
  return { candidates: uniq.size, added }
}
