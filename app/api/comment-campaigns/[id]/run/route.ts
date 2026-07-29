import { getServerSupabase } from '@/lib/supabase'
import { runCommentCampaign } from '@/lib/comment-runner'

export const maxDuration = 300

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const { dry_run = false } = await request.json().catch(() => ({}))

  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db
      .from('comment_campaigns')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !campaign) {
      return Response.json({ error: 'Campagne non trouvée' }, { status: 404 })
    }
    const result = await runCommentCampaign(db, campaign, { dryRun: !!dry_run })
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
