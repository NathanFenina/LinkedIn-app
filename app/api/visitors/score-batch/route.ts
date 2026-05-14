import { getServerSupabase } from '@/lib/supabase'
import { scoreProfile } from '@/lib/gemini'

export const maxDuration = 300

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT ||
  "Agence/freelance SEO et acquisition B2B."

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const limit: number = Math.min(Math.max(Number(body.limit) || 30, 1), 100)
  const onlyUnscored: boolean = body.onlyUnscored !== false

  try {
    const db = getServerSupabase()
    let query = db.from('profile_visitors').select('*')
    if (onlyUnscored) query = query.eq('score', 0)
    const { data: visitors, error } = await query
      .order('visited_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    if (!visitors || visitors.length === 0) {
      return Response.json({ scored: 0, total: 0 })
    }

    let scored = 0
    let highValue = 0
    const errors: string[] = []

    for (const v of visitors) {
      try {
        const result = await scoreProfile({
          name: v.name || 'Anonyme',
          jobTitle: v.job_title,
          myBusinessContext: DEFAULT_CONTEXT,
        })
        await db
          .from('profile_visitors')
          .update({ score: result.score, score_reason: result.reason })
          .eq('id', v.id)
        scored++
        if (result.score >= 7) highValue++
      } catch (err) {
        errors.push(String(err))
      }
    }

    return Response.json({
      scored,
      total: visitors.length,
      high_value: highValue,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
