import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccount, scopeQueryToAccount } from '@/lib/account'

export async function GET() {
  try {
    const db = getServerSupabase()
    let query = db.from('profile_visitors').select('*')
    try {
      const account = await getActiveAccount()
      query = scopeQueryToAccount(query, account)
    } catch {
      // no account → legacy unfiltered
    }
    const { data, error } = await query.order('visited_at', { ascending: false })

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
