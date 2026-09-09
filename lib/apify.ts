// Apify — scraping des posts de groupes Facebook (actor officiel
// apify/facebook-groups-scraper). L'infra (login, proxies) est gérée par Apify :
// on ne touche jamais au compte FB de Nathan, donc aucun risque de ban côté nous.
const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR = 'apify~facebook-groups-scraper'

export interface RawGroupPost {
  text: string
  authorName: string
  postUrl: string | null
  groupTitle: string | null
  postedAt: string | null
}

// Lance l'actor en synchrone et renvoie directement les posts d'un groupe.
// resultsLimit borne le coût (≈ 0,10 $ / 20 posts sur le plan gratuit).
export async function scrapeFacebookGroup(groupUrl: string, resultsLimit = 25): Promise<RawGroupPost[]> {
  if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN manquant (variable d’environnement)')
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url: groupUrl }], resultsLimit }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Apify error ${res.status}: ${t.slice(0, 300)}`)
  }
  const items = (await res.json()) as Array<Record<string, unknown>>
  return (items || []).map((p) => {
    const user = p.user as { name?: string } | string | undefined
    const authorName = typeof user === 'string' ? user : user?.name || (p.authorName as string) || ''
    return {
      text: (p.text as string) || '',
      authorName,
      postUrl: (p.url as string) || (p.facebookUrl as string) || null,
      groupTitle: (p.groupTitle as string) || null,
      postedAt: (p.time as string) || null,
    }
  })
}

// Extrait téléphones FR et emails du texte d'un post.
const PHONE_RX = /(?:(?:\+33|0033)\s?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}/g
const EMAIL_RX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

export function extractContacts(text: string): { phones: string[]; emails: string[] } {
  const raw = text || ''
  const phones = Array.from(new Set((raw.match(PHONE_RX) || []).map((m) => m.replace(/[\s.\-]/g, ''))))
  const emails = Array.from(new Set(raw.match(EMAIL_RX) || []))
  return { phones, emails }
}
