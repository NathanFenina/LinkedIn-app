import { getServerSupabase } from '@/lib/supabase'

export const maxDuration = 120

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('messages')
      .select('*')
      .eq('contact_id', id)
      .order('sent_at', { ascending: true, nullsFirst: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
