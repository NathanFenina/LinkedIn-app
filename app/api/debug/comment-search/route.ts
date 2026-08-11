import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'
import { getUserPosts } from '@/lib/unipile'

// Diagnostic : que renvoie la recherche de contenu LinkedIn (feed des membres) ?
// Ouvre cette URL dans le navigateur où tu es connecté à l'app. Aucune donnée
// sensible : juste des compteurs + 3 auteurs d'exemple, pour voir si Unipile
// répond 0 post (LinkedIn bloque), une erreur, ou des posts trop vieux.
export async function GET() {
  const out: Record<string, unknown> = {}
  try {
    const db = getServerSupabase()
    const { data: campaign } = await db
      .from('comment_campaigns')
      .select('member_ids')
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    const members: string[] = (campaign?.member_ids || []).filter((m: string) => m?.startsWith('ACo'))
    out.member_count = members.length

    const accountId = await getActiveAccountId()
    out.account_id_tail = accountId.slice(-6)

    // Nouvelle méthode : posts récents PAR membre (endpoint par-utilisateur).
    // On teste sur les 4 premiers membres pour confirmer que ça renvoie des posts.
    const perMember: unknown[] = []
    for (const id of members.slice(0, 4)) {
      try {
        const posts = await getUserPosts(accountId, id, 3)
        perMember.push({
          member: id.slice(0, 12),
          count: posts.length,
          sample: posts.slice(0, 2).map((p) => ({ author: p.author_name, posted_at: p.posted_at, has_id: !!p.social_id, excerpt: (p.post_content || '').slice(0, 50) })),
        })
      } catch (err) {
        perMember.push({ member: id.slice(0, 12), error: String(err).slice(0, 200) })
      }
    }
    out.per_member = perMember

    return Response.json(out)
  } catch (err) {
    return Response.json({ error: String(err), ...out }, { status: 500 })
  }
}
