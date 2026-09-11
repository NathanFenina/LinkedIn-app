import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'
import { lookupSearchParameter, searchLinkedIn } from '@/lib/unipile'
import { errMsg } from '@/lib/utils'

export const maxDuration = 300

// Sourcer une campagne À PARTIR D'UNE LISTE D'ENTREPRISES (ex: boîtes qui ont
// levé). Pour chaque société : résout l'entreprise LinkedIn → cherche le/les
// décideur(s) marketing → insère en 'sourced' (dédup + do_not_contact).
// Priorise les décideurs marketing sur la tagline.
function roleScore(headline: string | null): number {
  const h = (headline || '').toLowerCase()
  if (/\b(cmo|chief marketing|directeur marketing|directrice marketing|head of marketing|vp marketing|vice president marketing)\b/.test(h)) return 10
  if (/\b(responsable marketing|marketing manager|brand manager|growth|acquisition|demand gen)\b/.test(h)) return 7
  if (/marketing/.test(h)) return 5
  return 2
}

type Person = {
  provider_id?: string; id?: string; name?: string; first_name?: string; last_name?: string
  headline?: string; profile_url?: string
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const companies: string[] = Array.isArray(body.companies)
    ? body.companies.map((c: unknown) => String(c || '').trim()).filter(Boolean)
    : []
  const perCompany = Math.max(1, Math.min(3, Number(body.per_company) || 2))
  if (!companies.length) return Response.json({ error: 'Aucune entreprise fournie' }, { status: 400 })

  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db.from('outreach_campaigns').select('*').eq('id', id).single()
    if (error) throw error
    let accountId: string
    if (campaign.linkedin_account_id) {
      const { data } = await db.from('linkedin_accounts').select('unipile_account_id').eq('id', campaign.linkedin_account_id).maybeSingle()
      accountId = data?.unipile_account_id || (await getActiveAccountId())
    } else {
      accountId = await getActiveAccountId()
    }

    let resolved = 0, added = 0, skipped_dup = 0, notfound = 0
    const notFoundList: string[] = []

    for (const company of companies.slice(0, 60)) {
      // 1) Résout l'entreprise LinkedIn
      let companyId: string | null = null
      try {
        const matches = await lookupSearchParameter(accountId, 'COMPANY', company, 3)
        companyId = matches[0]?.id || null
      } catch { /* on tentera en mot-clé */ }
      if (!companyId) { notfound++; notFoundList.push(company); continue }
      resolved++

      // 2) Cherche les décideurs marketing de cette boîte. La recherche classique
      // LinkedIn n'aime pas les grosses expressions OR → on tente "marketing"
      // simple, puis tous les employés (on classe par rôle ensuite).
      let people: Person[] = []
      const trySearch = async (opts: Parameters<typeof searchLinkedIn>[1]) => {
        if (people.length) return
        try {
          const r = await searchLinkedIn<Person>(accountId, opts)
          if (r.items?.length) people = r.items
        } catch { /* on tente le fallback */ }
      }
      await trySearch({ category: 'people', keywords: 'marketing', limit: 25, extra: { company: [companyId] } })
      await trySearch({ category: 'people', limit: 25, extra: { company: [companyId] } })
      if (!people.length) { notfound++; notFoundList.push(company); continue }

      // 3) Meilleurs décideurs marketing d'abord
      const ranked = people
        .map((p) => ({
          provider_id: p.provider_id || p.id || null,
          name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
          headline: p.headline || null,
          profile_url: p.profile_url || null,
          score: roleScore(p.headline || null),
        }))
        .filter((p) => p.provider_id && p.score >= 5)
        .sort((a, b) => b.score - a.score)
        .slice(0, perCompany)

      for (const p of ranked) {
        // Dédup : déjà dans une campagne, ou "ne plus contacter"
        const { data: dup } = await db.from('outreach_targets').select('id').eq('provider_id', p.provider_id!).limit(1).maybeSingle()
        if (dup) { skipped_dup++; continue }
        const { data: dnc } = await db.from('do_not_contact').select('provider_id').eq('provider_id', p.provider_id!).maybeSingle()
        if (dnc) { skipped_dup++; continue }
        const { error: insErr } = await db.from('outreach_targets').insert({
          campaign_id: id,
          provider_id: p.provider_id,
          name: p.name,
          headline: p.headline ? `${p.headline} · ${company}` : company,
          company,
          profile_url: p.profile_url,
          score: p.score,
          score_reason: `Décideur marketing @ ${company}`,
          status: 'sourced',
        })
        if (!insErr) added++
      }
    }

    return Response.json({ ok: true, companies: companies.length, resolved, added, skipped_dup, notfound, notFoundSample: notFoundList.slice(0, 10) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
