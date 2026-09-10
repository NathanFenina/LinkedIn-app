import { getServerSupabase } from '@/lib/supabase'
import { sweepReplies } from '@/lib/outreach-runner'
import { errMsg } from '@/lib/utils'

export const maxDuration = 300

// Détecte les réponses sur toutes les campagnes actives (marque replied + date).
// Appelé par le bouton "Détecter les réponses" et par le cron quotidien.
export async function POST() {
  try {
    const db = getServerSupabase()
    const res = await sweepReplies(db)
    return Response.json({ ok: true, ...res })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
