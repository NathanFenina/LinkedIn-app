import { getServerSupabase } from '@/lib/supabase'
import { sendLinkedInInvitation } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'
import { guard } from '@/lib/limits'

export const maxDuration = 60

// Envoie une invitation LinkedIn (avec note) à un décideur repéré via une offre.
// Respecte le garde-fou invitations (blocage dur au plafond).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const providerId: string | undefined = body.provider_id?.trim() || undefined
  const message: string | undefined = body.message?.trim() || undefined
  if (!providerId) {
    return Response.json({ error: 'provider_id requis' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const accountId = await getActiveAccountId()
    const g = await guard(db, accountId, 'invite')
    if (!g.allowed) return Response.json({ error: g.reason, limited: true }, { status: 429 })
    await sendLinkedInInvitation(accountId, providerId, message)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
