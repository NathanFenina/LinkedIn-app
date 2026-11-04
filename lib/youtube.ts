import { getServerSupabase } from './supabase'
import { getSetting, setSetting } from './crosspost'

// ---------------------------------------------------------------------------
// YouTube (Shorts) pour PLUG Publish : connexion OAuth Google + envoi de vidéo.
// Variables Vercel : YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET (client OAuth « Application Web »
// du projet Google Cloud, API « YouTube Data API v3 » activée, URI de redirection =
// https://plug-decupler.vercel.app/api/youtube/callback).
// ⚠️ Tant que le projet Google n'a pas passé l'audit YouTube, les vidéos envoyées par l'API
// sont verrouillées en privé : on les passe en public d'un clic dans YouTube Studio.
// Jetons stockés dans app_settings (youtube_tokens), table protégée par RLS.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getServerSupabase>
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'

function redirectUri(origin: string) {
  return process.env.YOUTUBE_REDIRECT_URI || `${origin}/api/youtube/callback`
}

export async function youtubeAuthorizeUrl(db: Db, origin: string): Promise<string> {
  const id = process.env.YOUTUBE_CLIENT_ID
  if (!id) throw new Error('YOUTUBE_CLIENT_ID manquant dans Vercel')
  const state = crypto.randomUUID()
  await setSetting(db, 'youtube_oauth_state', state)
  const q = new URLSearchParams({
    client_id: id, redirect_uri: redirectUri(origin), response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

export async function youtubeExchange(db: Db, code: string, state: string, origin: string): Promise<string> {
  if (!state || state !== (await getSetting(db, 'youtube_oauth_state'))) throw new Error('state invalide')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code, client_id: process.env.YOUTUBE_CLIENT_ID!, client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      redirect_uri: redirectUri(origin), grant_type: 'authorization_code',
    }),
  })
  const t = await r.json()
  if (!r.ok || !t.refresh_token) throw new Error(`Google : ${JSON.stringify(t).slice(0, 200)}`)
  const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((x) => x.json())
  const channel = ch?.items?.[0]?.snippet?.title || ''
  await setSetting(db, 'youtube_tokens', JSON.stringify({ refresh_token: t.refresh_token, channel }))
  await setSetting(db, 'youtube_oauth_state', '')
  return channel
}

export async function youtubeChannel(db: Db): Promise<string | null> {
  const raw = await getSetting(db, 'youtube_tokens')
  if (!raw) return null
  try { return (JSON.parse(raw).channel as string) || 'connecté' } catch { return null }
}

async function accessToken(db: Db): Promise<string> {
  const raw = await getSetting(db, 'youtube_tokens')
  if (!raw) throw new Error('YouTube non connecté (Calendrier → Réseaux connectés)')
  const { refresh_token } = JSON.parse(raw)
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ refresh_token, client_id: process.env.YOUTUBE_CLIENT_ID!, client_secret: process.env.YOUTUBE_CLIENT_SECRET!, grant_type: 'refresh_token' }),
  })
  const t = await r.json()
  if (!r.ok || !t.access_token) throw new Error(`Google : ${JSON.stringify(t).slice(0, 200)}`)
  return t.access_token as string
}

// Texte de la variante YouTube : 1re ligne = titre (100 caractères max), le reste = description.
export async function uploadShort(db: Db, videoUrl: string, text: string): Promise<{ id: string; url: string }> {
  const token = await accessToken(db)
  const lines = text.trim().split('\n')
  const title = (lines[0] || 'Short').replace(/[<>]/g, '').slice(0, 100)
  const description = lines.slice(1).join('\n').trim().slice(0, 4900)
  const video = await fetch(videoUrl)
  if (!video.ok) throw new Error(`Vidéo inaccessible (${video.status})`)
  const bytes = await video.arrayBuffer()
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(bytes.byteLength) },
    body: JSON.stringify({ snippet: { title, description, categoryId: '28' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }),
  })
  const location = init.headers.get('location')
  if (!init.ok || !location) throw new Error(`YouTube (init) ${init.status} : ${(await init.text()).slice(0, 200)}`)
  const up = await fetch(location, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: bytes })
  const j = await up.json().catch(() => ({}))
  if (!up.ok || !j.id) throw new Error(`YouTube (envoi) ${up.status} : ${JSON.stringify(j).slice(0, 200)}`)
  return { id: j.id, url: `https://www.youtube.com/shorts/${j.id}` }
}
