import { getServerSupabase } from '@/lib/supabase'

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}
  if (typeof body.label === 'string') updates.label = body.label.trim() || null
  if (typeof body.search_url === 'string') updates.search_url = body.search_url.trim()
  if (typeof body.like_post === 'boolean') updates.like_post = body.like_post
  if (typeof body.auto_run === 'boolean') updates.auto_run = body.auto_run
  if (typeof body.active === 'boolean') updates.active = body.active
  if (body.max_posts !== undefined)
    updates.max_posts = Math.max(1, Math.min(50, Number(body.max_posts) || 5))

  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('auto_comment_jobs')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { error } = await db.from('auto_comment_jobs').delete().eq('id', id)
    if (error) throw error
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
