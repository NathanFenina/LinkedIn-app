import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

// Bibliothèque de messages + stats par version (envoyés, réponses, taux).
export async function GET() {
  try {
    const db = getServerSupabase()
    const { data: templates } = await db.from('plug_templates').select('*').order('kind').order('key')
    const { data: sent } = await db.from('plug_actions').select('template_key, sent_at, replied_at, tag').in('status', ['sent', 'done']).not('sent_at', 'is', null)
    const stats: Record<string, { sent: number; replies: number; hot: number }> = {}
    for (const s of sent || []) {
      const k = s.template_key || '—'
      stats[k] = stats[k] || { sent: 0, replies: 0, hot: 0 }
      stats[k].sent++
      if (s.replied_at) stats[k].replies++
      if (s.tag && /chaud|rdv|client/i.test(s.tag)) stats[k].hot++
    }
    return Response.json({ templates: templates || [], stats })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

// body { key, name?, kind?, body?, active?, notes? } → crée ou met à jour.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  if (!b.key) return Response.json({ error: 'key requise' }, { status: 400 })
  try {
    const db = getServerSupabase()
    const row: Record<string, unknown> = { key: b.key, updated_at: new Date().toISOString() }
    for (const f of ['name', 'kind', 'body', 'active', 'notes']) if (b[f] !== undefined) row[f] = b[f]
    const { data: exists } = await db.from('plug_templates').select('id').eq('key', b.key as string).maybeSingle()
    const { error } = exists
      ? await db.from('plug_templates').update(row).eq('key', b.key as string)
      : await db.from('plug_templates').insert({ name: b.key, kind: 'approche', body: '', ...row })
    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
