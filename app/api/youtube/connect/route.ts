import { getServerSupabase } from '@/lib/supabase'
import { youtubeAuthorizeUrl } from '@/lib/youtube'
import { errMsg } from '@/lib/utils'

// Démarre la connexion OAuth Google du compte YouTube → redirige vers accounts.google.com.
export async function GET(request: Request) {
  try {
    return Response.redirect(await youtubeAuthorizeUrl(getServerSupabase(), new URL(request.url).origin), 302)
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
