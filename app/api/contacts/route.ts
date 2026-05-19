import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccount, scopeQueryToAccount } from '@/lib/account'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const tab = searchParams.get('tab') // 'conversations' | 'connections' | 'visitors'

  try {
    const db = getServerSupabase()
    let query = db.from('contacts').select('*')

    // Scope to the active LinkedIn account. The default account ALSO sees
    // untagged legacy rows (linkedin_account_id IS NULL), so the migration
    // is seamless. Non-default accounts only see their own data.
    try {
      const account = await getActiveAccount()
      query = scopeQueryToAccount(query, account)
    } catch {
      // No account configured at all → return everything (legacy)
    }

    if (tab === 'conversations') {
      query = query.not('chat_id', 'is', null)
    } else if (tab === 'connections') {
      query = query.is('chat_id', null)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query.order('last_message_at', {
      ascending: false,
      nullsFirst: false,
    })

    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
