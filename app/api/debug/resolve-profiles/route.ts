import { getActiveAccountId } from '@/lib/account'
import { getUserProfile } from '@/lib/unipile'

// Lecture seule : retrouve provider_id, nom et degré de relation d'une liste de
// profils LinkedIn (identifiant public). Aucun envoi. Auth : ?token=CRON_SECRET.
export const maxDuration = 120

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (process.env.CRON_SECRET && url.searchParams.get('token') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { ids } = (await request.json().catch(() => ({}))) as { ids?: string[] }
  const acc = await getActiveAccountId()
  const out = []
  for (const id of (ids || []).slice(0, 20)) {
    try {
      const p = await getUserProfile(acc, id)
      out.push({ id, provider_id: p.provider_id || null, name: [p.first_name, p.last_name].filter(Boolean).join(' '), headline: p.headline || null, network_distance: p.network_distance || null, is_relationship: p.is_relationship ?? null })
    } catch (err) {
      out.push({ id, error: String(err).slice(0, 200) })
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return Response.json({ results: out })
}
