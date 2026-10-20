import { getActiveAccountId } from '@/lib/account'
import { searchLinkedIn } from '@/lib/unipile'

// Lecture seule : exécute une recherche LinkedIn (URL de recherche LinkedIn
// classique : posts, offres d'emploi…) via Unipile et renvoie les résultats bruts.
// Sert à la veille « missions freelance remote ». Aucun envoi.
// Auth : ?token=CRON_SECRET. Params : url (URL de recherche LinkedIn), cursor.
export const maxDuration = 120

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (process.env.CRON_SECRET && url.searchParams.get('token') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const searchUrl = url.searchParams.get('url')
  if (!searchUrl || !/^https:\/\/www\.linkedin\.com\/(search|jobs)\//.test(searchUrl)) {
    return Response.json({ error: 'url de recherche LinkedIn requise' }, { status: 400 })
  }
  try {
    const acc = await getActiveAccountId()
    const { items, cursor } = await searchLinkedIn<Record<string, unknown>>(acc, {
      url: searchUrl,
      cursor: url.searchParams.get('cursor') || undefined,
      limit: 50,
    } as never)
    return Response.json({ cursor: cursor || null, count: items.length, items })
  } catch (err) {
    return Response.json({ error: String(err).slice(0, 500) }, { status: 500 })
  }
}
