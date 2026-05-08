import { getServerSupabase } from '@/lib/supabase'

export async function GET() {
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('signal_keywords')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { keyword } = await request.json()
  if (!keyword?.trim()) {
    return Response.json({ error: 'keyword requis' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('signal_keywords')
      .insert({ keyword: keyword.trim(), active: true })
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
