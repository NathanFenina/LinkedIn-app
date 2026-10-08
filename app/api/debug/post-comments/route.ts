import { getPostComments, getOwnProfile, resolvePostSocialId, unipileFetch } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'

// Lecture seule : inspecte les commentaires d'un post (nombre, forme brute,
// réponses déjà faites par le compte). Aucun envoi. Auth : ?token=CRON_SECRET.
export const maxDuration = 120

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (process.env.CRON_SECRET && url.searchParams.get('token') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const postUrl = url.searchParams.get('post_url')
  const socialIn = url.searchParams.get('social_id')
  try {
    const acc = await getActiveAccountId()
    const socialId = await resolvePostSocialId(acc, socialIn, postUrl || '')
    if (!socialId) return Response.json({ error: 'social_id introuvable' }, { status: 400 })
    const me = await getOwnProfile(acc).catch(() => ({} as { provider_id?: string }))
    const all: Array<Record<string, unknown>> = []
    let cursor: string | undefined
    for (let i = 0; i < 10; i++) {
      const { items, cursor: next } = await getPostComments(acc, socialId, cursor, 100)
      all.push(...(items as unknown as Array<Record<string, unknown>>))
      if (!next || !items.length) break
      cursor = next
    }
    const authorId = (c: Record<string, unknown>) => ((c.author_details as { id?: string } | undefined)?.id) || null
    // ?author=<nom> : renvoie les réponses publiées sous le commentaire de cette personne.
    const author = url.searchParams.get('author')
    if (author) {
      const target = all.find((c) => String(c.author || '').toLowerCase().includes(author.toLowerCase()))
      if (!target) return Response.json({ error: 'commentaire introuvable' }, { status: 404 })
      const rep = await unipileFetch(`/posts/${encodeURIComponent(socialId)}/comments?account_id=${encodeURIComponent(acc)}&comment_id=${encodeURIComponent(String(target.id))}&limit=20`)
      return Response.json({ comment: target.text, replies: ((rep.items || []) as Array<Record<string, unknown>>).map((r) => ({ author: r.author, text: r.text, date: r.date })) })
    }
    return Response.json({
      social_id: socialId,
      own_provider_id: me.provider_id || null,
      total: all.length,
      by_me: all.filter((c) => authorId(c) === me.provider_id).length,
      with_replies: all.filter((c) => Number(c.reply_counter || 0) > 0).length,
      distinct_authors: new Set(all.map(authorId).filter(Boolean)).size,
      distinct_without_reply: new Set(all.filter((c) => !Number(c.reply_counter || 0)).map(authorId).filter(Boolean)).size,
      keys: all[0] ? Object.keys(all[0]) : [],
      sample: all.slice(0, 3),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
