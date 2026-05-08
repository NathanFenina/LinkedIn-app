import { getServerSupabase } from '@/lib/supabase'
import { qualifySignalPost } from '@/lib/gemini'

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT ||
  "Agence/freelance SEO et acquisition B2B cherchant des clients ayant un besoin actif d'aide en SEO/acquisition."

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data: post, error } = await db
      .from('signal_posts')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !post) {
      return Response.json({ error: 'Post non trouvé' }, { status: 404 })
    }

    if (!post.content) {
      return Response.json({ error: 'Post sans contenu' }, { status: 400 })
    }

    const qualification = await qualifySignalPost({
      authorName: post.author_name || 'Auteur inconnu',
      authorHeadline: post.author_headline,
      content: post.content,
      matchedKeyword: post.matched_keyword || '',
      context: DEFAULT_CONTEXT,
    })

    const { data: updated } = await db
      .from('signal_posts')
      .update({
        is_real_signal: qualification.is_real_signal,
        qualification_reason: qualification.reason,
        status: qualification.is_real_signal ? 'qualified' : 'ignored',
      })
      .eq('id', id)
      .select()
      .single()

    return Response.json(updated)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
