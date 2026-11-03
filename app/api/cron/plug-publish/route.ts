// Cron PLUG Publish : publie les posts planifiés arrivés à échéance (validés par
// Nathan dans le calendrier). Auth: header "Authorization: Bearer ${CRON_SECRET}".

import { getServerSupabase } from '@/lib/supabase'
import { publishDue } from '@/lib/plug-publish'

export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return Response.json(await publishDue(getServerSupabase()))
}

export const POST = GET
