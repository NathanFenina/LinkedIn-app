import { getServerSupabase } from '@/lib/supabase'

export async function GET() {
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('profile_visitors')
      .select('*')
      .order('visited_at', { ascending: false })

    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { id, contacted } = await request.json()

  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('profile_visitors')
      .update({ contacted })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
