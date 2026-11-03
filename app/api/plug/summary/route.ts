import { getServerSupabase } from '@/lib/supabase'
import { summary } from '@/lib/plug'

// Résumé pour les notifications (routines du mardi / jeudi). Auth : ?token=CRON_SECRET.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return Response.json(await summary(getServerSupabase()))
}
