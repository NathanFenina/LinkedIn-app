// Cron quotidien « Artisans à appeler ».
//
// Auth: header "Authorization: Bearer ${CRON_SECRET}".
//
// Une seule passe suffit : Apify gère lui-même login + proxies (aucun risque
// pour le compte FB), donc pas besoin d'espacer comme les DM LinkedIn. On scrape
// tous les groupes actifs, l'IA garde les artisans, on remplit facebook_leads.
import { getServerSupabase } from '@/lib/supabase'
import { runFacebookScrape } from '@/lib/facebook-leads'

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const db = getServerSupabase()
    const url = new URL(request.url)
    const perGroup = Math.max(5, Math.min(60, Number(url.searchParams.get('per_group')) || 25))
    const summary = await runFacebookScrape(db, { perGroup })
    return Response.json({ ok: true, ...summary })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
