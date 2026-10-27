import { getActiveAccountId } from '@/lib/account'
import { getSentInvitations, withdrawInvitation } from '@/lib/unipile'
import { getServerSupabase } from '@/lib/supabase'

// Invitations LinkedIn envoyées encore en attente.
// GET  : liste (lecture seule). Params : cursor.
// POST : retire UNE invitation { id, provider_id? } et sort le prospect des
//        campagnes (status skipped). Appelée une par une, espacée côté appelant.
// Auth : ?token=CRON_SECRET.
export const maxDuration = 60

function authorized(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  return !process.env.CRON_SECRET || token === process.env.CRON_SECRET
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const acc = await getActiveAccountId()
    const { items, cursor } = await getSentInvitations(acc, new URL(request.url).searchParams.get('cursor') || undefined)
    return Response.json({ cursor: cursor || null, count: items.length, items })
  } catch (err) {
    return Response.json({ error: String(err).slice(0, 500) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, provider_id } = (await request.json()) as { id?: string; provider_id?: string }
  if (!id) return Response.json({ error: 'id requis' }, { status: 400 })
  try {
    const acc = await getActiveAccountId()
    await withdrawInvitation(acc, id)
    if (provider_id) {
      const db = getServerSupabase()
      await db.from('outreach_targets').update({ status: 'skipped', error: 'Invitation retirée (sans réponse > 3 semaines)' })
        .eq('provider_id', provider_id).eq('status', 'invited')
    }
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err).slice(0, 500) }, { status: 500 })
  }
}
