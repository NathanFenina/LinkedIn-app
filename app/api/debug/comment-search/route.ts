import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'
import { buildMemberSearchUrl, searchPostsBySearchUrl } from '@/lib/unipile'

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

    const test = async (label: string, ids: string[]) => {
      const url = buildMemberSearchUrl(ids)
      try {
        const { items, cursor } = await searchPostsBySearchUrl(accountId, url)
        out[label] = {
          members: ids.length,
          raw_items: items.length,
          has_cursor: !!cursor,
          sample: items.slice(0, 3).map((p) => ({ author: p.author_name, posted_at: p.posted_at, has_id: !!p.social_id })),
        }
      } catch (err) {
        out[label] = { members: ids.length, error: String(err).slice(0, 300) }
      }
    }

    // 3 tailles pour isoler si c'est le nombre de membres qui casse la recherche.
    await test('chunk_5', members.slice(0, 5))
    await test('chunk_12', members.slice(0, 12))
    await test('full', members)

    return Response.json(out)
  } catch (err) {
    return Response.json({ error: String(err), ...out }, { status: 500 })
  }
}
