import { getServerSupabase } from '@/lib/supabase'
import { getChatMessages } from '@/lib/unipile'
import { scoreConversation } from '@/lib/gemini'

export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/contacts/[id]/score'>
) {
  const { id } = await ctx.params

  try {
    const db = getServerSupabase()
    const { data: contact, error } = await db
      .from('contacts')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !contact) {
      return Response.json({ error: 'Contact non trouvé' }, { status: 404 })
    }

    if (!contact.chat_id) {
      return Response.json({ error: 'Pas de conversation pour ce contact' }, { status: 400 })
    }

    const messages = await getChatMessages(contact.chat_id, 15)
    if (!messages.length) {
      return Response.json({ error: 'Aucun message trouvé' }, { status: 400 })
    }

    const scoring = await scoreConversation(
      contact.name,
      messages.map((m) => ({
        text: m.text,
        is_sender: m.is_sender === 1 || m.is_sender === true,
        created_at: m.timestamp,
      }))
    )

    const { data: updated } = await db
      .from('contacts')
      .update({
        score: scoring.score,
        score_reason: scoring.reason,
        conversation_summary: scoring.summary,
        suggested_status: scoring.suggested_status,
      })
      .eq('id', id)
      .select()
      .single()

    return Response.json(updated)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
