import { getServerSupabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  try {
    const db = getServerSupabase()
    let query = db.from('job_postings').select('*')
    if (status) query = query.eq('status', status)
    const { data, error } = await query.order('posted_at', { ascending: false, nullsFirst: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
