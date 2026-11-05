// Cron PLUG : envoie UNE action validée par Nathan (status queued) par appel,
// avec le même écart minimal global que les autres envois. La boucle GitHub
// Actions (cron-plug-send.yml) rappelle toutes les 2 à 4 min tant qu'il en reste.
// Auth: header "Authorization: Bearer ${CRON_SECRET}".

import { getServerSupabase } from '@/lib/supabase'
import { drainQueue } from '@/lib/plug'

export const maxDuration = 300

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const n = Math.min(2, Number(new URL(request.url).searchParams.get('n') || '1'))
  const runs = await drainQueue(getServerSupabase(), n)
  return Response.json({ ...runs[runs.length - 1], sent: runs.reduce((s, r) => s + r.sent, 0), runs })
}

export const GET = POST
