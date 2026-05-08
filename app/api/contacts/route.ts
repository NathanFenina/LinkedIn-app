import { getServerSupabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const tab = searchParams.get('tab') // 'conversations' | 'connections' | 'visitors'

  try {
    const db = getServerSupabase()
    let query = db.from('contacts').select('*')

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
