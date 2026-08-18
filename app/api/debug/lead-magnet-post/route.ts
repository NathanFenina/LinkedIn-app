import { getActiveAccountId } from '@/lib/account'
import { getPost, getPostComments, extractPostIdFromUrl } from '@/lib/unipile'

// Diagnostic lead-magnet : pour une URL de post donnée, essaie plusieurs formes
// de social_id et dit laquelle renvoie des commentaires. Ouvre dans le navigateur :
//   /api/debug/lead-magnet-post?url=<URL_DU_POST_ENCODEE>
// Aucune donnée sensible : juste des compteurs.
export async function GET(request: Request) {
  const out: Record<string, unknown> = {}
  try {
    const url = new URL(request.url).searchParams.get('url') || ''
    out.input_url = url
    if (!url) return Response.json({ error: 'Ajoute ?url=<url du post>' }, { status: 400 })

    const accountId = await getActiveAccountId()
    out.account_id_tail = accountId.slice(-6)

    const extracted = extractPostIdFromUrl(url)
    out.extracted_id = extracted

    // Ce que getPost renvoie (source de vérité pour le social_id canonique).
    let postSocialId: string | null = null
    if (extracted) {
      try {
        const post = await getPost(accountId, extracted)
        postSocialId = post.social_id || null
        out.getPost = { social_id: post.social_id, id: post.id, share_url: post.share_url }
      } catch (err) {
        out.getPost_error = String(err).slice(0, 200)
      }
    }

    // Numéro brut le plus long (19 chiffres typiques).
    const nums = url.match(/\d{15,}/g) || []
    const rawNum = nums.sort((a, b) => b.length - a.length)[0] || ''

    // Candidats à tester pour les commentaires.
    const candidates = Array.from(
      new Set(
        [
          postSocialId,
          extracted,
          rawNum,
          rawNum && `urn:li:activity:${rawNum}`,
          rawNum && `urn:li:share:${rawNum}`,
          rawNum && `urn:li:ugcPost:${rawNum}`,
        ].filter(Boolean) as string[]
      )
    )

    const tried: Array<{ social_id: string; count: number; error?: string }> = []
    for (const sid of candidates) {
      try {
        const { items } = await getPostComments(accountId, sid, undefined, 50)
        tried.push({ social_id: sid, count: items.length })
      } catch (err) {
        tried.push({ social_id: sid, count: -1, error: String(err).slice(0, 160) })
      }
    }
    out.comment_probes = tried

    return Response.json(out)
  } catch (err) {
    return Response.json({ error: String(err), ...out }, { status: 500 })
  }
}
