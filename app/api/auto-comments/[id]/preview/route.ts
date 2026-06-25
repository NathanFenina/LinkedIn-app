import { getServerSupabase } from '@/lib/supabase'
import {
  resolveAccountContext,
  fetchFreshPosts,
  generateCommentForPost,
} from '@/lib/auto-comment'

export const maxDuration = 300

// "Simuler": génère les commentaires pour les posts frais SANS rien poster ni
// rien écrire en base. Permet de vérifier le ton avant de lancer.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data: job, error } = await db
      .from('auto_comment_jobs')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !job) return Response.json({ error: 'Job non trouvé' }, { status: 404 })

    const accountCtx = await resolveAccountContext(db, job.linkedin_account_id)
    if (!accountCtx)
      return Response.json({ error: 'Aucun compte LinkedIn configuré.' }, { status: 400 })

    const { posts, found, already } = await fetchFreshPosts(db, job, accountCtx, job.max_posts)

    const preview = []
    for (const p of posts) {
      const gen = await generateCommentForPost(accountCtx, p.text, p.author_name)
      preview.push({
        post_url: p.post_url,
        author: p.author_name,
        strategy: gen.strategy,
        comment: gen.comment,
      })
    }

    return Response.json({ posts_found: found, already_commented: already, preview })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
