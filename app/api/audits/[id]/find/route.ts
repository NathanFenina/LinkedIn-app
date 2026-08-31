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
  network_distance?: string
  connection_degree?: string
}

// Renvoie true si la personne est en relation directe (1er niveau) — un DM
// classique ne fonctionne que dans ce cas. Unipile utilise des libellés
// variables selon l'API ; on couvre les formes connues.
function isFirstDegree(p: RawPerson): boolean {
  const v = `${p.network_distance || ''} ${p.connection_degree || ''}`.toUpperCase()
  return /DISTANCE_1|FIRST|\b1(ST)?\b|1ER/.test(v)
}

// Priorité de scoring des intitulés (plus haut = mieux).
const ROLE_WEIGHTS: Array<[RegExp, number]> = [
  [/chief marketing|cmo\b/i, 10],
  [/directeur marketing|directrice marketing|marketing director/i, 9],
  [/head of marketing|responsable marketing|vp marketing/i, 8],
  [/head of (digital )?acquisition|head of growth/i, 7],
  [/growth|acquisition/i, 6],
  [/e-?commerce|digital|brand/i, 5],
  [/marketing/i, 4],
  [/founder|fondat|\bceo\b|co-?founder|dirigeant/i, 3],
]

// Postes à ÉVITER pour un audit GEO externe :
// - SEO/SEA/GEO en interne (territoriaux : ils verront l'audit comme une menace)
// - opérationnel/trade, commercial terrain, hors-sujet total
const AVOID = /charg[ée]\s*(de\s*)?(seo|sea|sem|geo|référenc|traffic)|\b(seo|sea|sem|geo)\b.*(charg[ée]|specialist|consultant|manager)|traffic manager|trade marketing|marketing op[ée]rationnel|d[ée]l[ée]gu[ée] pharmac|commercial|vente terrain|\bmma\b|athl[èe]te|combattant/i

function scoreHeadline(headline: string | null): number {
  if (!headline) return 0
  if (AVOID.test(headline)) return 1 // très bas, mais reste listé
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
  // Mot-clé COURT (sans guillemets ni longue liste OR : la recherche classique
  // LinkedIn via Unipile renvoie 0 sur les booléens trop complexes).
  const role: string = (body.role || 'marketing').trim()

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

    // 2) Recherche des personnes, avec plusieurs tentatives (fallbacks) car la
    // recherche classique LinkedIn est capricieuse.
    const attempts: string[] = []
    let items: RawPerson[] = []
    const trySearch = async (
      label: string,
      opts: Parameters<typeof searchLinkedIn>[1]
    ) => {
      if (items.length) return
      try {
        const r = await searchLinkedIn<RawPerson>(ACCOUNT_ID, opts)
        attempts.push(`${label}: ${r.items.length}`)
        if (r.items.length) items = r.items
      } catch (e) {
        attempts.push(`${label}: err ${String(e).slice(0, 60)}`)
      }
    }

    if (companyId) {
      // a) employés de la boîte filtrés sur "marketing"
      await trySearch('company+kw', { category: 'people', keywords: role, limit: 25, extra: { company: [companyId] } })
      // b) tous les employés de la boîte (on classe par poste ensuite)
      await trySearch('company', { category: 'people', limit: 25, extra: { company: [companyId] } })
    }
    // c) fallback pur mot-clé "Boîte marketing"
    await trySearch('kw', { category: 'people', keywords: `${target.company} ${role}`, limit: 15 })
    // d) dernier recours : juste le nom de la boîte
    await trySearch('kw-name', { category: 'people', keywords: target.company, limit: 15 })

    const contacts: Array<{
      provider_id: string | null
      name: string | null
      headline: string | null
      profile_url: string | null
      location: string | null
      connected: boolean
      score: number
      recommended?: boolean
    }> = items
      .map((p) => ({
        provider_id: p.provider_id || p.id || null,
        name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
        headline: p.headline || null,
        profile_url: p.profile_url || null,
        location: p.location || null,
        connected: isFirstDegree(p),
        score: scoreHeadline(p.headline || null),
      }))
      .filter((c) => c.provider_id)
      // Meilleur poste marketing d'abord, puis relations directes en tête.
      .sort((a, b) => b.score - a.score || Number(b.connected) - Number(a.connected))

    // Le meilleur candidat est "recommandé" s'il est un vrai décideur
    // marketing/acquisition (score suffisant), pas un lot de repêchage.
    if (contacts.length && contacts[0].score >= 6) contacts[0].recommended = true

    return Response.json({
      company: target.company,
      company_matched: companyMatched,
      company_id_used: companyId,
      attempts,
      contacts: contacts.slice(0, 10),
      hint:
        contacts.length === 0
          ? `Aucun résultat (${attempts.join(' · ')}). ${companyId ? '' : "Société non trouvée dans l'index LinkedIn."}`.trim()
          : companyId
            ? null
            : "Société non trouvée dans l'index LinkedIn — résultats par mot-clé, moins précis.",
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
