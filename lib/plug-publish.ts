import { getServerSupabase } from './supabase'
import { createPost, getPost } from './unipile'
import { getSetting, sourceLinkedInAccount } from './crosspost'
import { faithfulParts, publishXPost, xSettings } from './x'
import { geminiCall, parseJson, upsertAction } from './plug'
import { uploadShort, youtubeChannel } from './youtube'

// ---------------------------------------------------------------------------
// PLUG Publish : un post (venu de Second Brain ou créé dans PLUG) planifié sur
// plusieurs réseaux. Au moment prévu, chaque réseau reçoit sa variante de texte
// (variants[réseau], sinon le texte LinkedIn) et le média adapté :
//   linkedin  → Unipile (compte LinkedIn) : texte + images, ou une vidéo
//   instagram → Unipile (compte Instagram choisi dans Cross-post) : image(s) ou vidéo obligatoire
//   x         → publié tout de suite via la file X (x_posts) ; si ça échoue, le cron X le reprend
//   facebook  → page Facebook via l'API Graph (texte, photo ou vidéo) si le jeton de page est enregistré
//   youtube   → Short envoyé via l'API YouTube Data si la chaîne est connectée et que le post a une vidéo
//   tiktok / substack (et YouTube sans vidéo) → marqués « à publier à la main » (texte prêt)
// Option lead_magnet { url, reply } : après publication LinkedIn, crée la campagne
// « commentaire seul » qui répond aux commentateurs avec la ressource.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getServerSupabase>
export const NETWORKS = ['linkedin', 'x', 'instagram', 'facebook', 'youtube', 'tiktok', 'substack'] as const
type Media = { url: string; type?: string }
type Result = { status: 'published' | 'queued' | 'manual' | 'error'; id?: string | null; url?: string | null; error?: string }

export async function publishDue(db: Db): Promise<{ published: number; errors: number }> {
  const { data: due } = await db.from('plug_posts').select('*').eq('status', 'scheduled').lte('scheduled_for', new Date().toISOString()).order('scheduled_for').limit(3)
  let published = 0, errors = 0
  for (const p of due || []) {
    const results: Record<string, Result> = { ...((p.results as Record<string, Result>) || {}) }
    const images = ((p.media as Media[]) || []).filter((m) => !m.type || m.type === 'image').map((m) => m.url)
    const video = ((p.media as Media[]) || []).find((m) => m.type === 'video')
    const variants = (p.variants as Record<string, string>) || {}
    for (const net of (p.networks as string[]) || []) {
      if (results[net]?.status === 'published' || results[net]?.status === 'queued') continue
      const text = variants[net]?.trim() || p.body
      try {
        if (net === 'linkedin') {
          const acc = await sourceLinkedInAccount(db)
          const r = await createPost(acc, text, video ? [video] : images.slice(0, 9))
          results.linkedin = { status: 'published', id: r.post_id, url: r.post_id ? `https://www.linkedin.com/feed/update/urn:li:activity:${r.post_id}/` : null }
        } else if (net === 'instagram') {
          const ig = await getSetting(db, 'crosspost_instagram_account_id')
          if (!ig) throw new Error('Aucun compte Instagram choisi (page Calendrier → Réseaux connectés)')
          if (!images.length && !video) throw new Error('Instagram exige une image ou une vidéo')
          const r = await createPost(ig, text, video ? [video] : images.slice(0, 10))
          results.instagram = { status: 'published', id: r.post_id }
        } else if (net === 'x') {
          const { premium } = await xSettings(db)
          const { data: xp, error } = await db.from('x_posts').insert({
            source_text: text, parts: faithfulParts(text, premium), status: 'approved', kind: 'plug',
            scheduled_for: new Date().toISOString(), approved_at: new Date().toISOString(),
            media: ((p.media as Media[]) || []).map((m) => ({ url: m.url, type: m.type || 'image' })),
          }).select('id').single()
          if (error) throw error
          // Publication immédiate, en même temps que les autres réseaux. En cas d'échec, le post reste
          // validé dans la file X et le cron X le reprendra au prochain créneau.
          try {
            const { ids } = await publishXPost(db, xp.id)
            results.x = { status: 'published', id: ids[0] || xp.id, url: ids[0] ? `https://x.com/i/status/${ids[0]}` : null }
          } catch (e) {
            results.x = { status: 'queued', id: xp.id, error: `Publication X différée : ${String(e).slice(0, 200)}` }
          }
        } else if (net === 'facebook' && (await getSetting(db, 'fb_page_token'))) {
          // Page Facebook via l'API Graph officielle (jeton de page fourni par Nathan).
          const pageId = await getSetting(db, 'fb_page_id')
          const token = await getSetting(db, 'fb_page_token')
          const host = video ? 'graph-video.facebook.com' : 'graph.facebook.com'
          const endpoint = video ? `${pageId}/videos` : images.length ? `${pageId}/photos` : `${pageId}/feed`
          const fields: Record<string, string> = video ? { file_url: video.url, description: text } : images.length ? { url: images[0], caption: text } : { message: text }
          const params = new URLSearchParams({ access_token: token, ...fields })
          const r = await fetch(`https://${host}/v21.0/${endpoint}`, { method: 'POST', body: params })
          const j = await r.json()
          if (!r.ok || j.error) throw new Error(`Facebook : ${JSON.stringify(j.error || j).slice(0, 200)}`)
          results.facebook = { status: 'published', id: j.post_id || j.id || null }
        } else if (net === 'youtube' && video && (await youtubeChannel(db))) {
          // Short YouTube : 1re ligne de la variante = titre, le reste = description.
          const r = await uploadShort(db, video.url, variants.youtube?.trim() || `${(p.title || '').replace(/^#\d+\s*·\s*/, '').split('·')[0].trim()}\n${p.body}`)
          results.youtube = { status: 'published', id: r.id, url: r.url }
        } else {
          // YouTube (posts écrits/images), TikTok et Substack : pas d'API de publication
          // utilisable pour l'instant → texte prêt, à publier à la main.
          results[net] = { status: 'manual' }
        }
      } catch (err) {
        results[net] = { status: 'error', error: String(err).slice(0, 300) }
      }
    }
    const failed = Object.values(results).some((r) => r.status === 'error')
    const now = new Date().toISOString()
    await db.from('plug_posts').update({ results, status: failed ? 'error' : 'published', published_at: now, updated_at: now }).eq('id', p.id)
    if (failed) errors++
    else published++
    const lm = p.lead_magnet as { url?: string; reply?: string } | null
    if (lm?.url && results.linkedin?.status === 'published' && results.linkedin.url) await createLeadMagnet(db, p.title || p.body.slice(0, 60), results.linkedin.url, lm.url, lm.reply)
  }
  return { published, errors }
}

async function createLeadMagnet(db: Db, title: string, postUrl: string, magnetUrl: string, reply?: string) {
  const { data: acc } = await db.from('linkedin_accounts').select('id').order('is_default', { ascending: false }).limit(1).maybeSingle()
  const body = reply?.trim() || 'Merci {prenom} 🙏 Voici la ressource : {magnet_url}\n===\n{prenom}, merci pour ton commentaire ! Tout est ici 👉 {magnet_url}\n===\nAvec plaisir {prenom} 🙌 La ressource est ici : {magnet_url}'
  await db.from('lead_magnet_campaigns').insert({
    name: `PLUG — ${title}`.slice(0, 120), post_url: postUrl, linkedin_account_id: acc?.id || null,
    message_template: body, comment_reply: body, magnet_url: magnetUrl,
    active: true, auto_run: true, comment_only: true, reply_to_comment: true, skip_if_replied: true,
  })
}

// Statistiques des posts LinkedIn publiés via PLUG (pour l'analyse hebdo / Second Brain).
export async function refreshStats(db: Db): Promise<number> {
  const since = new Date(Date.now() - 45 * 86400000).toISOString()
  const { data: posts } = await db.from('plug_posts').select('id, results').eq('status', 'published').gte('published_at', since)
  const acc = await sourceLinkedInAccount(db)
  let n = 0
  for (const p of posts || []) {
    const li = (p.results as Record<string, Result>)?.linkedin
    if (!li?.id) continue
    try {
      const raw = (await getPost(acc, `urn:li:activity:${li.id}`)) as unknown as Record<string, unknown>
      const stats = { reactions: Number(raw.reaction_counter || 0), comments: Number(raw.comment_counter || 0), reposts: Number(raw.repost_counter || 0), impressions: Number(raw.impressions_counter || 0), at: new Date().toISOString() }
      await db.from('plug_posts').update({ stats }).eq('id', p.id)
      n++
    } catch { /* post introuvable : on passe */ }
  }
  return n
}

// ---------------- Groupes Facebook BTP (surveillance, lecture seule) ----------------

const FB_ACTOR = 'apify~facebook-groups-scraper'

type FbPost = { url?: string; postUrl?: string; text?: string; message?: string; time?: string; date?: string; user?: { name?: string; id?: string; profileUrl?: string }; authorName?: string; groupTitle?: string }

export async function generateFbGroups(db: Db, maxGroups = 3): Promise<{ groups: number; posts: number; added: number; error?: string }> {
  const token = process.env.APIFY_TOKEN
  if (!token) return { groups: 0, posts: 0, added: 0, error: 'APIFY_TOKEN manquant' }
  const { data: groups } = await db.from('facebook_group_sources').select('*').eq('active', true).order('last_scraped_at', { ascending: true, nullsFirst: true }).limit(maxGroups)
  const pool: Array<FbPost & { group: string }> = []
  for (const g of groups || []) {
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/${FB_ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=120`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [{ url: g.url }], resultsLimit: 25, viewOption: 'CHRONOLOGICAL', onlyPostsNewerThan: '7 days' }),
      })
      if (res.ok) for (const it of (await res.json()) as FbPost[]) pool.push({ ...it, group: g.title || g.url })
    } catch { /* groupe suivant */ }
    await db.from('facebook_group_sources').update({ last_scraped_at: new Date().toISOString() }).eq('id', g.id)
  }
  const fresh = []
  for (const p of pool) {
    const url = p.url || p.postUrl
    if (!url || !(p.text || p.message)) continue
    const { data } = await db.from('plug_actions').select('id').eq('url', url).maybeSingle()
    if (!data) fresh.push({ ...p, url })
  }
  if (!fresh.length) return { groups: (groups || []).length, posts: pool.length, added: 0 }
  const list = fresh.slice(0, 40).map((p, i) => `#${i} | ${p.user?.name || p.authorName || '?'} | ${p.group}\n${String(p.text || p.message).slice(0, 500).replace(/\n+/g, ' ')}`).join('\n\n')
  const picked = parseJson<Array<{ i: number; need: string; comment: string }>>(await geminiCall(`Tu surveilles des groupes Facebook du BTP pour Nathan Fenina (agence SEO/GEO : visibilité Google et IA, sites qui génèrent des demandes de devis).
Garde UNIQUEMENT les posts d'artisans ou d'entreprises du BTP qui expriment un besoin lié à la visibilité, au manque de clients/chantiers, au site internet, à Google, aux avis ou à la génération de demandes. Exclus les offres d'emploi, la sous-traitance pure, les ventes de matériel, les pubs.
Pour chacun : le besoin en 1 phrase et un commentaire public utile et non commercial (1 à 2 phrases, tutoiement, un vrai conseil, sans lien).
Réponds UNIQUEMENT en JSON : [{"i":0,"need":"...","comment":"..."}]
Posts :
${list}`)) || []
  let added = 0
  for (const k of picked) {
    const p = fresh[k.i]
    if (!p) continue
    const ok = await upsertAction(db, {
      type: 'fb_group', dedupe_key: `fb:${p.url}`, url: p.url, person_name: p.user?.name || p.authorName || null,
      profile_url: p.user?.profileUrl || (p.user?.id ? `https://www.facebook.com/${p.user.id}` : null),
      headline: p.group, title: k.need, context: String(p.text || p.message).slice(0, 700), message: k.comment,
    })
    if (ok) added++
  }
  return { groups: (groups || []).length, posts: pool.length, added }
}
