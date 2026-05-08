import { getServerSupabase } from '@/lib/supabase'

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json()
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('signal_keywords')
      .update(body)
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
    const { error } = await db.from('signal_keywords').delete().eq('id', id)
    if (error) throw error
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
