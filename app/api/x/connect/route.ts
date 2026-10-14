import { getServerSupabase } from '@/lib/supabase'
import { buildAuthorizeUrl } from '@/lib/x'
import { errMsg } from '@/lib/utils'

// Démarre la connexion OAuth 2.0 (PKCE) du compte X → redirige vers x.com.
export async function GET() {
  try {
    const url = await buildAuthorizeUrl(getServerSupabase())
    return Response.redirect(url, 302)
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
