import { getServerSupabase } from '@/lib/supabase'
import { searchPeopleBySearchUrl } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'

export const maxDuration = 120

// Source des profils via une URL de recherche LinkedIn collée, puis dédup
// contre les contacts déjà en base (marque "déjà échangé").
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const searchUrl: string = (body.search_url || '').trim()
  if (!searchUrl.includes('linkedin.com')) {
    return Response.json({ error: 'Colle une URL de recherche LinkedIn valide.' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const accountId = await getActiveAccountId()
    const { items } = await searchPeopleBySearchUrl(accountId, searchUrl)

    // Dédup : provider_id déjà présent dans contacts (déjà échangé/connu).
    const ids = items.map((p) => p.provider_id).filter(Boolean) as string[]
    const known = new Set<string>()
    if (ids.length) {
      const { data } = await db.from('contacts').select('linkedin_id').in('linkedin_id', ids)
      ;(data || []).forEach((r) => r.linkedin_id && known.add(r.linkedin_id))
    }
    const people = items.map((p) => ({
      ...p,
      already_in_crm: !!(p.provider_id && known.has(p.provider_id)),
    }))
    return Response.json({ people, total: people.length, fresh: people.filter((p) => !p.already_in_crm).length })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
