import { getServerSupabase } from '@/lib/supabase'
import { scoreProfile } from '@/lib/gemini'

export const maxDuration = 300

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT ||
  "Agence/freelance SEO et acquisition B2B."

// Score contacts that have NO conversation yet (connections only) using their profile only.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const ids: string[] | undefined = body.ids
  const limit: number = Math.min(Math.max(Number(body.limit) || 30, 1), 100)
  const onlyUnscored: boolean = body.onlyUnscored !== false

  try {
    const db = getServerSupabase()
    let query = db.from('contacts').select('*').is('chat_id', null)
    if (ids && ids.length > 0) {
      query = db.from('contacts').select('*').in('id', ids)
    } else if (onlyUnscored) {
      query = query.eq('score', 0)
    }
    const { data: contacts, error } = await query.limit(limit)
    if (error) throw error
    if (!contacts || contacts.length === 0) {
      return Response.json({ scored: 0, total: 0, high_value: 0 })
    }

    let scored = 0
    let highValue = 0
    const errors: string[] = []

    for (const contact of contacts) {
      try {
        const result = await scoreProfile({
          name: contact.name,
          jobTitle: contact.job_title,
          myBusinessContext: DEFAULT_CONTEXT,
        })
        await db
          .from('contacts')
          .update({
            score: result.score,
            score_reason: result.reason,
            // Suggest "to_contact" if profile fit is good
            suggested_status: result.score >= 7 ? 'to_contact' : contact.suggested_status,
          })
          .eq('id', contact.id)
        scored++
        if (result.score >= 7) highValue++
      } catch (err) {
        errors.push(String(err))
      }
    }

    return Response.json({
      scored,
      total: contacts.length,
      high_value: highValue,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
