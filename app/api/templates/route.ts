import { getServerSupabase } from '@/lib/supabase'

export async function GET() {
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('message_templates')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { name, content } = await request.json()
  if (!name?.trim() || !content?.trim()) {
    return Response.json({ error: 'name et content requis' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('message_templates')
      .insert({ name: name.trim(), content: content.trim() })
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
