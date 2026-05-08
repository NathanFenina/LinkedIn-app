import { getServerSupabase } from '@/lib/supabase'
import { getChatMessages } from '@/lib/unipile'
import { scoreConversation } from '@/lib/gemini'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const ids: string[] | undefined = body.ids
  const onlyUnscored: boolean = body.onlyUnscored !== false // default true

  try {
    const db = getServerSupabase()
    let query = db.from('contacts').select('*').not('chat_id', 'is', null)
    if (ids && ids.length > 0) {
      query = query.in('id', ids)
    } else if (onlyUnscored) {
      query = query.eq('score', 0)
    }

    const { data: contacts, error } = await query
    if (error) throw error
    if (!contacts || contacts.length === 0) {
      return Response.json({ scored: 0, failed: 0, total: 0 })
    }

    let scored = 0
    let failed = 0
    const errors: string[] = []

    for (const contact of contacts) {
      try {
        if (!contact.chat_id) {
          failed++
          continue
        }
        const messages = await getChatMessages(contact.chat_id, 15)
        if (!messages.length) {
          failed++
          continue
        }
        const result = await scoreConversation(
          contact.name,
          messages.map((m) => ({
            text: m.text,
            is_sender: m.is_sender === 1 || m.is_sender === true,
            created_at: m.timestamp,
          }))
        )
        await db
          .from('contacts')
          .update({
            score: result.score,
            score_reason: result.reason,
            conversation_summary: result.summary,
            suggested_status: result.suggested_status,
          })
          .eq('id', contact.id)
        scored++
      } catch (err) {
        failed++
        errors.push(`${contact.name}: ${String(err)}`)
      }
    }

    return Response.json({
      scored,
      failed,
      total: contacts.length,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
