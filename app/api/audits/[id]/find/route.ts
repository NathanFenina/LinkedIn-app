import { getServerSupabase } from '@/lib/supabase'
import { searchLinkedIn, lookupSearchParameter } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'

interface RawPerson {
  id?: string
  provider_id?: string
  name?: string
  first_name?: string
  last_name?: string
  headline?: string
  profile_url?: string
  picture_url?: string
  location?: string
}

// Cible marketing par défaut, fallback fondateur. FR + EN.
const DEFAULT_ROLE =
  'Directeur Marketing OR Directrice Marketing OR Responsable Marketing OR CMO OR "Head of Marketing" OR "VP Marketing" OR "Chief Marketing Officer" OR Marketing OR Growth OR Acquisition OR "E-commerce" OR Fondateur OR Founder OR CEO'

// Priorité de scoring des intitulés (plus haut = mieux).
const ROLE_WEIGHTS: Array<[RegExp, number]> = [
  [/chief marketing|cmo\b/i, 10],
  [/directeur marketing|directrice marketing|marketing director/i, 9],
  [/head of marketing|responsable marketing|vp marketing/i, 8],
  [/head of growth|growth|acquisition/i, 6],
  [/e-?commerce|digital|brand/i, 5],
  [/marketing/i, 4],
  [/founder|fondat|ceo|co-?founder/i, 3],
]

function scoreHeadline(headline: string | null): number {
  if (!headline) return 0
  let best = 0
  for (const [re, w] of ROLE_WEIGHTS) if (re.test(headline)) best = Math.max(best, w)
  return best
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const role: string = (body.role || DEFAULT_ROLE).trim()
  const limit: number = Math.min(Math.max(Number(body.limit) || 10, 1), 25)

  try {
    const db = getServerSupabase()
    const ACCOUNT_ID = await getActiveAccountId()
    const { data: target, error } = await db.from('audit_targets').select('*').eq('id', id).single()
    if (error || !target) return Response.json({ error: 'Cible non trouvée' }, { status: 404 })
    if (!target.company) return Response.json({ error: 'Pas de société' }, { status: 400 })

    // 1) Résout l'ID entreprise LinkedIn pour un filtrage précis.
    let companyId: string | null = null
    let companyMatched: string | null = null
    try {
      const matches = await lookupSearchParameter(ACCOUNT_ID, 'COMPANY', target.company, 5)
      if (matches.length > 0) {
        companyId = matches[0].id
        companyMatched = matches[0].title || target.company
      }
    } catch { /* fallback keyword */ }

    // 2) Recherche des personnes : filtre entreprise si dispo, sinon mot-clé.
    const searchOpts: Parameters<typeof searchLinkedIn>[1] = {
      category: 'people',
      keywords: role,
      limit,
    }
    if (companyId) searchOpts.extra = { company: [companyId] }
    else searchOpts.keywords = `${role} ${target.company}`

    const { items } = await searchLinkedIn<RawPerson>(ACCOUNT_ID, searchOpts)

    const contacts = items
      .map((p) => ({
        provider_id: p.provider_id || p.id || null,
        name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
        headline: p.headline || null,
        profile_url: p.profile_url || null,
        location: p.location || null,
        score: scoreHeadline(p.headline || null),
      }))
      .filter((c) => c.provider_id)
      // Meilleur poste marketing d'abord.
      .sort((a, b) => b.score - a.score)

    return Response.json({
      company: target.company,
      company_matched: companyMatched,
      company_id_used: companyId,
      contacts: contacts.slice(0, 8),
      hint: companyId
        ? null
        : "Société non trouvée dans l'index LinkedIn — résultats par mot-clé, moins précis.",
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
