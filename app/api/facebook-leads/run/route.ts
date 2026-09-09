import { getServerSupabase } from '@/lib/supabase'
import { runFacebookScrape } from '@/lib/facebook-leads'

// Bouton « Scraper maintenant » de l'app : lance un scrape en direct (petit
// volume par groupe pour tenir dans la limite de temps) et renvoie le bilan.
export const maxDuration = 300

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { group_id, per_group } = body as { group_id?: string; per_group?: number }
  try {
    const db = getServerSupabase()
    const perGroup = Math.max(5, Math.min(40, Number(per_group) || 20))
    const summary = await runFacebookScrape(db, { perGroup, groupId: group_id })
    return Response.json({ ok: true, ...summary })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
