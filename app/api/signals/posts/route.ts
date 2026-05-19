import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccount, scopeQueryToAccount } from '@/lib/account'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const onlyRealSignals = searchParams.get('only_real') === '1'

  try {
    const db = getServerSupabase()
    let query = db.from('signal_posts').select('*')
    try {
      const account = await getActiveAccount()
      query = scopeQueryToAccount(query, account)
    } catch {}
    if (status) query = query.eq('status', status)
    if (onlyRealSignals) query = query.eq('is_real_signal', true)
    const { data, error } = await query.order('posted_at', { ascending: false, nullsFirst: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
