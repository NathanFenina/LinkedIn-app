import { getServerSupabase } from '@/lib/supabase'
import { resolveAccountContext, fetchFreshPosts } from '@/lib/auto-comment'

export const maxDuration = 120

// "Lancer" — étape 1 : construit la file de posts à commenter.
// Insère des lignes en statut 'review' (en attente), puis renvoie toute la file
// du job (lignes 'review' existantes + nouvelles) pour que la page la traite
// pas-à-pas. Reprend une file laissée en attente (ex: après un Stop).
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

    // Pending déjà en file pour ce job (reprise).
    const { data: pendingRows } = await db
      .from('auto_comment_posts')
      .select('id')
      .eq('job_id', id)
      .eq('status', 'review')
    const pendingCount = pendingRows?.length || 0
    const slots = Math.max(0, (job.max_posts || 5) - pendingCount)

    let found = 0
    let already = 0
    if (slots > 0) {
      const res = await fetchFreshPosts(db, job, accountCtx, slots)
      found = res.found
      already = res.already
      if (res.posts.length) {
        await db.from('auto_comment_posts').insert(
          res.posts.map((p) => ({
            job_id: id,
            linkedin_account_id: accountCtx.account_row_id,
            post_url: p.post_url,
            social_id: p.social_id,
            post_author: p.author_name,
            post_content: p.text,
            status: 'review',
          }))
        )
      }
    }

    // Renvoie la file complète à traiter (ancienne + nouvelle).
    const { data: queue } = await db
      .from('auto_comment_posts')
      .select('id, post_url, post_author, social_id')
      .eq('job_id', id)
      .eq('status', 'review')
      .order('created_at', { ascending: true })

    return Response.json({ posts_found: found, already_commented: already, queue: queue || [] })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
