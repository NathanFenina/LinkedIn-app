import { getServerSupabase } from '@/lib/supabase'
import { getChatAttendees, getChatMessages } from '@/lib/unipile'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const contactIds: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : []
  const messagesPerChat = Math.min(Math.max(Number(body.messagesPerChat) || 15, 1), 500)

  if (contactIds.length === 0) {
    return Response.json({ error: 'contact_ids requis' }, { status: 400 })
  }

  try {
    const db = getServerSupabase()
    const { data: contacts, error } = await db
      .from('contacts')
      .select('id, chat_id, linkedin_id, score, status, messages_fetched, suggested_status')
      .in('id', contactIds)

    if (error) throw error

    let synced = 0
    const errors: string[] = []

    for (const contact of contacts || []) {
      try {
        if (!contact.chat_id) {
          errors.push(`${contact.id}: pas de chat_id`)
          continue
        }

        const attendees = await getChatAttendees(contact.chat_id)
        const att = attendees.find((a) => a.is_self === 0)

        const messages = await getChatMessages(contact.chat_id, messagesPerChat)
        if (!messages.length) continue

        const lastMsg = messages[0]
        const isSenderLast = lastMsg.is_sender === 1 || lastMsg.is_sender === true

        await db
          .from('contacts')
          .update({
            name: att?.name ?? undefined,
            profile_url: att?.profile_url ?? undefined,
            avatar_url: att?.picture_url ?? undefined,
            job_title: att?.specifics?.occupation ?? undefined,
            last_message: lastMsg.text || null,
            last_message_at: lastMsg.timestamp || null,
            is_sender_last: isSenderLast,
            messages_fetched: messages.length,
          })
          .eq('id', contact.id)

        synced++
      } catch (err) {
        errors.push(`${contact.id}: ${String(err)}`)
      }
    }

    return Response.json({
      synced,
      total: contactIds.length,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
