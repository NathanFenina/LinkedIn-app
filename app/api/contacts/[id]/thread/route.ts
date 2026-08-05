import { getServerSupabase } from '@/lib/supabase'
import { getChatMessages } from '@/lib/unipile'

export const maxDuration = 60

// Historique LIVE de la conversation (via Unipile), du plus ancien au plus récent.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data: contact } = await db.from('contacts').select('chat_id').eq('id', id).maybeSingle()
    if (!contact?.chat_id) return Response.json([])
    const raw = await getChatMessages(contact.chat_id, 25)
    const messages = raw
      .map((m) => ({
        text: m.text,
        is_sender: m.is_sender === 1 || m.is_sender === true,
        timestamp: m.timestamp,
      }))
      .reverse() // Unipile renvoie du plus récent au plus ancien
    return Response.json(messages)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
