import { getServerSupabase } from '@/lib/supabase'
import { getChats, getChatAttendees, getChatMessages } from '@/lib/unipile'
import { getActiveAccount } from '@/lib/account'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const pageSize = Math.min(Math.max(Number(body.pageSize) || Number(body.chatLimit) || 50, 1), 200)
    const messagesPerChat = Math.min(Math.max(Number(body.messagesPerChat) || 15, 1), 500)
    const deepen = Boolean(body.deepen)
    const cursor: string | undefined = typeof body.cursor === 'string' && body.cursor ? body.cursor : undefined

    const db = getServerSupabase()
    const account = await getActiveAccount()
    const ACCOUNT_ID = account.unipile_account_id

    const { items: chats, cursor: nextCursor } = await getChats(ACCOUNT_ID, pageSize, cursor)

    let synced = 0
    const errors: string[] = []

    for (const chat of chats) {
      try {
        const attendees = await getChatAttendees(chat.id)
        const contact = attendees.find((a) => a.is_self === 0)
        if (!contact) continue

        const { data: existing } = await db
          .from('contacts')
          .select('id, score, status, messages_fetched, suggested_status')
          .eq('linkedin_id', contact.provider_id)
          .single()

        const previouslyFetched = existing?.messages_fetched ?? 0
        const targetFetch = deepen
          ? Math.max(previouslyFetched + messagesPerChat, messagesPerChat)
          : messagesPerChat

        const messages = await getChatMessages(chat.id, targetFetch)
        if (!messages.length) continue

        const lastMsg = messages[0]
        const isSenderLast = lastMsg.is_sender === 1 || lastMsg.is_sender === true

        const { error: upErr } = await db.from('contacts').upsert(
          {
            linkedin_id: contact.provider_id,
            name: contact.name,
            profile_url: contact.profile_url || null,
            avatar_url: contact.picture_url || null,
            job_title: contact.specifics?.occupation || null,
            chat_id: chat.id,
            last_message: lastMsg.text || null,
            last_message_at: lastMsg.timestamp || null,
            is_sender_last: isSenderLast,
            messages_fetched: messages.length,
            score: existing?.score ?? 0,
            status: existing?.status ?? 'in_progress',
            suggested_status: existing?.suggested_status ?? null,
            linkedin_account_id: account.id,
          },
          { onConflict: 'linkedin_id', ignoreDuplicates: false }
        )
        if (upErr) {
          errors.push(`upsert ${contact.provider_id}: ${upErr.message}`)
        } else {
          synced++
        }
      } catch (err) {
        errors.push(`Chat ${chat.id}: ${String(err)}`)
      }
    }

    return Response.json({
      synced,
      errors: errors.slice(0, 5),
      total: chats.length,
      nextCursor: nextCursor || null,
      done: !nextCursor || chats.length === 0,
      messagesPerChat,
      deepen,
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
