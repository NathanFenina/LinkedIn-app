import { getServerSupabase } from '@/lib/supabase'
import { getChatMessages } from '@/lib/unipile'

export const maxDuration = 300

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const messagesPerBatch = Math.min(Math.max(Number(body.batch) || 100, 1), 500)
  const maxMessages = Math.min(Math.max(Number(body.max) || 1000, 1), 5000)

  try {
    const db = getServerSupabase()
    const { data: contact, error } = await db
      .from('contacts')
      .select('id, chat_id, messages_fetched')
      .eq('id', id)
      .single()
    if (error || !contact) {
      return Response.json({ error: 'Contact non trouvé' }, { status: 404 })
    }
    if (!contact.chat_id) {
      return Response.json({ error: 'Pas de chat_id' }, { status: 400 })
    }

    // Fetch in increasing limits — Unipile returns newest first.
    // We iterate fetching N + N more until we've reached max or hit empty.
    let fetched = 0
    let totalStored = 0

    while (fetched < maxMessages) {
      const target = Math.min(fetched + messagesPerBatch, maxMessages)
      const messages = await getChatMessages(contact.chat_id, target)
      if (!messages.length) break

      // Upsert each message, idempotent on unipile_message_id
      for (const m of messages) {
        const { error: upErr } = await db.from('messages').upsert(
          {
            contact_id: contact.id,
            chat_id: contact.chat_id,
            unipile_message_id: m.id,
            text: m.text || null,
            is_sender: m.is_sender === 1 || m.is_sender === true,
            sent_at: m.timestamp || null,
          },
          { onConflict: 'unipile_message_id', ignoreDuplicates: true }
        )
        if (!upErr) totalStored++
      }

      // If we got fewer than asked, no more to fetch
      if (messages.length < target) {
        fetched = messages.length
        break
      }
      fetched = messages.length
    }

    await db
      .from('contacts')
      .update({ messages_fetched: fetched })
      .eq('id', contact.id)

    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contact.id)

    return Response.json({
      fetched,
      total_in_db: count ?? 0,
      newly_stored: totalStored,
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
