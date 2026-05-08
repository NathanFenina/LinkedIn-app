import { getServerSupabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const targetId = searchParams.get('target_id')
  const status = searchParams.get('status')
  const minScore = searchParams.get('min_score')
  try {
    const db = getServerSupabase()
    let query = db.from('competitor_leads').select('*')
    if (targetId) query = query.eq('target_id', targetId)
    if (status) query = query.eq('status', status)
    if (minScore) query = query.gte('score', Number(minScore))
    const { data, error } = await query.order('score', { ascending: false }).limit(500)
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
