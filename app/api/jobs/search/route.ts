import { getServerSupabase } from '@/lib/supabase'
import { searchLinkedIn } from '@/lib/unipile'
import { getActiveAccount } from '@/lib/account'

export const maxDuration = 300

interface RawJob {
  id?: string
  title?: string
  company?: { name?: string; url?: string } | string
  company_name?: string
  company_url?: string
  location?: string
  url?: string
  share_url?: string
  posted_at?: string
  date?: string
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const keyword: string = (body.keyword || '').trim()
  const location: string | undefined = body.location?.trim() || undefined
  const limit: number = Math.min(Math.max(Number(body.limit) || 50, 1), 200)
  const datePosted: string = body.date_posted || 'past_week'

  if (!keyword) {
    return Response.json({ error: 'keyword requis' }, { status: 400 })
  }

  try {
    const db = getServerSupabase()
    const account = await getActiveAccount()
    const ACCOUNT_ID = account.unipile_account_id
    // Jobs schema is different from posts:
    //  - date_posted is a NUMBER (days), not a string
    //  - location requires a region ID, not free text → ignored for now
    const dateDays = datePosted === 'past_24h' ? 1 : datePosted === 'past_month' ? 30 : 7
    const searchBody: Parameters<typeof searchLinkedIn>[1] = {
      category: 'jobs',
      keywords: keyword,
      limit,
      extra: { date_posted: dateDays },
    }
    if (location) {
      // Mention to caller that free-text location isn't supported by Unipile classic
      console.warn(`Jobs: free-text location "${location}" ignored — requires region ID`)
    }
    const { items } = await searchLinkedIn<RawJob>(ACCOUNT_ID, searchBody)

    function safeTs(v: unknown): string | null {
      if (typeof v !== 'string') return null
      const d = new Date(v)
      return isNaN(d.getTime()) ? null : d.toISOString()
    }

    let stored = 0
    const errors: string[] = []
    let sample: unknown = null
    if (items.length > 0) sample = items[0]

    for (const j of items) {
      const jobId = j.id
      if (!jobId) continue

      const company =
        typeof j.company === 'string'
          ? j.company
          : j.company?.name || j.company_name || null
      const companyUrl = (typeof j.company === 'object' ? j.company?.url : null) || j.company_url || null

      const { error: upErr } = await db.from('job_postings').upsert(
        {
          unipile_job_id: jobId,
          title: j.title || null,
          company,
          company_url: companyUrl,
          location: j.location || null,
          job_url: j.share_url || j.url || null,
          posted_at: safeTs(j.posted_at) || safeTs(j.date),
          matched_keyword: keyword,
          status: 'new',
          linkedin_account_id: account.id,
        },
        { onConflict: 'unipile_job_id', ignoreDuplicates: true }
      )
      if (upErr) errors.push(`upsert ${jobId}: ${upErr.message}`)
      else stored++
    }

    return Response.json({
      stored,
      total: items.length,
      keyword,
      errors: errors.slice(0, 5),
      sample,
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
