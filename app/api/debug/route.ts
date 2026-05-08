import { getChats, getChatAttendees, getChatMessages } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'

export async function GET() {
  try {
    const ACCOUNT_ID = await getActiveAccountId()
    // Get first 2 chats
    const { items: chats } = await getChats(ACCOUNT_ID, 2)

    const results = []
    for (const chat of chats) {
      let attendees = null
      let messages = null
      let attendeesError = null
      let messagesError = null

      try {
        attendees = await getChatAttendees(chat.id)
      } catch (e) {
        attendeesError = String(e)
      }

      try {
        messages = await getChatMessages(chat.id, 3)
      } catch (e) {
        messagesError = String(e)
      }

      results.push({
        chat_id: chat.id,
        attendee_provider_id: chat.attendee_provider_id,
        timestamp: chat.timestamp,
        attendees,
        attendeesError,
        messages: messages?.slice(0, 1),
        messagesError,
      })
    }

    return Response.json({ total_chats: chats.length, results })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
