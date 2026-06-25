import { getServerSupabase } from '@/lib/supabase'
import { resolveAccountContext, runAutoCommentJob } from '@/lib/auto-comment'

export const maxDuration = 300

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const { dry_run = false } = await request.json().catch(() => ({}))

  try {
    const db = getServerSupabase()
    const { data: job, error } = await db
      .from('auto_comment_jobs')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !job) {
      return Response.json({ error: 'Job non trouvé' }, { status: 404 })
    }

    const accountCtx = await resolveAccountContext(db, job.linkedin_account_id)
    if (!accountCtx) {
      return Response.json(
        { error: 'Aucun compte LinkedIn configuré pour ce job.' },
        { status: 400 }
      )
    }

    const result = await runAutoCommentJob(db, job, accountCtx, { dryRun: dry_run })

    if (!dry_run) {
      await db
        .from('auto_comment_jobs')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', id)
    }

    return Response.json({ dry_run, ...result })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
