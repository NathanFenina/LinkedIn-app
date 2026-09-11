import { getServerSupabase } from '@/lib/supabase'

// Webhook Unipile "messaging" (message_received) → détection des réponses EN
// TEMPS RÉEL. Dès qu'un prospect répond, la cible passe 'replied' avec le texte
// du message, et remonte dans "À traiter maintenant" du Cockpit.
// Sécurité : Unipile ne signe pas, on vérifie un token dans l'URL (?token=CRON_SECRET).
export const maxDuration = 30

type Payload = {
  event?: string
  account_id?: string
  chat_id?: string
  message_id?: string
  message?: string
  timestamp?: string
  sender?: { attendee_provider_id?: string; attendee_name?: string }
  account_info?: { user_id?: string }
  is_sender?: boolean | number
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = process.env.CRON_SECRET
  if (secret && url.searchParams.get('token') !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const p = (await request.json().catch(() => ({}))) as Payload
  if (p.event && p.event !== 'message_received') return Response.json({ ok: true, ignored: p.event })

  // Message envoyé par NOUS (Unipile inclut nos propres envois) → on ignore.
  const senderId = p.sender?.attendee_provider_id || ''
  const me = p.account_info?.user_id || ''
  if (p.is_sender === true || p.is_sender === 1) return Response.json({ ok: true, ignored: 'own_message' })
  if (!senderId || (me && senderId === me)) return Response.json({ ok: true, ignored: 'own_message' })

  const text = (p.message || '').slice(0, 2000)
  const at = p.timestamp || new Date().toISOString()
  const db = getServerSupabase()
  let matched = 0

  try {
    // 1) Outreach : par chat_id d'abord, sinon par provider_id (fil ouvert côté prospect)
    const patch = { status: 'replied', replied_at: at, last_inbound: text, last_inbound_at: at, replied_handled_at: null }
    if (p.chat_id) {
      const { data } = await db.from('outreach_targets').update(patch).eq('chat_id', p.chat_id)
        .in('status', ['msg1_sent', 'msg2_sent', 'done', 'replied', 'connected', 'invited']).select('id')
      matched += data?.length || 0
    }
    if (!matched) {
      const { data } = await db.from('outreach_targets').update({ ...patch, chat_id: p.chat_id || null }).eq('provider_id', senderId)
        .in('status', ['msg1_sent', 'msg2_sent', 'done', 'replied', 'connected', 'invited']).select('id')
      matched += data?.length || 0
    }
    // 2) Lead-magnets
    if (p.chat_id) {
      const { data } = await db.from('lead_magnet_sends')
        .update({ replied: true, replied_at: at, last_inbound: text, last_inbound_at: at, replied_handled_at: null })
        .eq('chat_id', p.chat_id).select('id')
      matched += data?.length || 0
    }
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
  return Response.json({ ok: true, matched })
}
