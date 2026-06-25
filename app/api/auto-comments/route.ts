import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccount, getActiveAccountRowId, scopeQueryToAccount } from '@/lib/account'

export async function GET() {
  try {
    const db = getServerSupabase()
    let query = db.from('auto_comment_jobs').select('*')
    try {
      const account = await getActiveAccount()
      query = scopeQueryToAccount(query, account)
    } catch {}
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const search_url: string | undefined = body.search_url?.trim()
  const label: string | undefined = body.label?.trim()
  const like_post = body.like_post !== false
  const auto_run = !!body.auto_run
  const max_posts = Math.max(1, Math.min(50, Number(body.max_posts) || 5))

  if (!search_url) {
    return Response.json({ error: 'search_url requis' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const accountRowId = await getActiveAccountRowId().catch(() => null)
    const { data, error } = await db
      .from('auto_comment_jobs')
      .insert({
        label: label || null,
        search_url,
        like_post,
        auto_run,
        max_posts,
        active: true,
        linkedin_account_id: accountRowId,
      })
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
