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
  current_company?: { name?: string } | string
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const role: string = (body.role || 'CEO OR Founder OR Marketing OR CMO').trim()
  const limit: number = Math.min(Math.max(Number(body.limit) || 10, 1), 50)

  try {
    const db = getServerSupabase()
    const ACCOUNT_ID = await getActiveAccountId()
    const { data: job, error } = await db
      .from('job_postings')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !job) {
      return Response.json({ error: 'Job non trouvé' }, { status: 404 })
    }
    if (!job.company) {
      return Response.json({ error: 'Pas de société associée' }, { status: 400 })
    }

    // 1) Lookup company ID via Unipile params endpoint
    let companyId: string | null = null
    let companyMatched: string | null = null
    try {
      const matches = await lookupSearchParameter(ACCOUNT_ID, 'COMPANY', job.company, 5)
      if (matches.length > 0) {
        companyId = matches[0].id
        companyMatched = matches[0].title || job.company
      }
    } catch (err) {
      console.error('Company lookup failed:', err)
    }

    // 2) Search people: prefer current_company filter, fallback to keywords-only
    const searchOpts: Parameters<typeof searchLinkedIn>[1] = {
      category: 'people',
      keywords: role,
      limit,
    }
    if (companyId) {
      searchOpts.extra = { company: [companyId] }
    } else {
      // Last-resort: include company name in keywords
      searchOpts.keywords = `${role} ${job.company}`
    }

    const { items } = await searchLinkedIn<RawPerson>(ACCOUNT_ID, searchOpts)

    const contacts = items.map((p) => ({
      provider_id: p.provider_id || p.id || null,
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      headline: p.headline || null,
      profile_url: p.profile_url || null,
      avatar_url: p.picture_url || null,
      location: p.location || null,
    }))

    return Response.json({
      company: job.company,
      company_matched: companyMatched,
      company_id_used: companyId,
      role,
      contacts,
      hint: companyId
        ? null
        : "Société non trouvée dans l'index LinkedIn — résultats moins précis (recherche par mot-clé).",
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
