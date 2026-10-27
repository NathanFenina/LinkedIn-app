import crypto from 'crypto'
import { getServerSupabase } from '@/lib/supabase'
import { getSetting, setSetting, sourceLinkedInAccount, claudeKey } from '@/lib/crosspost'
import { getOwnProfile, unipileFetch } from '@/lib/unipile'
import { geminiText } from '@/lib/gemini'

// X (Twitter) : connexion OAuth 2.0 PKCE, republication des posts LinkedIn
// (nouveaux + archive), validation manuelle, publication par le cron aux
// créneaux. Réponses aux comptes cibles : PAS via l'API (X l'interdit depuis
// le 23/02/2026 sauf si l'auteur nous mentionne) → brouillons + bouton manuel.

type Db = ReturnType<typeof getServerSupabase>

export const X_REDIRECT_URI = process.env.X_REDIRECT_URI || 'https://linked-in-app-black.vercel.app/api/x/callback'
const SCOPES = 'tweet.read tweet.write users.read offline.access media.write'
const API = 'https://api.x.com/2'

// Tarifs pay-per-use (réglables : X les a changés deux fois en 2026).
export async function xPrices(db: Db) {
  const raw = await getSetting(db, 'x_prices')
  const def = { post: 0.015, post_link: 0.2, read: 0.005 }
  try { return { ...def, ...(raw ? JSON.parse(raw) : {}) } } catch { return def }
}

export interface XSettings { max_per_day: number; monthly_cap_usd: number; premium: boolean; quotes_per_day: number; mention_replies_per_day: number }
export async function xSettings(db: Db): Promise<XSettings> {
  const raw = await getSetting(db, 'x_settings')
  // quotes_per_day = 0 : X refuse aussi les citations (403 « only quote posts where you are mentioned »), testé le 14/10/2026.
  const def: XSettings = { max_per_day: 2, monthly_cap_usd: 20, premium: false, quotes_per_day: 0, mention_replies_per_day: 10 }
  try { return { ...def, ...(raw ? JSON.parse(raw) : {}) } } catch { return def }
}

// ---- OAuth ----
const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function buildAuthorizeUrl(db: Db): Promise<string> {
  const clientId = process.env.X_CLIENT_ID
  if (!clientId) throw new Error('X_CLIENT_ID absent sur Vercel')
  const verifier = b64url(crypto.randomBytes(48))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(16))
  await setSetting(db, 'x_oauth_pending', JSON.stringify({ state, verifier, at: Date.now() }))
  const p = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: X_REDIRECT_URI, scope: SCOPES,
    state, code_challenge: challenge, code_challenge_method: 'S256',
  })
  return `https://x.com/i/oauth2/authorize?${p.toString()}`
}

interface Tokens { access_token: string; refresh_token?: string; expires_at: number; user_id?: string; username?: string }

async function tokenRequest(body: URLSearchParams) {
  const id = process.env.X_CLIENT_ID || '', secret = process.env.X_CLIENT_SECRET || ''
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`X token ${res.status} : ${JSON.stringify(data).slice(0, 300)}`)
  return data as { access_token: string; refresh_token?: string; expires_in?: number }
}

export async function exchangeCode(db: Db, code: string, state: string): Promise<Tokens> {
  const pending = JSON.parse((await getSetting(db, 'x_oauth_pending')) || '{}') as { state?: string; verifier?: string }
  if (!pending.state || pending.state !== state) throw new Error('state OAuth invalide (relance la connexion)')
  const t = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: X_REDIRECT_URI, code_verifier: pending.verifier || '', client_id: process.env.X_CLIENT_ID || '',
  }))
  const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in || 7200) * 1000 }
  const me = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } }).then((r) => r.json()).catch(() => ({}))
  tokens.user_id = me?.data?.id; tokens.username = me?.data?.username
  await setSetting(db, 'x_tokens', JSON.stringify(tokens))
  await setSetting(db, 'x_oauth_pending', '')
  return tokens
}

export async function xAccount(db: Db): Promise<{ connected: boolean; username?: string }> {
  const raw = await getSetting(db, 'x_tokens')
  if (!raw) return { connected: false }
  const t = JSON.parse(raw) as Tokens
  return { connected: !!t.access_token, username: t.username }
}

async function accessToken(db: Db): Promise<string> {
  const raw = await getSetting(db, 'x_tokens')
  if (!raw) throw new Error('Compte X non connecté')
  const t = JSON.parse(raw) as Tokens
  if (t.expires_at - Date.now() > 120_000) return t.access_token
  if (!t.refresh_token) throw new Error('Jeton X expiré : reconnecte le compte')
  const r = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: process.env.X_CLIENT_ID || '' }))
  const next: Tokens = { ...t, access_token: r.access_token, refresh_token: r.refresh_token || t.refresh_token, expires_at: Date.now() + (r.expires_in || 7200) * 1000 }
  await setSetting(db, 'x_tokens', JSON.stringify(next))
  return next.access_token
}

// ---- Longueur pondérée X (twitter-text v3 : latin = 1, emoji/CJK = 2, URL = 23) ----
export function xLength(text: string): number {
  let n = 0
  const noUrls = text.replace(/https?:\/\/\S+/g, () => { n += 23; return '' })
  for (const ch of noUrls) {
    const c = ch.codePointAt(0) || 0
    const light = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037)
    n += light ? 1 : 2
  }
  return n
}

// ---- Publication ----
async function createPost(token: string, text: string, replyTo?: string, mediaIds: string[] = [], quoteId?: string): Promise<string> {
  const res = await fetch(`${API}/tweets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}), ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}), ...(quoteId ? { quote_tweet_id: quoteId } : {}) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`X ${res.status} : ${JSON.stringify(data).slice(0, 300)}`)
  return data?.data?.id as string
}


// ---- Médias (images / vidéo du post LinkedIn → X) : upload chunked v2 ----
export interface XMedia { type: 'image' | 'video'; url: string }

async function uploadMedia(token: string, m: XMedia): Promise<string> {
  const file = await fetch(m.url)
  if (!file.ok) throw new Error(`Média LinkedIn inaccessible (${file.status})`)
  const buf = Buffer.from(await file.arrayBuffer())
  const mime = file.headers.get('content-type')?.split(';')[0] || (m.type === 'video' ? 'video/mp4' : 'image/jpeg')
  const auth = { Authorization: `Bearer ${token}` }
  const init = await fetch(`${API}/media/upload/initialize`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: mime, total_bytes: buf.length, media_category: m.type === 'video' ? 'tweet_video' : 'tweet_image' }),
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }))
  if (!init.ok) throw new Error(`Upload média (init) ${init.status} : ${JSON.stringify(init.body).slice(0, 200)}`)
  const id = init.body?.data?.id as string
  const CHUNK = 4 * 1024 * 1024
  for (let i = 0, seg = 0; i < buf.length; i += CHUNK, seg++) {
    const form = new FormData()
    form.append('segment_index', String(seg))
    form.append('media', new Blob([buf.subarray(i, i + CHUNK)], { type: mime }))
    const r = await fetch(`${API}/media/upload/${id}/append`, { method: 'POST', headers: auth, body: form })
    if (!r.ok) throw new Error(`Upload média (append) ${r.status} : ${(await r.text()).slice(0, 200)}`)
  }
  const fin = await fetch(`${API}/media/upload/${id}/finalize`, { method: 'POST', headers: auth }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }))
  if (!fin.ok) throw new Error(`Upload média (finalize) ${fin.status} : ${JSON.stringify(fin.body).slice(0, 200)}`)
  let info = fin.body?.data?.processing_info as { state?: string; check_after_secs?: number } | undefined
  for (let n = 0; info && info.state !== 'succeeded' && n < 30; n++) {
    if (info.state === 'failed') throw new Error('Traitement vidéo X échoué')
    await new Promise((r) => setTimeout(r, Math.min(10, info?.check_after_secs || 3) * 1000))
    const st = await fetch(`${API}/media/upload?command=STATUS&media_id=${id}`, { headers: auth }).then((r) => r.json()).catch(() => ({}))
    info = st?.data?.processing_info
  }
  return id
}

export async function monthSpend(db: Db): Promise<number> {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0)
  const since = start.toISOString()
  const [a, b, c] = await Promise.all([
    db.from('x_posts').select('cost_usd').gte('published_at', since),
    db.from('x_reply_targets').select('cost_usd').gte('created_at', since),
    db.from('x_auto_replies').select('cost_usd').gte('created_at', since),
  ])
  return [a.data, b.data, c.data].flat().reduce((s, r) => s + Number(r?.cost_usd || 0), 0)
}

export async function publishXPost(db: Db, id: string): Promise<{ ids: string[] }> {
  const { data: row } = await db.from('x_posts').select('*').eq('id', id).maybeSingle()
  if (!row) throw new Error('Post introuvable')
  if (row.status === 'published') throw new Error('Déjà publié')
  const parts = ((row.parts as string[]) || []).map((p) => p.trim()).filter(Boolean)
  if (!parts.length) throw new Error('Texte X vide')
  const settings = await xSettings(db)
  const limit = settings.premium ? 25000 : 280
  const tooLong = parts.findIndex((p) => xLength(p) > limit)
  if (tooLong >= 0) throw new Error(`Partie ${tooLong + 1} trop longue (${xLength(parts[tooLong])}/${limit})`)

  const prices = await xPrices(db)
  const cost = parts.reduce((s, p) => s + (/https?:\/\//.test(p) ? prices.post_link : prices.post), 0)
  const spent = await monthSpend(db)
  if (spent + cost > settings.monthly_cap_usd) throw new Error(`Plafond mensuel atteint (${spent.toFixed(2)} $ / ${settings.monthly_cap_usd} $)`)

  const token = await accessToken(db)
  // Médias du post LinkedIn → joints au 1er post (4 images max, ou 1 vidéo).
  const media = ((row.media as XMedia[]) || [])
  const video = media.find((m) => m.type === 'video')
  const toUpload = video ? [video] : media.filter((m) => m.type === 'image').slice(0, 4)
  const mediaIds: string[] = []
  try {
    for (const m of toUpload) mediaIds.push(await uploadMedia(token, m))
  } catch (e) {
    // Erreur visible dans la page (sinon le post reste « validé » sans explication).
    const hint = /\b403\b/.test(String(e)) ? ' → reconnecte ton compte X (autorisation médias)' : ''
    await db.from('x_posts').update({ error: `${String(e).slice(0, 300)}${hint}`, updated_at: new Date().toISOString() }).eq('id', id)
    throw e
  }
  const ids: string[] = []
  let error: string | null = null
  let mediaDropped = false
  for (const [i, p] of parts.entries()) {
    try { ids.push(await createPost(token, p, ids[ids.length - 1], i === 0 ? mediaIds : [])) } catch (e) {
      // X refuse parfois l'image reprise de LinkedIn (« media IDs are invalid ») :
      // on publie le texte seul plutôt que de rater le créneau.
      if (i === 0 && mediaIds.length && /media IDs are invalid/i.test(String(e))) {
        try { ids.push(await createPost(token, p, undefined, [])); mediaDropped = true; continue } catch (e2) { e = e2 }
      }
      error = String(e).slice(0, 400); break
    }
  }
  if (mediaDropped && !error) error = 'Publié sans image (image refusée par X)'
  const paid = parts.slice(0, ids.length).reduce((s, p) => s + (/https?:\/\//.test(p) ? prices.post_link : prices.post), 0)
  const now = new Date().toISOString()
  await db.from('x_posts').update({
    status: ids.length ? 'published' : 'error',
    x_post_ids: ids, cost_usd: paid, error: error && ids.length && ids.length < parts.length ? `Thread incomplet (${ids.length}/${parts.length}) : ${error}` : error,
    published_at: ids.length ? now : null, updated_at: now,
  }).eq('id', id)
  if (!ids.length) throw new Error(error || 'Publication échouée')
  return { ids }
}


// ---- Version FIDÈLE (sans IA) : texte d'origine découpé en thread ----
// Seuls changements : liens retirés (0,20 $ + pénalité), espaces nettoyés.
// Découpe aux paragraphes, puis aux phrases, puis aux mots si nécessaire.
export function faithfulParts(source: string, premium: boolean): string[] {
  const text = source.replace(/https?:\/\/\S+/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const limit = premium ? 25000 : 270
  if (xLength(text) <= limit) return [text]
  const pieces: string[] = []
  for (const para of text.split(/\n+/)) {
    if (xLength(para) <= limit) { pieces.push(para); continue }
    for (const sent of para.split(/(?<=[.!?…])\s+/)) {
      if (xLength(sent) <= limit) { pieces.push(sent); continue }
      let cur = ''
      for (const w of sent.split(/\s+/)) {
        if (xLength(cur ? cur + ' ' + w : w) > limit) { pieces.push(cur); cur = w } else cur = cur ? cur + ' ' + w : w
      }
      if (cur) pieces.push(cur)
    }
  }
  const parts: string[] = []
  let cur = ''
  for (const pc of pieces) {
    const joined = cur ? cur + '\n\n' + pc : pc
    if (xLength(joined) > limit && cur) { parts.push(cur); cur = pc } else cur = joined
  }
  if (cur) parts.push(cur)
  return parts
}

// ---- Génération de la version X (Claude) ----
const CLAUDE_MODEL = process.env.CROSSPOST_CLAUDE_MODEL || 'claude-sonnet-5'

export async function generateXParts(source: string, premium: boolean): Promise<{ parts: string[]; note: string }> {
  const key = claudeKey()
  const fallback = [source.replace(/https?:\/\/\S+/g, '').trim().slice(0, premium ? 4000 : 270)]
  const format = premium
    ? `FORMAT : un seul post (compte X Premium, posts longs autorisés), 1 500 caractères maximum, aérés en paragraphes courts.`
    : `FORMAT : si le contenu tient en 280 caractères sans perdre l'essentiel → 1 seul post. Sinon un thread de 3 à 6 posts, CHAQUE post ≤ 260 caractères (emojis comptent double). Le 1er post doit se suffire à lui-même (hook + promesse), les suivants développent, le dernier conclut.`
  const prompt = `Tu adaptes un post LinkedIn pour X (Twitter), en français, pour Nathan Fenina (SEO, GEO, IA, Claude Code).
${format}
STYLE : hook fort en première ligne, ton direct d'humain à humain, phrases courtes, zéro jargon corporate, pas de « 👇 » ni « Thread : », 0 ou 1 hashtag maximum, pas d'emoji ajouté si l'original n'en a pas. Garde les idées, chiffres et exemples de l'original, n'invente rien.
INTERDIT : aucun lien http (coûteux et pénalisé sur X) — s'il y avait un lien, remplace par une formulation sans lien ou supprime. Pas de mention @ LinkedIn. Pas d'appel du type « commente X pour recevoir » (mécanique LinkedIn) : reformule en « réponds/écris-moi en DM » ou retire.
Réponds UNIQUEMENT avec ce JSON, sans markdown : {"parts": ["post 1", "post 2", ...]}

POST LINKEDIN :
"""
${source}
"""`
  try {
    // Claude si la clé est posée sur Vercel, sinon Gemini (déjà utilisé par l'app).
    let text = ''
    if (key) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!res.ok) return { parts: fallback, note: `Claude ${res.status} : texte d’origine tronqué` }
      const data = await res.json()
      text = (data.content || []).map((c: { text?: string }) => c.text || '').join('')
    } else {
      text = await geminiText(prompt)
    }
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { parts?: string[] }
    const parts = (parsed.parts || []).map((p) => p.replace(/https?:\/\/\S+/g, '').trim()).filter(Boolean)
    return parts.length ? { parts, note: '' } : { parts: fallback, note: 'Réponse vide : texte d’origine tronqué' }
  } catch (err) {
    return { parts: fallback, note: `Génération échouée (${String(err).slice(0, 80)})` }
  }
}

// ---- Import des posts LinkedIn (nouveaux ou archive) ----
interface LiPost { id: string; share_url: string; text: string; posted_at: string | null; reactions: number; comments: number; is_repost: boolean; media: XMedia[]; note: string }

function mediaOf(x: Record<string, unknown>): { media: XMedia[]; note: string } {
  const atts = (x.attachments || []) as Array<Record<string, unknown>>
  const media: XMedia[] = []
  const other: string[] = []
  for (const a of atts) {
    if (a.unavailable || !a.url) { if (a.type) other.push(String(a.type)); continue }
    if (a.type === 'img') media.push({ type: 'image', url: String(a.url) })
    else if (a.type === 'video') media.push({ type: 'video', url: String(a.url) })
    else other.push(String(a.type))
  }
  return { media, note: other.length ? `Pièce jointe non reprise sur X : ${other.join(', ')}` : '' }
}

async function linkedInPostsPage(accountId: string, me: string, cursor?: string): Promise<{ items: LiPost[]; cursor?: string }> {
  const p = new URLSearchParams({ account_id: accountId, limit: '50' })
  if (cursor) p.set('cursor', cursor)
  const data = await unipileFetch(`/users/${encodeURIComponent(me)}/posts?${p.toString()}`)
  const items = ((data.items || []) as Array<Record<string, unknown>>).map((x) => ({
    id: String(x.social_id || x.id || ''),
    share_url: String(x.share_url || '').split('?')[0],
    text: String(x.text || ''),
    posted_at: (x.parsed_datetime as string) || (x.date as string) || null,
    reactions: Number(x.reaction_counter || 0),
    comments: Number(x.comment_counter || 0),
    is_repost: !!x.is_repost || !!x.repost_id || !!x.repost_content,
    ...mediaOf(x),
  }))
  return { items, cursor: (data.cursor as string) || undefined }
}

export async function importLinkedInPosts(db: Db, opts: { archive: boolean; days?: number; maxPages?: number; limit?: number; ai?: boolean }): Promise<{ scanned: number; added: number; generated: number }> {
  const accountId = await sourceLinkedInAccount(db)
  if (!accountId) throw new Error('Aucun compte LinkedIn source')
  const me = (await getOwnProfile(accountId)).provider_id || ''
  const all: LiPost[] = []
  let cursor: string | undefined
  for (let i = 0; i < (opts.archive ? opts.maxPages || 4 : 1); i++) {
    const page = await linkedInPostsPage(accountId, me, cursor)
    all.push(...page.items)
    if (!page.cursor || !page.items.length) break
    cursor = page.cursor
  }
  const posts = all.filter((p) => p.id && !p.is_repost && p.text.trim().length > 80)
  const { data: known } = await db.from('x_posts').select('linkedin_post_id').in('linkedin_post_id', posts.map((p) => p.id))
  const seen = new Set((known || []).map((k) => k.linkedin_post_id as string))
  const fresh = posts.filter((p) => !seen.has(p.id))
  // Archive : les plus engageants d'abord. Nouveaux : 14 derniers jours seulement.
  // Fenêtre : `days` (archive = meilleurs posts de la période ; nouveaux = 14 j).
  const cutoff = Date.now() - (opts.days ?? (opts.archive ? 3650 : 14)) * 86400000
  const inWindow = fresh.filter((p) => !p.posted_at || new Date(p.posted_at).getTime() >= cutoff)
  const selected = (opts.archive
    ? inWindow.sort((a, b) => (b.reactions + 3 * b.comments) - (a.reactions + 3 * a.comments))
    : inWindow).slice(0, opts.limit ?? 30)
  const { premium } = await xSettings(db)
  let added = 0, generated = 0
  for (const p of selected) {
    // Par défaut : version FIDÈLE (texte d'origine découpé). IA seulement sur demande.
    const parts = opts.ai ? (await generateXParts(p.text, premium)).parts : faithfulParts(p.text, premium)
    if (opts.ai) generated++
    const { error } = await db.from('x_posts').insert({
      linkedin_post_id: p.id, share_url: p.share_url || null, source_text: p.text, posted_at: p.posted_at,
      reactions: p.reactions, comments: p.comments, kind: opts.archive ? 'archive' : 'new', parts, status: 'draft',
      media: p.media, error: p.note || null,
    })
    if (!error) added++
  }
  return { scanned: all.length, added, generated }
}

// Prochain post à publier : nouveaux d'abord (ordre de validation), puis archive (meilleur engagement).
export async function nextApproved(db: Db) {
  // 1. Posts planifiés à une date précise, arrivés à échéance (marge 1 h : le cron passe à heure fixe).
  const soon = new Date(Date.now() + 3600_000).toISOString()
  const { data: due } = await db.from('x_posts').select('id').eq('status', 'approved').not('scheduled_for', 'is', null).lte('scheduled_for', soon).order('scheduled_for', { ascending: true }).limit(1).maybeSingle()
  if (due) return due.id as string
  // 2. Sinon file sans date : nouveaux d'abord, puis archive (meilleur engagement).
  const { data: fresh } = await db.from('x_posts').select('id').eq('status', 'approved').is('scheduled_for', null).eq('kind', 'new').order('approved_at', { ascending: true }).limit(1).maybeSingle()
  if (fresh) return fresh.id as string
  const { data: arch } = await db.from('x_posts').select('id').eq('status', 'approved').is('scheduled_for', null).eq('kind', 'archive').order('reactions', { ascending: false }).limit(1).maybeSingle()
  return (arch?.id as string) || null
}

// ---- Commentaires sur les posts d'autres créateurs (MANUELS) ----
// L'API interdit de répondre à quelqu'un qui ne nous a pas mentionné (depuis
// le 23/02/2026) → on lit les posts, on prépare 2 brouillons, Nathan poste
// lui-même via le lien « intent » de X.
export async function findReplyTargets(db: Db, opts: { query?: string; count?: number } = {}): Promise<{ read: number; added: number; cost: number }> {
  const token = await accessToken(db)
  // « GEO » seul ramène de la géographie / géo-ingénierie → toujours associé à SEO ou IA.
  const query = opts.query || '(SEO OR "Claude Code" OR "AI Overviews" OR "AI Mode" OR "référencement" OR "GEO SEO" OR "visibilité IA") lang:fr -is:retweet -is:reply'
  const p = new URLSearchParams({
    query, max_results: '30', 'tweet.fields': 'public_metrics,created_at', expansions: 'author_id', 'user.fields': 'username,name,public_metrics',
  })
  const res = await fetch(`${API}/tweets/search/recent?${p.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`X recherche ${res.status} : ${JSON.stringify(data).slice(0, 300)}`)
  const users = new Map<string, { username: string; name: string; followers: number }>()
  for (const u of (data.includes?.users || []) as Array<{ id: string; username: string; name: string; public_metrics?: { followers_count?: number } }>) {
    users.set(u.id, { username: u.username, name: u.name, followers: u.public_metrics?.followers_count || 0 })
  }
  const me = JSON.parse((await getSetting(db, 'x_tokens')) || '{}').user_id
  const tweets = ((data.data || []) as Array<{ id: string; text: string; author_id: string; created_at?: string; public_metrics?: { like_count?: number; reply_count?: number } }>)
    .filter((t) => t.author_id !== me)
    .map((t) => ({ ...t, u: users.get(t.author_id) }))
    .filter((t) => t.u && t.u.followers >= 500)
    .sort((a, b) => ((b.u!.followers / 1000) + (b.public_metrics?.like_count || 0)) - ((a.u!.followers / 1000) + (a.public_metrics?.like_count || 0)))
  const { data: known } = await db.from('x_reply_targets').select('tweet_id, author_username')
  const seen = new Set((known || []).map((k) => k.tweet_id as string))
  const authorsDone = new Set<string>()
  const picked = tweets.filter((t) => {
    if (seen.has(t.id) || authorsDone.has(t.u!.username)) return false
    authorsDone.add(t.u!.username); return true
  }).slice(0, opts.count || 10)

  // 2 brouillons par post, en un seul appel IA.
  let drafts: string[][] = picked.map(() => [])
  let quotes: string[] = picked.map(() => '')
  if (picked.length) {
    // Style : extraits de ses vrais posts LinkedIn, pour éviter les réponses « lisses ».
    const { data: mine } = await db.from('x_posts').select('source_text').order('reactions', { ascending: false }).limit(4)
    const style = (mine || []).map((m) => String(m.source_text).slice(0, 350)).join('\n---\n')
    const prompt = `Tu es Nathan Fenina (SEO, GEO, IA, Claude Code). Écris EXACTEMENT avec sa voix, comme dans ces extraits de ses posts : phrases courtes, tutoiement, franc, concret, parfois une pointe d'humour ou un emoji 😉, vécu terrain (clients, Claude Code, pages déployées, chiffres réels).
EXTRAITS DE SON STYLE :
${style}

Pour chaque post X ci-dessous, propose 2 réponses courtes (max 220 caractères), en français, tutoiement. Chaque réponse apporte un VRAI angle : un retour d'expérience concret, une nuance, un chiffre ou une question pertinente. Interdit : « super post », « merci du partage », flatterie vide, auto-promo, liens, hashtags.
Pour chaque post, écris AUSSI une « citation » : ton commentaire publié en citant le post (max 240 caractères), qui se comprend seul (ton avis tranché, ton vécu ou ta nuance sur le sujet du post), sans @ ni lien ni hashtag. Ne cite Claude Code QUE si le post parle d'IA ou d'outils ; varie les angles (un chiffre, une erreur que tu vois chez les clients, un désaccord argumenté, une question).
PERTINENCE : si un post ne parle PAS de SEO, GEO (référencement dans les IA), IA appliquée au marketing/contenu ou acquisition, mets "" comme citation et [] comme réponses pour ce post.
Réponds UNIQUEMENT avec ce JSON : {"replies": [["réponse A post 1", "réponse B post 1"], ["…", "…"], …], "quotes": ["citation post 1", "citation post 2", …]} (même ordre que les posts).

${picked.map((t, i) => `POST ${i + 1} (@${t.u!.username}) :\n${t.text}`).join('\n\n')}`
    try {
      const out = await geminiText(prompt)
      const parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { replies?: string[][]; quotes?: string[] }
      drafts = picked.map((_, i) => (parsed.replies?.[i] || []).map((r) => String(r).trim()).filter(Boolean).slice(0, 2))
      quotes = picked.map((_, i) => String(parsed.quotes?.[i] || '').replace(/https?:\/\/\S+/g, '').trim())
    } catch { /* brouillons vides : Nathan écrit lui-même */ }
  }
  const prices0 = await xPrices(db)
  const readCost = (data.data || []).length * prices0.read + users.size * 0.01
  let added = 0
  for (const [i, t] of picked.entries()) {
    const offTopic = !quotes[i] && !(drafts[i] || []).length
    const { error } = await db.from('x_reply_targets').insert({
      status: offTopic ? 'skipped' : 'todo',
      tweet_id: t.id, author_username: t.u!.username, author_name: t.u!.name, author_followers: t.u!.followers,
      text: t.text, likes: t.public_metrics?.like_count || 0, replies: t.public_metrics?.reply_count || 0,
      posted_at: t.created_at || null, drafts: drafts[i] || [], quote_text: quotes[i] || null,
      cost_usd: i === 0 ? readCost : 0,
    })
    if (!error) added++
  }
  const prices = await xPrices(db)
  const read = (data.data || []).length
  return { read, added, cost: read * prices.read + users.size * 0.01 }
}

export async function publishedToday(db: Db): Promise<number> {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0)
  const { count } = await db.from('x_posts').select('id', { count: 'exact', head: true }).gte('published_at', start.toISOString())
  return count || 0
}


// ---- ENGAGEMENT AUTOMATIQUE (autorisé par X, sans intervention) ----
const startOfDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString() }

// Citations : publie N posts « citation » par jour (ton avis sur un post SEO/GEO/IA
// d'un autre créateur). Ce ne sont pas des réponses → non concernés par la
// restriction de février 2026. Appelé à chaque créneau (max `perRun`).
export async function autoQuotes(db: Db, perRun = 2): Promise<{ posted: number; reason?: string }> {
  const settings = await xSettings(db)
  const { count } = await db.from('x_reply_targets').select('id', { count: 'exact', head: true }).eq('status', 'quoted').gte('quoted_at', startOfDay())
  const left = Math.min(perRun, settings.quotes_per_day - (count || 0))
  if (left <= 0) return { posted: 0, reason: 'plafond citations du jour' }
  const prices = await xPrices(db)
  if ((await monthSpend(db)) + prices.post > settings.monthly_cap_usd) return { posted: 0, reason: 'plafond mensuel' }
  const since = new Date(Date.now() - 2 * 86400000).toISOString()
  const { data: targets } = await db.from('x_reply_targets').select('*').eq('status', 'todo').not('quote_text', 'is', null).gte('created_at', since).order('author_followers', { ascending: false }).limit(left)
  if (!targets?.length) return { posted: 0, reason: 'aucune cible' }
  const token = await accessToken(db)
  let posted = 0
  for (const t of targets) {
    const text = String(t.quote_text || '').trim()
    if (!text || xLength(text) > 280) { await db.from('x_reply_targets').update({ status: 'skipped' }).eq('id', t.id); continue }
    try {
      const xid = await createPost(token, text, undefined, [], t.tweet_id as string)
      await db.from('x_reply_targets').update({ status: 'quoted', x_post_id: xid, quoted_at: new Date().toISOString(), cost_usd: Number(t.cost_usd || 0) + prices.post, updated_at: new Date().toISOString() }).eq('id', t.id)
      posted++
      if (posted < targets.length) await new Promise((r) => setTimeout(r, 45_000))
    } catch (e) {
      await db.from('x_reply_targets').update({ status: 'skipped', updated_at: new Date().toISOString() }).eq('id', t.id)
      if (/\b(401|403|429)\b/.test(String(e))) return { posted, reason: String(e).slice(0, 200) }
    }
  }
  return { posted }
}

// Réponses aux personnes qui MENTIONNENT Nathan (ou répondent à ses posts) :
// autorisé par l'API car elles l'ont « invoqué ». Réponse dans son style, ou rien
// si le message n'appelle pas de réponse (spam, simple emoji…).
export async function autoReplyMentions(db: Db, max = 5): Promise<{ read: number; replied: number }> {
  const settings = await xSettings(db)
  const { count } = await db.from('x_auto_replies').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', startOfDay())
  const left = Math.min(max, settings.mention_replies_per_day - (count || 0))
  if (left <= 0) return { read: 0, replied: 0 }
  const tokens = JSON.parse((await getSetting(db, 'x_tokens')) || '{}') as { user_id?: string; username?: string }
  if (!tokens.user_id) return { read: 0, replied: 0 }
  const token = await accessToken(db)
  const sinceId = await getSetting(db, 'x_mentions_since_id')
  const p = new URLSearchParams({ max_results: '20', 'tweet.fields': 'author_id,created_at,conversation_id', expansions: 'author_id', 'user.fields': 'username' })
  if (sinceId) p.set('since_id', sinceId)
  else p.set('start_time', new Date(Date.now() - 2 * 86400000).toISOString())
  const res = await fetch(`${API}/users/${tokens.user_id}/mentions?${p.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`X mentions ${res.status} : ${JSON.stringify(data).slice(0, 200)}`)
  const items = (data.data || []) as Array<{ id: string; text: string; author_id: string }>
  if (data.meta?.newest_id) await setSetting(db, 'x_mentions_since_id', data.meta.newest_id)
  const users = new Map(((data.includes?.users || []) as Array<{ id: string; username: string }>).map((u) => [u.id, u.username]))
  const prices = await xPrices(db)
  const readCost = items.length * prices.read
  const { data: mine } = await db.from('x_posts').select('source_text').order('reactions', { ascending: false }).limit(3)
  const style = (mine || []).map((m) => String(m.source_text).slice(0, 300)).join('\n---\n')
  let replied = 0
  for (const [i, m] of items.filter((x) => x.author_id !== tokens.user_id).entries()) {
    if (replied >= left) break
    // Pas plus d'1 réponse auto par personne et par 24 h (sinon ping-pong qui fait robot).
    const who = users.get(m.author_id) || ''
    const { count: recent } = await db.from('x_auto_replies').select('id', { count: 'exact', head: true }).eq('author_username', who).eq('status', 'sent').gte('created_at', new Date(Date.now() - 86400000).toISOString())
    if ((recent || 0) >= 1) { await db.from('x_auto_replies').insert({ mention_id: m.id, author_username: who, mention_text: m.text, status: 'skipped', error: 'déjà répondu < 24 h' }).then(() => {}, () => {}); continue }
    let reply = ''
    try {
      reply = (await geminiText(`Tu es Nathan Fenina (SEO, GEO, IA, Claude Code). Quelqu'un t'a écrit sur X :
"""${m.text}"""
Réponds-lui comme Nathan (tutoiement, court, chaleureux, concret, max 200 caractères, sans lien ni hashtag), dans ce style :
${style}
Si le message n'appelle pas de réponse (spam, pub, simple emoji, insulte, hors sujet), réponds exactement : SKIP
Réponds UNIQUEMENT avec le texte de la réponse.`)).trim().replace(/^["«]|["»]$/g, '')
    } catch { reply = '' }
    const base = { mention_id: m.id, author_username: users.get(m.author_id) || null, mention_text: m.text, cost_usd: i === 0 ? readCost : 0 }
    if (!reply || /^SKIP$/i.test(reply) || xLength(reply) > 280) {
      await db.from('x_auto_replies').insert({ ...base, status: 'skipped' }).then(() => {}, () => {})
      continue
    }
    try {
      const xid = await createPost(token, reply.replace(/https?:\/\/\S+/g, ''), m.id)
      await db.from('x_auto_replies').insert({ ...base, reply_text: reply, x_post_id: xid, status: 'sent', cost_usd: base.cost_usd + prices.post })
      replied++
    } catch (e) {
      await db.from('x_auto_replies').insert({ ...base, reply_text: reply, status: 'error', error: String(e).slice(0, 300) }).then(() => {}, () => {})
    }
  }
  return { read: items.length, replied }
}
