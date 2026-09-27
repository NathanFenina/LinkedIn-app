import { getServerSupabase } from '@/lib/supabase'
import { detectNewPosts } from '@/lib/crosspost'

// Cron Vercel (toutes les 15 min) : détecte les nouveaux posts LinkedIn du
// compte source et prépare les variantes. Ne publie JAMAIS rien.
// Auth : "Authorization: Bearer ${CRON_SECRET}".
export const maxDuration = 120

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const r = await detectNewPosts(getServerSupabase(), { limit: 10 })
    return Response.json({ ok: !r.error, ...r, at: new Date().toISOString() })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
