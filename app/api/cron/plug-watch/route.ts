// Cron PLUG Veille : récupère les derniers posts des créateurs suivis et explique les meilleurs.
// Auth: header "Authorization: Bearer ${CRON_SECRET}". ?max= nombre de profils par appel (défaut 4).

import { getServerSupabase } from '@/lib/supabase'
import { fetchWatch } from '@/lib/plug-watch'

export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const max = Number(new URL(request.url).searchParams.get('max')) || 4
  return Response.json(await fetchWatch(getServerSupabase(), Math.min(max, 10)))
}

export const POST = GET
