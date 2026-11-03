import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

// Liste des actions PLUG. ?status=todo|queued|sent|done|later|dismissed|error|all, ?type=
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const status = sp.get('status') || 'todo'
  const type = sp.get('type')
  try {
    const db = getServerSupabase()
    let q = db.from('plug_actions').select('*').order('score', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(300)
    if (status !== 'all') q = status === 'history' ? q.in('status', ['sent', 'done', 'error']) : q.eq('status', status)
    if (type) q = q.eq('type', type)
    const { data, error } = await q
    if (error) throw error
    const { data: all } = await db.from('plug_actions').select('type, status')
    const counts: Record<string, Record<string, number>> = {}
    for (const r of all || []) {
      counts[r.status] = counts[r.status] || {}
      counts[r.status][r.type] = (counts[r.status][r.type] || 0) + 1
    }
    return Response.json({ actions: data || [], counts })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
