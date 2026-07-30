// Cron endpoint. Two modes (via ?mode=):
//   - mode=generate → pour chaque campagne active en "auto_generate", crée les
//     brouillons du jour (appelé UNE fois au début de la session).
//   - (défaut)      → poste LE PROCHAIN brouillon en attente de chaque campagne
//     active (appelé en boucle, espacé de 3-4 min par le runner GitHub Actions).
// Auth: header "Authorization: Bearer ${CRON_SECRET}".

import { getServerSupabase } from '@/lib/supabase'
import { postNextDraft, generateDrafts } from '@/lib/comment-runner'

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

async function activeCampaigns(db: ReturnType<typeof getServerSupabase>) {
  const { data } = await db.from('comment_campaigns').select('*').eq('active', true)
  return data || []
}

async function generateJob() {
  const db = getServerSupabase()
  const campaigns = (await activeCampaigns(db)).filter((c) => c.auto_generate)
  const results = []
  let totalGenerated = 0
  for (const campaign of campaigns) {
    try {
      const r = await generateDrafts(db, campaign, { limit: campaign.daily_cap || 20 })
      totalGenerated += r.generated
      results.push({ campaign: campaign.name, generated: r.generated, posts_found: r.posts_found })
    } catch (err) {
      results.push({ campaign: campaign.name, error: String(err) })
    }
  }
  return { mode: 'generate', campaigns: campaigns.length, generated: totalGenerated, results }
}

async function postJob() {
  const db = getServerSupabase()
  const campaigns = await activeCampaigns(db)
  if (campaigns.length === 0) return { campaigns: 0, comments_posted: 0, remaining_today: 0, results: [] }

  const results = []
  let totalPosted = 0
  let totalRemaining = 0
  for (const campaign of campaigns) {
    try {
      const r = await postNextDraft(db, campaign)
      totalPosted += r.posted
      totalRemaining += r.remaining_today ?? 0
      results.push({ campaign: campaign.name, posted: r.posted, remaining: r.remaining_today, skipped: r.skipped_reason, error: r.error })
    } catch (err) {
      results.push({ campaign: campaign.name, error: String(err) })
    }
  }
  return { campaigns: campaigns.length, comments_posted: totalPosted, remaining_today: totalRemaining, results }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const mode = new URL(request.url).searchParams.get('mode')
  try {
    const result = mode === 'generate' ? await generateJob() : await postJob()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// Allow GET for manual browser testing — same auth.
export async function GET(request: Request) {
  return POST(request)
}
