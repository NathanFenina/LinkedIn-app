import type { SupabaseClient } from '@supabase/supabase-js'
import { scrapeFacebookGroup, extractContacts } from './apify'
import { classifyArtisanPosts } from './gemini'

// Pipeline « Artisans à appeler » : scrape les groupes FB actifs, garde via IA
// les artisans du bâtiment qui proposent leur métier, extrait tel/email, et
// insère dans facebook_leads (dédoublonné par lien de post + par téléphone).
// LECTURE + écriture uniquement sur nos tables : ne touche à rien d'autre.

export interface ScrapeSummary {
  groups: number
  scanned: number
  artisans: number
  inserted: number
  withPhone: number
  errors: string[]
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function runFacebookScrape(
  db: SupabaseClient,
  opts: { perGroup?: number; groupId?: string } = {}
): Promise<ScrapeSummary> {
  const perGroup = opts.perGroup ?? 25
  const summary: ScrapeSummary = { groups: 0, scanned: 0, artisans: 0, inserted: 0, withPhone: 0, errors: [] }

  let q = db.from('facebook_group_sources').select('id,url,active').eq('active', true)
  if (opts.groupId) q = db.from('facebook_group_sources').select('id,url,active').eq('id', opts.groupId)
  const { data: groups } = await q
  if (!groups?.length) return summary

  for (const g of groups) {
    summary.groups++
    let posts
    try {
      posts = await scrapeFacebookGroup(g.url as string, perGroup)
    } catch (e) {
      summary.errors.push(`${g.url}: ${String(e).slice(0, 120)}`)
      continue
    }
    summary.scanned += posts.length
    if (!posts.length) continue

    // Classe par lots de 12 pour limiter les appels IA.
    const keep: Array<{ post: (typeof posts)[number]; metier: string; zone: string }> = []
    for (const batch of chunk(posts, 12)) {
      const cls = await classifyArtisanPosts(batch.map((p) => ({ authorName: p.authorName, text: p.text })))
      const byIdx = new Map(cls.map((c) => [c.index, c]))
      batch.forEach((post, i) => {
        const c = byIdx.get(i)
        if (c?.is_artisan) keep.push({ post, metier: c.metier, zone: c.zone })
      })
    }
    summary.artisans += keep.length

    for (const { post, metier, zone } of keep) {
      const { phones, emails } = extractContacts(post.text)
      const phone = phones[0] || null
      const email = emails[0] || null

      // Dédoublonnage : même post déjà en base, ou même numéro déjà capté.
      if (post.postUrl) {
        const { data: dupPost } = await db.from('facebook_leads').select('id').eq('post_url', post.postUrl).maybeSingle()
        if (dupPost) continue
      }
      if (phone) {
        const { data: dupPhone } = await db.from('facebook_leads').select('id').eq('phone', phone).maybeSingle()
        if (dupPhone) continue
      }

      const { error } = await db.from('facebook_leads').insert({
        name: post.authorName || null,
        phone,
        email,
        metier: metier || null,
        zone: zone || null,
        is_artisan: true,
        post_text: (post.text || '').slice(0, 2000),
        post_url: post.postUrl,
        group_url: g.url,
        group_title: post.groupTitle,
        posted_at: post.postedAt,
        status: 'to_call',
      })
      if (!error) {
        summary.inserted++
        if (phone) summary.withPhone++
      }
    }

    await db.from('facebook_group_sources').update({ last_scraped_at: new Date().toISOString() }).eq('id', g.id)
  }

  return summary
}
