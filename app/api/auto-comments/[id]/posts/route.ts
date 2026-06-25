import { getServerSupabase } from '@/lib/supabase'

// Tracking rows for a given job (the in-app equivalent of the Google Sheet tab).
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('auto_comment_posts')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
