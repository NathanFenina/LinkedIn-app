import { getServerSupabase } from '@/lib/supabase'
import {
  resolveAccountContext,
  generateCommentForPost,
  likeAndComment,
  isRetryableError,
} from '@/lib/auto-comment'

export const maxDuration = 120

// "Lancer" — étape 2 : traite UN post de la file (par son id).
// Génère le commentaire, like + commente, puis passe la ligne en 'posted'
// (ou 'rejected' en cas d'erreur). Requête courte → la page enchaîne les
// appels avec une pause de ~3 min entre chaque, et peut s'arrêter quand elle veut.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const { post_id } = await request.json().catch(() => ({}))
  if (!post_id) return Response.json({ error: 'post_id requis' }, { status: 400 })

  try {
    const db = getServerSupabase()
    const { data: job, error } = await db
      .from('auto_comment_jobs')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !job) return Response.json({ error: 'Job non trouvé' }, { status: 404 })

    const { data: row } = await db
      .from('auto_comment_posts')
      .select('*')
      .eq('id', post_id)
      .eq('job_id', id)
      .maybeSingle()
    if (!row) return Response.json({ error: 'Post introuvable dans la file' }, { status: 404 })
    if (row.status === 'posted') {
      return Response.json({ status: 'posted', skipped: true, post_id })
    }

    const accountCtx = await resolveAccountContext(db, job.linkedin_account_id)
    if (!accountCtx)
      return Response.json({ error: 'Aucun compte LinkedIn configuré.' }, { status: 400 })

    if (!row.social_id || !row.post_content) {
      await db
        .from('auto_comment_posts')
        .update({ status: 'rejected', error: 'social_id ou contenu manquant' })
        .eq('id', post_id)
      return Response.json({ status: 'rejected', post_id, error: 'social_id ou contenu manquant' })
    }

    try {
      const gen = await generateCommentForPost(accountCtx, row.post_content, row.post_author)
      if (!gen.comment) throw new Error('commentaire vide')
      await likeAndComment(accountCtx, job, row.social_id, gen.comment)
      await db
        .from('auto_comment_posts')
        .update({
          language: gen.language,
          mood: gen.mood,
          strategy: `${gen.strategy} — ${gen.description}`.slice(0, 1000),
          comment: gen.comment,
          status: 'posted',
          error: null,
          commented_at: new Date().toISOString(),
        })
        .eq('id', post_id)
      return Response.json({
        status: 'posted',
        post_id,
        author: row.post_author,
        comment: gen.comment,
        strategy: gen.strategy,
      })
    } catch (err) {
      // Transient throttling (429/5xx) → keep the post in the queue ('review')
      // so it's retried later instead of being permanently rejected.
      const retry = isRetryableError(err)
      await db
        .from('auto_comment_posts')
        .update({ status: retry ? 'review' : 'rejected', error: String(err).slice(0, 500) })
        .eq('id', post_id)
      return Response.json({
        status: retry ? 'retry' : 'rejected',
        post_id,
        error: String(err),
      })
    }
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// "Réinitialiser" : efface la file en attente ('review') ET les échecs
// ('rejected') de ce job, en gardant l'historique des 'posted'. Les posts
// effacés redeviennent donc traitables au prochain "Lancer".
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { error } = await db
      .from('auto_comment_posts')
      .delete()
      .eq('job_id', id)
      .in('status', ['review', 'rejected'])
    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
