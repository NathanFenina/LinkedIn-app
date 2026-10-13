import { getActiveAccountId } from '@/lib/account'
import { searchLinkedIn } from '@/lib/unipile'

// Lecture seule : liste les participants d'un événement LinkedIn (recherche
// personnes filtrée « participe à l'événement »). Aucun envoi.
// Auth : ?token=CRON_SECRET. Params : event_id, cursor (pagination).
export const maxDuration = 120

interface RawPerson {
  name?: string
  first_name?: string
  last_name?: string
  id?: string
  provider_id?: string
  public_identifier?: string
  headline?: string
  network_distance?: string
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (process.env.CRON_SECRET && url.searchParams.get('token') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const eventId = url.searchParams.get('event_id')
  if (!eventId) return Response.json({ error: 'event_id requis' }, { status: 400 })
  const searchUrl = `https://www.linkedin.com/search/results/people/?eventAttending=${encodeURIComponent(`["${eventId}"]`)}&origin=EVENT_PAGE_CANNED_SEARCH`
  try {
    const acc = await getActiveAccountId()
    const { items, cursor } = await searchLinkedIn<RawPerson>(acc, {
      url: searchUrl,
      cursor: url.searchParams.get('cursor') || undefined,
      limit: 50,
    } as never)
    return Response.json({
      cursor: cursor || null,
      count: items.length,
      items: items.map((p) => ({
        name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
        provider_id: p.provider_id || p.id || null,
        public_identifier: p.public_identifier || null,
        headline: p.headline || null,
        network_distance: p.network_distance || null,
      })),
    })
  } catch (err) {
    return Response.json({ error: String(err).slice(0, 500) }, { status: 500 })
  }
}
