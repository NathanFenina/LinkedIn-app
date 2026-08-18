import { getServerSupabase } from '@/lib/supabase'

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('lead_magnet_sends')
      .select('*')
      .eq('campaign_id', id)
      .not('message_sent', 'ilike', '[ÉCHEC]%')
      .order('sent_at', { ascending: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
