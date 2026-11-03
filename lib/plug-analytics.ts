import { getServerSupabase } from './supabase'
import { getOwnProfile, unipileFetch } from './unipile'
import { sourceLinkedInAccount } from './crosspost'
import { geminiCall } from './plug'

// ---------------------------------------------------------------------------
// PLUG Analyse : KPI hebdo et mensuels.
//   Contenu     : posts LinkedIn de la période (réactions, commentaires, partages)
//                 + posts X publiés, comparés à la période précédente.
//   Prospection : messages envoyés via PLUG, réponses, taux par version de
//                 message, invitations envoyées / acceptées, statuts chauds.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getServerSupabase>
type Period = 'week' | 'month'

type LiPost = { text: string; url: string; date: string; reactions: number; comments: number; reposts: number; impressions: number }

function bounds(period: Period, offset = 0) {
  const days = period === 'week' ? 7 : 30
  const end = Date.now() - offset * days * 86400000
  return { start: new Date(end - days * 86400000), end: new Date(end) }
}

async function linkedinPosts(db: Db): Promise<LiPost[]> {
  const acc = await sourceLinkedInAccount(db)
  const me = await getOwnProfile(acc)
  const data = await unipileFetch(`/users/${encodeURIComponent(String(me.provider_id))}/posts?account_id=${encodeURIComponent(acc)}&limit=60`)
  return ((data.items || []) as Array<Record<string, unknown>>)
    .filter((p) => !p.is_repost)
    .map((p) => ({
      text: String(p.text || '').slice(0, 280),
      url: String(p.share_url || ''),
      date: String(p.parsed_datetime || p.date || ''),
      reactions: Number(p.reaction_counter || 0),
      comments: Number(p.comment_counter || 0),
      reposts: Number(p.repost_counter || 0),
      impressions: Number(p.impressions_counter || 0),
    }))
}

function sumPosts(posts: LiPost[]) {
  const n = posts.length
  const reactions = posts.reduce((s, p) => s + p.reactions, 0)
  const comments = posts.reduce((s, p) => s + p.comments, 0)
  const impressions = posts.reduce((s, p) => s + p.impressions, 0)
  return { posts: n, reactions, comments, impressions, avg_engagement: n ? Math.round((reactions + comments * 2) / n) : 0 }
}

async function prospection(db: Db, start: Date, end: Date) {
  const s = start.toISOString(), e = end.toISOString()
  const { data: sent } = await db.from('plug_actions').select('type, template_key, replied_at, tag').eq('status', 'sent').gte('sent_at', s).lt('sent_at', e)
  const { data: tagged } = await db.from('plug_actions').select('tag').gte('updated_at', s).lt('updated_at', e).not('tag', 'is', null)
  const { count: accepted } = await db.from('plug_actions').select('id', { count: 'exact', head: true }).like('dedupe_key', 'engager-dm:%').gte('created_at', s).lt('created_at', e)
  const messages = (sent || []).filter((a) => a.type !== 'engager_invite')
  const byTemplate: Record<string, { sent: number; replies: number }> = {}
  for (const m of messages) {
    const k = m.template_key || 'libre'
    byTemplate[k] = byTemplate[k] || { sent: 0, replies: 0 }
    byTemplate[k].sent++
    if (m.replied_at) byTemplate[k].replies++
  }
  const tags: Record<string, number> = {}
  for (const t of tagged || []) if (t.tag) tags[t.tag] = (tags[t.tag] || 0) + 1
  const replies = messages.filter((m) => m.replied_at).length
  return {
    messages: messages.length, replies, reply_rate: messages.length ? Math.round((replies / messages.length) * 100) : 0,
    invitations: (sent || []).filter((a) => a.type === 'engager_invite').length, accepted: accepted || 0,
    by_template: byTemplate, tags,
  }
}

export async function analytics(db: Db, period: Period, withInsights = false) {
  const cur = bounds(period, 0)
  const prev = bounds(period, 1)
  let all: LiPost[] = []
  let liError: string | null = null
  try { all = await linkedinPosts(db) } catch (err) { liError = String(err).slice(0, 200) }
  const inRange = (p: LiPost, b: { start: Date; end: Date }) => { const t = Date.parse(p.date); return !isNaN(t) && t >= b.start.getTime() && t < b.end.getTime() }
  const curPosts = all.filter((p) => inRange(p, cur)).sort((a, b) => (b.reactions + b.comments * 2) - (a.reactions + a.comments * 2))
  const prevPosts = all.filter((p) => inRange(p, prev))
  const { data: xp } = await db.from('x_posts').select('id').eq('status', 'published').gte('published_at', cur.start.toISOString())
  const { data: pp } = await db.from('plug_posts').select('networks, results').eq('status', 'published').gte('published_at', cur.start.toISOString())
  const perNetwork: Record<string, number> = { linkedin: curPosts.length, x: (xp || []).length }
  for (const p of pp || []) for (const [net, r] of Object.entries((p.results as Record<string, { status: string }>) || {})) if (net !== 'linkedin' && net !== 'x' && r.status === 'published') perNetwork[net] = (perNetwork[net] || 0) + 1

  const result = {
    period, start: cur.start.toISOString(), end: cur.end.toISOString(),
    content: { current: sumPosts(curPosts), previous: sumPosts(prevPosts), top: curPosts.slice(0, 5), flop: curPosts.length > 3 ? curPosts.slice(-2) : [], per_network: perNetwork, error: liError },
    prospection: { current: await prospection(db, cur.start, cur.end), previous: await prospection(db, prev.start, prev.end) },
    insights: null as string | null,
  }
  if (withInsights && curPosts.length) {
    try {
      result.insights = await geminiCall(`Tu analyses les posts LinkedIn de Nathan Fenina (consultant et agence SEO/GEO, expert Claude Code) sur ${period === 'week' ? 'la semaine' : 'le mois'}.
Posts (du plus au moins engageant) :
${curPosts.map((p, i) => `${i + 1}. ${p.reactions} réactions, ${p.comments} commentaires — ${p.text.replace(/\n+/g, ' ')}`).join('\n')}
Période précédente : ${prevPosts.length} posts, ${sumPosts(prevPosts).reactions} réactions au total.
Donne en français, en 5 puces courtes maximum : ce qui a marché (sujets, accroches, formats), ce qui n'a pas marché, et 3 idées concrètes de posts pour la période suivante. N'invente aucun chiffre.`)
    } catch { result.insights = null }
  }
  return result
}
