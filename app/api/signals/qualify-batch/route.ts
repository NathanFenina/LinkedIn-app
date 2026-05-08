import { getServerSupabase } from '@/lib/supabase'
import { qualifySignalPost } from '@/lib/gemini'

export const maxDuration = 300

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT ||
  "Agence/freelance SEO et acquisition B2B cherchant des clients ayant un besoin actif d'aide en SEO/acquisition."

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const ids: string[] | undefined = body.ids
  const limit: number = Math.min(Math.max(Number(body.limit) || 30, 1), 100)

  try {
    const db = getServerSupabase()
    let query = db.from('signal_posts').select('*').is('is_real_signal', null)
    if (ids && ids.length > 0) query = db.from('signal_posts').select('*').in('id', ids)
    const { data: posts, error } = await query.limit(limit)
    if (error) throw error
    if (!posts || posts.length === 0) {
      return Response.json({ qualified: 0, total: 0 })
    }

    let qualified = 0
    let realSignals = 0
    const errors: string[] = []

    for (const post of posts) {
      try {
        if (!post.content) continue
        const result = await qualifySignalPost({
          authorName: post.author_name || 'Auteur inconnu',
          authorHeadline: post.author_headline,
          content: post.content,
          matchedKeyword: post.matched_keyword || '',
          context: DEFAULT_CONTEXT,
        })
        await db
          .from('signal_posts')
          .update({
            is_real_signal: result.is_real_signal,
            qualification_reason: result.reason,
            status: result.is_real_signal ? 'qualified' : 'ignored',
          })
          .eq('id', post.id)
        qualified++
        if (result.is_real_signal) realSignals++
      } catch (err) {
        errors.push(String(err))
      }
    }

    return Response.json({
      qualified,
      total: posts.length,
      real_signals: realSignals,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
