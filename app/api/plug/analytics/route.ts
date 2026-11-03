import { getServerSupabase } from '@/lib/supabase'
import { analytics } from '@/lib/plug-analytics'
import { errMsg } from '@/lib/utils'

export const maxDuration = 120

// KPI PLUG : ?period=week|month, ?insights=1 pour l'analyse IA (ce qui a marché).
// Avec ?token=CRON_SECRET, sert aussi à Second Brain.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const period = sp.get('period') === 'month' ? 'month' : 'week'
  try {
    return Response.json(await analytics(getServerSupabase(), period, sp.get('insights') === '1'))
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
