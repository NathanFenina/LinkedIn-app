import { getServerSupabase } from '@/lib/supabase'
import { exchangeCode } from '@/lib/x'

// Retour de x.com après autorisation : échange le code contre les jetons,
// puis renvoie sur la page /x.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const back = (q: string) => Response.redirect(new URL(`/x?${q}`, url.origin).toString(), 302)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') || ''
  if (!code) return back(`error=${encodeURIComponent(url.searchParams.get('error') || 'code manquant')}`)
  try {
    const t = await exchangeCode(getServerSupabase(), code, state)
    return back(`connected=${encodeURIComponent(t.username || '1')}`)
  } catch (err) {
    return back(`error=${encodeURIComponent(String(err).slice(0, 200))}`)
  }
}
