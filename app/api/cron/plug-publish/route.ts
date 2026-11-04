// Cron PLUG Publish : publie les posts planifiés arrivés à échéance (validés par Nathan dans le calendrier).
// Déclencheurs acceptés :
// - "Authorization: Bearer ${CRON_SECRET}" (GitHub Actions, appels manuels) ;
// - en-tête "x-plug-key" = app_settings.publish_trigger_key : clé générée dans la base, utilisée par la tâche
//   pg_cron de Supabase qui appelle cette route toutes les 5 minutes (le planificateur GitHub saute trop de passages).
// Ne publie que ce qui est déjà planifié et échu : un appel en trop ne publie rien de plus.

import { getServerSupabase } from '@/lib/supabase'
import { publishDue } from '@/lib/plug-publish'
import { getSetting } from '@/lib/crosspost'

export const maxDuration = 300

export async function GET(request: Request) {
  const db = getServerSupabase()
  const secret = process.env.CRON_SECRET
  const bearerOk = !secret || request.headers.get('authorization') === `Bearer ${secret}`
  const key = request.headers.get('x-plug-key') || ''
  const keyOk = key.length >= 32 && key === (await getSetting(db, 'publish_trigger_key'))
  if (!bearerOk && !keyOk) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json(await publishDue(db))
}

export const POST = GET
