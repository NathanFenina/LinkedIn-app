// Cron endpoint: runs every active comment campaign (a small batch each call).
// Auth: header "Authorization: Bearer ${CRON_SECRET}".
// Trigger hourly via GitHub Actions (see .github/workflows/cron-comments.yml)
// so the daily cap gets spread across the day instead of a single batch.

import { getServerSupabase } from '@/lib/supabase'
import { runCommentCampaign } from '@/lib/comment-runner'

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

async function runJob() {
  const db = getServerSupabase()
  const { data: campaigns } = await db
    .from('comment_campaigns')
    .select('*')
    .eq('active', true)

  if (!campaigns || campaigns.length === 0) {
    return { campaigns: 0, comments_posted: 0, results: [] }
  }

  const results = []
  let totalPosted = 0
  let totalRemaining = 0
  for (const campaign of campaigns) {
    try {
      const r = await runCommentCampaign(db, campaign, { dryRun: false })
      totalPosted += r.comments_posted
      totalRemaining += r.remaining_today ?? 0
      results.push({
        campaign: campaign.name,
        posted: r.comments_posted,
        remaining: r.remaining_today,
        skipped: r.skipped_reason,
        errors: r.errors,
      })
    } catch (err) {
      results.push({ campaign: campaign.name, error: String(err) })
    }
  }
  // remaining_today = combien il reste à poster aujourd'hui (tous quotas
  // confondus). Le runner de session s'arrête quand ça tombe à 0.
  return {
    campaigns: campaigns.length,
    comments_posted: totalPosted,
    remaining_today: totalRemaining,
    results,
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runJob()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// Allow GET for manual browser testing — same auth.
export async function GET(request: Request) {
  return POST(request)
}
