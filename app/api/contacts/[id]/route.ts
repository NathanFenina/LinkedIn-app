import { getServerSupabase } from '@/lib/supabase'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/contacts/[id]'>
) {
  const { id } = await ctx.params
  const body = await request.json()

  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('contacts')
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
