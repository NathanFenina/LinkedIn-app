import { getServerSupabase } from '@/lib/supabase'
import { getChatMessages, unipileFetch } from '@/lib/unipile'

// Réparation ponctuelle : ré-écrit (PATCH) les messages lead-magnet envoyés
// avec les variantes collées ("==="), en ne gardant que la 1re variante.
// LinkedIn n'accepte l'édition que 60 min après l'envoi. Auth : ?token=CRON_SECRET.
export const maxDuration = 300

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (process.env.CRON_SECRET && url.searchParams.get('token') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = getServerSupabase()
  const { data: rows } = await db
    .from('lead_magnet_sends')
    .select('id, chat_id, commenter_name, message_sent')
    .like('message_sent', '%===%')
    .not('chat_id', 'is', null)
    .is('fixed_at', null)
    .limit(60)
  const out: Array<{ name: string | null; ok: boolean; err?: string }> = []
  for (const r of rows || []) {
    const clean = (r.message_sent as string).split(/\n\s*={3,}\s*\n/)[0].trim()
    try {
      const msgs = (await getChatMessages(r.chat_id as string, 20)) as Array<{ id?: string; text?: string; is_sender?: number | boolean }>
      const mine = msgs.find((m) => (m.is_sender === 1 || m.is_sender === true) && (m.text || '').includes('==='))
      if (!mine?.id) { out.push({ name: r.commenter_name, ok: false, err: 'message introuvable' }); continue }
      await unipileFetch(`/messages/${encodeURIComponent(mine.id)}`, { method: 'PATCH', body: JSON.stringify({ text: clean }) })
      await db.from('lead_magnet_sends').update({ message_sent: clean, fixed_at: new Date().toISOString() }).eq('id', r.id)
      out.push({ name: r.commenter_name, ok: true })
    } catch (err) {
      out.push({ name: r.commenter_name, ok: false, err: String(err).slice(0, 160) })
    }
  }
  return Response.json({ total: (rows || []).length, fixed: out.filter((o) => o.ok).length, out })
}
