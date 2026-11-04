import { getServerSupabase } from '@/lib/supabase'
import { youtubeExchange } from '@/lib/youtube'

// Retour de Google après autorisation : échange le code contre les jetons, puis renvoie sur le calendrier.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const back = (q: string) => Response.redirect(new URL(`/plug/calendar?${q}`, url.origin).toString(), 302)
  const code = url.searchParams.get('code')
  if (!code) return back(`youtube_error=${encodeURIComponent(url.searchParams.get('error') || 'code manquant')}`)
  try {
    const channel = await youtubeExchange(getServerSupabase(), code, url.searchParams.get('state') || '', url.origin)
    return back(`youtube=${encodeURIComponent(channel || 'connecté')}`)
  } catch (err) {
    return back(`youtube_error=${encodeURIComponent(String(err).slice(0, 200))}`)
  }
}
