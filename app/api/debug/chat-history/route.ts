import { getActiveAccountId } from '@/lib/account'
import { getChatMessages, getChats } from '@/lib/unipile'

// Lecture seule : pour une liste de provider_id, retrouve la conversation
// LinkedIn et résume l'historique (messages reçus / envoyés, dernier échange).
// Aucun envoi. Auth : ?token=CRON_SECRET. Body : { provider_ids: string[] }
// (traiter par lots de ~40 pour rester sous la limite de durée).
export const maxDuration = 300

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (process.env.CRON_SECRET && url.searchParams.get('token') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { provider_ids } = (await request.json().catch(() => ({}))) as { provider_ids?: string[] }
  const wanted = new Set(provider_ids || [])
  const acc = await getActiveAccountId()

  // provider_id → chat_id, en balayant les conversations.
  const chatOf = new Map<string, string>()
  let cursor: string | undefined
  for (let page = 0; page < 30 && chatOf.size < wanted.size; page++) {
    const { items, cursor: next } = await getChats(acc, 100, cursor)
    for (const c of items as Array<{ id: string; attendee_provider_id?: string }>) {
      if (c.attendee_provider_id && wanted.has(c.attendee_provider_id)) chatOf.set(c.attendee_provider_id, c.id)
    }
    if (!next || !items.length) break
    cursor = next
  }

  const results = []
  for (const pid of wanted) {
    const chatId = chatOf.get(pid)
    if (!chatId) { results.push({ provider_id: pid, chat_id: null }); continue }
    try {
      const msgs = (await getChatMessages(chatId, 30)) as Array<{ text?: string; is_sender?: number | boolean; timestamp?: string }>
      const mine = msgs.filter((m) => m.is_sender === 1 || m.is_sender === true)
      const theirs = msgs.filter((m) => !(m.is_sender === 1 || m.is_sender === true))
      const sorted = [...msgs].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      results.push({
        provider_id: pid,
        chat_id: chatId,
        sent: mine.length,
        received: theirs.length,
        last_at: sorted[0]?.timestamp || null,
        last_their_at: theirs.map((m) => m.timestamp).sort().pop() || null,
        last: sorted.slice(0, 3).map((m) => `${m.is_sender === 1 || m.is_sender === true ? 'MOI' : 'LUI'} ${String(m.timestamp).slice(0, 10)}: ${(m.text || '').replace(/\s+/g, ' ').slice(0, 160)}`),
      })
    } catch (err) {
      results.push({ provider_id: pid, chat_id: chatId, error: String(err).slice(0, 150) })
    }
  }
  return Response.json({ results })
}
