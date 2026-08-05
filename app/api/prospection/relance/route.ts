import { getServerSupabase } from '@/lib/supabase'
import { sendMessage } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'
import { guard } from '@/lib/limits'

// Envoie une relance : message + incrémente le compteur de relance (cadence).
export async function POST(request: Request) {
  const { contact_id, chat_id, text } = await request.json().catch(() => ({}))
  if (!text?.trim() || !chat_id) {
    return Response.json({ error: 'chat_id et text requis' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const accountId = await getActiveAccountId()
    const g = await guard(db, accountId, 'dm')
    if (!g.allowed) return Response.json({ error: g.reason, limited: true }, { status: 429 })

    await sendMessage(chat_id, text)

    // Incrémente relance_count (lecture puis écriture — pas de RPC).
    const { data: c } = await db.from('contacts').select('relance_count').eq('id', contact_id).maybeSingle()
    const next = (c?.relance_count || 0) + 1
    await db
      .from('contacts')
      .update({
        relance_count: next,
        last_relance_at: new Date().toISOString(),
        last_message: text,
        last_message_at: new Date().toISOString(),
        is_sender_last: true,
      })
      .eq('id', contact_id)

    return Response.json({ ok: true, relance_count: next })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
