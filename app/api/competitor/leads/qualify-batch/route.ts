import { getServerSupabase } from '@/lib/supabase'
import { scoreCompetitorLead } from '@/lib/gemini'

export const maxDuration = 300

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT ||
  "Agence/freelance SEO et acquisition B2B cherchant des clients ayant un besoin actif d'aide en SEO/acquisition."

interface DeterministicResult {
  boost: number
  matchedKeywords: string[]
  matchedTags: string[]
}

/**
 * Apply explicit, deterministic criteria from the target before the AI score.
 * Each matched job-title keyword adds +1 (capped). Each matched company-size tag adds +1 (capped).
 * Returns boost + the matches so we can write them in score_reason.
 */
function deterministicScore(
  headline: string | null,
  jobKeywords: string[] | null,
  sizeTags: string[] | null
): DeterministicResult {
  const text = (headline || '').toLowerCase()
  const matchedKeywords = (jobKeywords || []).filter((k) =>
    text.includes(k.trim().toLowerCase())
  )
  const matchedTags = (sizeTags || []).filter((t) =>
    text.includes(t.trim().toLowerCase())
  )
  const boost = Math.min(3, matchedKeywords.length) + Math.min(2, matchedTags.length)
  return { boost, matchedKeywords, matchedTags }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const targetId: string | undefined = body.target_id
  const limit: number = Math.min(Math.max(Number(body.limit) || 30, 1), 100)
  const onlyUnscored: boolean = body.onlyUnscored !== false

  try {
    const db = getServerSupabase()
    let query = db.from('competitor_leads').select('*')
    if (targetId) query = query.eq('target_id', targetId)
    if (onlyUnscored) query = query.eq('score', 0)
    const { data: leads, error } = await query.limit(limit)
    if (error) throw error
    if (!leads || leads.length === 0) {
      return Response.json({ scored: 0, total: 0 })
    }

    // Load each target's deterministic criteria once.
    const targetIds = Array.from(new Set(leads.map((l) => l.target_id).filter(Boolean)))
    const { data: targets } = await db
      .from('competitor_targets')
      .select('id, job_title_keywords, company_size_tags')
      .in('id', targetIds)
    const targetById = new Map<string, { job_title_keywords: string[] | null; company_size_tags: string[] | null }>()
    for (const t of targets || []) targetById.set(t.id, t)

    let scored = 0
    let highValue = 0
    const errors: string[] = []

    for (const lead of leads) {
      try {
        if (!lead.comment_text) continue

        const target = targetById.get(lead.target_id)
        const det = deterministicScore(
          lead.commenter_headline,
          target?.job_title_keywords ?? null,
          target?.company_size_tags ?? null
        )

        const ai = await scoreCompetitorLead({
          commenterName: lead.commenter_name || 'Anonyme',
          commenterHeadline: lead.commenter_headline,
          commentText: lead.comment_text,
          myBusinessContext: DEFAULT_CONTEXT,
        })

        const finalScore = Math.max(1, Math.min(10, ai.score + det.boost))
        const reasonParts: string[] = [ai.reason]
        if (det.matchedKeywords.length)
          reasonParts.push(`Mots-clés job: ${det.matchedKeywords.join(', ')}`)
        if (det.matchedTags.length)
          reasonParts.push(`Tags: ${det.matchedTags.join(', ')}`)

        await db
          .from('competitor_leads')
          .update({
            score: finalScore,
            score_reason: reasonParts.join(' · '),
            status: finalScore >= 7 ? 'qualified' : lead.status,
          })
          .eq('id', lead.id)
        scored++
        if (finalScore >= 7) highValue++
      } catch (err) {
        errors.push(String(err))
      }
    }

    return Response.json({
      scored,
      total: leads.length,
      high_value: highValue,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
