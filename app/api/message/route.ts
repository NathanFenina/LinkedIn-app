import { getServerSupabase } from '@/lib/supabase'
import { sendMessage, startNewChat } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'
import { guard } from '@/lib/limits'

export async function POST(request: Request) {
  const { contact_id, chat_id, linkedin_id, text } = await request.json()

  if (!text?.trim()) {
    return Response.json({ error: 'Message vide' }, { status: 400 })
  }

  try {
    const db = getServerSupabase()

    // Garde-fou LinkedIn : blocage dur si plafond messages / global atteint.
    const accountId = await getActiveAccountId()
    const g = await guard(db, accountId, 'dm')
    if (!g.allowed) {
      return Response.json({ error: g.reason, limited: true }, { status: 429 })
    }

    let finalChatId = chat_id

    if (finalChatId) {
      // Existing conversation
      await sendMessage(finalChatId, text)
    } else if (linkedin_id) {
      // Start new conversation
      const ACCOUNT_ID = await getActiveAccountId()
      const result = await startNewChat(ACCOUNT_ID, linkedin_id, text)
      finalChatId = result.id

      // Update contact with the new chat_id
      await db
        .from('contacts')
        .update({
          chat_id: finalChatId,
          status: 'in_progress',
          last_message: text,
          last_message_at: new Date().toISOString(),
          is_sender_last: true,
        })
        .eq('id', contact_id)
    } else {
      return Response.json(
        { error: 'chat_id ou linkedin_id requis' },
        { status: 400 }
      )
    }

    // Update last message in DB
    await db
      .from('contacts')
      .update({
        last_message: text,
        last_message_at: new Date().toISOString(),
        is_sender_last: true,
      })
      .eq('id', contact_id)

    return Response.json({ success: true, chat_id: finalChatId })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
