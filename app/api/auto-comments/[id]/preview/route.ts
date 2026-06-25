import { getServerSupabase } from '@/lib/supabase'
import {
  resolveAccountContext,
  fetchFreshPosts,
  generateCommentForPost,
} from '@/lib/auto-comment'

export const maxDuration = 300

// "Simuler" en streaming (NDJSON) : génère les commentaires des posts frais
// SANS rien poster ni écrire en base, en émettant des évènements au fil de l'eau
// pour que la page affiche des logs en direct.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
      try {
        const db = getServerSupabase()
        const { data: job, error } = await db
          .from('auto_comment_jobs')
          .select('*')
          .eq('id', id)
          .single()
        if (error || !job) {
          send({ type: 'error', message: 'Job non trouvé' })
          controller.close()
          return
        }

        const accountCtx = await resolveAccountContext(db, job.linkedin_account_id)
        if (!accountCtx) {
          send({ type: 'error', message: 'Aucun compte LinkedIn configuré.' })
          controller.close()
          return
        }

        send({ type: 'log', message: `Compte : ${accountCtx.persona.name} (${accountCtx.unipile_account_id})` })
        send({ type: 'log', message: `Recherche des posts sur le feed/URL…` })

        const { posts, found, already } = await fetchFreshPosts(db, job, accountCtx, job.max_posts)
        send({
          type: 'log',
          message: `${found} posts récupérés · ${already} déjà commentés sur ce compte · ${posts.length} à générer (max ${job.max_posts})`,
        })

        if (!posts.length) {
          send({ type: 'log', message: 'Rien de neuf à commenter ici.' })
          send({ type: 'done', posts_found: found, already_commented: already, count: 0 })
          controller.close()
          return
        }

        for (let i = 0; i < posts.length; i++) {
          const p = posts[i]
          send({ type: 'log', message: `Génération ${i + 1}/${posts.length} — ${p.author_name || 'auteur'}…` })
          try {
            const gen = await generateCommentForPost(accountCtx, p.text, p.author_name)
            send({
              type: 'item',
              post_url: p.post_url,
              author: p.author_name,
              strategy: gen.strategy,
              language: gen.language,
              mood: gen.mood,
              comment: gen.comment,
            })
          } catch (err) {
            send({ type: 'log', message: `Erreur génération ${i + 1} : ${String(err)}` })
          }
        }

        send({ type: 'done', posts_found: found, already_commented: already, count: posts.length })
        controller.close()
      } catch (err) {
        send({ type: 'error', message: String(err) })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
