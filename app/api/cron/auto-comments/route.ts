// Cron: runs every active auto-comment job with auto_run=true.
// Auth: header "Authorization: Bearer ${CRON_SECRET}".
import { getServerSupabase } from '@/lib/supabase'
import { resolveAccountContext, runAutoCommentJob } from '@/lib/auto-comment'

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

async function runJob() {
  const db = getServerSupabase()
  const { data: jobs } = await db
    .from('auto_comment_jobs')
    .select('*')
    .eq('active', true)
    .eq('auto_run', true)

  if (!jobs || jobs.length === 0) {
    return { jobs: 0, commented: 0 }
  }

  let commented = 0
  const errors: string[] = []

  for (const job of jobs) {
    try {
      const ctx = await resolveAccountContext(db, job.linkedin_account_id)
      if (!ctx) {
        errors.push(`${job.label || job.id}: aucun compte LinkedIn disponible`)
        continue
      }
      const result = await runAutoCommentJob(db, job, ctx)
      commented += result.commented
      errors.push(...result.errors.map((e) => `${job.label || job.id}: ${e}`))
      await db
        .from('auto_comment_jobs')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', job.id)
    } catch (err) {
      errors.push(`${job.label || job.id}: ${String(err)}`)
    }
  }

  return { jobs: jobs.length, commented, errors: errors.slice(0, 5) }
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

export async function GET(request: Request) {
  return POST(request)
}
