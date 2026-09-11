import { errMsg } from '@/lib/utils'

export const maxDuration = 300

// « Boîtes qui font de la pub » : interroge la bibliothèque publicitaire Meta
// (annonces ACTIVES en France) via Apify pour les mots-clés donnés, et renvoie
// la liste d'annonceurs (noms de pages) à coller dans « Sourcer par entreprises ».
// Une boîte qui paie des pubs a du budget acquisition — et ton pitch GEO/SEO
// réduit sa dépendance au paid.
const ACTOR = 'curious_coder~facebook-ads-library-scraper'
// Bruit à écarter : très gros annonceurs / plateformes / pages génériques.
const NOISE = /(meta|facebook|google|amazon|apple|microsoft|orange|sfr|bouygues|free\b|edf|engie|total|carrefour|leclerc|lidl|auchan|decathlon|fnac|darty|ikea|zara|h&m|nike|adidas|netflix|disney|uber|airbnb|booking|temu|shein|aliexpress|wish|vinted|leboncoin|la poste|sncf|ratp|axa|allianz|maif|macif|matmut|crédit agricole|bnp|société générale|lcl|banque populaire|caisse d'épargne|boursorama|revolut|n26|qonto|shopify|wix|hubspot|canva|notion|ulule|kickstarter)/i

export async function POST(request: Request) {
  const token = process.env.APIFY_TOKEN
  if (!token) return Response.json({ error: 'APIFY_TOKEN manquant (variable d’environnement Vercel)' }, { status: 500 })
  const body = await request.json().catch(() => ({}))
  const keywords: string[] = Array.isArray(body.keywords) ? body.keywords.map((k: unknown) => String(k || '').trim()).filter(Boolean).slice(0, 8) : []
  const country = String(body.country || 'FR').toUpperCase().slice(0, 2)
  const perKeyword = Math.max(10, Math.min(100, Number(body.per_keyword) || 50))
  if (!keywords.length) return Response.json({ error: 'Donne au moins un mot-clé' }, { status: 400 })

  try {
    const counts = new Map<string, number>()
    let ads = 0
    for (const kw of keywords) {
      const q = encodeURIComponent(kw)
      const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [{ url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${q}&search_type=keyword_unordered&media_type=all` }],
          limitPerSource: perKeyword,
          'scrapePageAds.activeStatus': 'active',
          'scrapePageAds.countryCode': country,
        }),
      })
      if (!res.ok) continue
      const items = (await res.json()) as Array<{ page_name?: string }>
      for (const a of items) {
        ads++
        const n = (a.page_name || '').trim()
        if (!n || NOISE.test(n)) continue
        counts.set(n, (counts.get(n) || 0) + 1)
      }
    }
    const advertisers = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, active_ads]) => ({ name, active_ads }))
    return Response.json({ ok: true, keywords, ads, advertisers })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
