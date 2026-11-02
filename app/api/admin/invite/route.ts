import { getActiveAccountId } from '@/lib/account'
import { sendLinkedInInvitation } from '@/lib/unipile'
import { getServerSupabase } from '@/lib/supabase'
import { guard } from '@/lib/limits'

// Envoie UNE invitation LinkedIn à un prospect validé par Nathan (target_id),
// sans note, et passe le prospect en « invited ». Appelée une par une,
// espacée côté appelant. Auth : ?token=CRON_SECRET.
export const maxDuration = 60

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { target_id } = (await request.json()) as { target_id?: string }
  if (!target_id) return Response.json({ error: 'target_id requis' }, { status: 400 })
  try {
    const db = getServerSupabase()
    const { data: t } = await db.from('outreach_targets').select('id, name, provider_id, status').eq('id', target_id).maybeSingle()
    if (!t?.provider_id) return Response.json({ error: 'Prospect introuvable ou sans provider_id' }, { status: 404 })
    if (t.status === 'invited') return Response.json({ ok: true, skipped: 'déjà invité' })
    const acc = await getActiveAccountId()
    const g = await guard(db, acc, 'invite')
    if (!g.allowed) return Response.json({ error: g.reason, limited: true }, { status: 429 })
    await sendLinkedInInvitation(acc, t.provider_id)
    await db.from('outreach_targets').update({ status: 'invited', invited_at: new Date().toISOString() }).eq('id', t.id)
    return Response.json({ ok: true, invited: t.name })
  } catch (err) {
    return Response.json({ error: String(err).slice(0, 500) }, { status: 500 })
  }
}
