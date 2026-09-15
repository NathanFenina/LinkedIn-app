import { getServerSupabase } from '@/lib/supabase'

// Notes du jour (ce que l'assistant veut remonter à Nathan dans l'app).
// GET  → non lues (+ les 10 dernières lues)
// POST { op:'read', id } | { op:'read_all' } | { op:'add', kind?, title, body?, link? }
export async function GET() {
  try {
    const db = getServerSupabase()
    const { data: unread } = await db.from('cockpit_notes').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(30)
    const { data: read } = await db.from('cockpit_notes').select('*').not('read_at', 'is', null).order('created_at', { ascending: false }).limit(10)
    return Response.json({ unread: unread || [], read: read || [] })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { op, id } = body as { op?: string; id?: string }
  try {
    const db = getServerSupabase()
    if (op === 'read' && id) {
      const { error } = await db.from('cockpit_notes').update({ read_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return Response.json({ ok: true })
    }
    if (op === 'read_all') {
      const { error } = await db.from('cockpit_notes').update({ read_at: new Date().toISOString() }).is('read_at', null)
      if (error) throw error
      return Response.json({ ok: true })
    }
    if (op === 'add') {
      const { kind, title, body: text, link } = body as { kind?: string; title?: string; body?: string; link?: string }
      if (!title) return Response.json({ error: 'title manquant' }, { status: 400 })
      const { error } = await db.from('cockpit_notes').insert({ kind: kind || 'info', title, body: text || null, link: link || null })
      if (error) throw error
      return Response.json({ ok: true })
    }
    return Response.json({ error: 'op inconnu' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
