import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'
import { unipileFetch, getOwnProfile } from '@/lib/unipile'
import { scoreProfile } from '@/lib/gemini'
import { campaignContext, companyFromHeadline, sweepChats } from '@/lib/outreach-runner'
import { errMsg } from '@/lib/utils'
import type { OutreachCampaign } from '@/types'

// ENGAGEURS DE MES POSTS : récupère les personnes qui ont RÉAGI ou COMMENTÉ les
// posts de Nathan (posts ≥ min_reactions, des `days` derniers jours), garde les
// DÉCIDEURS (CEO, fondateur, directeur, responsable, head of, CMO…), NETTOIE
// (déjà en conversation = gens connus, clients/prospects, ne plus contacter,
// déjà contactés par une campagne, consultants/agences SEO, freelances,
// étudiants), SCORE avec l'IA sur l'ICP de la campagne, puis insère en
// 'sourced' (à valider) avec le sujet du post en contexte ({sujet}).
// Avance par lots (une page de réactions par appel), position mémorisée.
export const maxDuration = 300

const DECIDEUR = /(\bceo\b|fondat|founder|co-?fond|dirigeant|pr[ée]sident|directeur|directrice|director|head of|responsable|\bcmo\b|\bcto\b|\bcoo\b|\bcfo\b|chief|\bvp\b|vice[- ]pr[ée]sident|g[ée]rant|associ[ée]|managing|owner|partner)/i
const EXCLU = /(freelance|ind[ée]pendant|consultant|\bseo\b|r[ée]f[ée]rencement|\bsea\b|growth hack|agence (web|digitale|marketing|seo|sea|de communication)|[ée]tudiant|stagiaire|alternan|open to work|en recherche|retrait|coach|formateur|formatrice|recruteur|talent acquisition|ghostwriter|copywriter)/i

type Engager = { id: string; name: string; headline: string; distance: string; how: 'réaction' | 'commentaire' }
type State = { posts: Array<{ id: string; topic: string }>; postIdx: number; phase: 'reactions' | 'comments'; cursor?: string | null }

function pickAuthor(it: Record<string, unknown>): Engager | null {
  const a = ((it.author_details || it.author || it.actor || it) as Record<string, unknown>) || {}
  const id = String(a.id || a.provider_id || '')
  const name = String((typeof it.author === 'string' ? it.author : '') || a.name || [a.first_name, a.last_name].filter(Boolean).join(' ') || '')
  if (!id || !name || a.is_company === true || a.type === 'COMPANY') return null
  return { id, name, headline: String(a.headline || a.occupation || ''), distance: String(a.network_distance || ''), how: 'réaction' }
}
// Sujet lisible : gras/italique unicode → texte normal (NFKC), sans emoji,
// première ligne, coupé proprement.
const topicOf = (text: string) => {
  const line = (text || '').normalize('NFKC').replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '').split('\n').map((l) => l.trim()).find((l) => l.length > 8) || ''
  const first = line.split(/(?<=[.!?…])\s/)[0]
  return first.length > 80 ? first.slice(0, 80).replace(/\s+\S*$/, '') + '…' : first
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const minReactions = Number(body.min_reactions ?? 100)
  const days = Number(body.days ?? 90)
  const maxPosts = Math.min(10, Number(body.max_posts ?? 5))
  const maxScore = Math.min(40, Number(body.max_candidates ?? 30))
  const reset = !!body.reset
  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db.from('outreach_campaigns').select('*').eq('id', id).single()
    if (error) throw error
    const acc = await getActiveAccountId()
    const key = `engagers_state_${id}`
    const { data: st } = await db.from('app_settings').select('value').eq('key', key).maybeSingle()
    let state: State | null = null
    try { state = reset ? null : JSON.parse(st?.value || 'null') } catch { state = null }

    // 1) Choix des posts (une fois) : mes posts récents au-dessus du seuil de réactions.
    if (!state) {
      const me = await getOwnProfile(acc)
      const data = await unipileFetch(`/users/${encodeURIComponent(String(me.provider_id))}/posts?account_id=${encodeURIComponent(acc)}&limit=40`)
      const since = Date.now() - days * 86400000
      const posts = ((data.items || []) as Array<Record<string, unknown>>)
        .filter((p) => !p.is_repost && Number(p.reaction_counter || 0) >= minReactions)
        .filter((p) => { const d = Date.parse(String(p.parsed_datetime || p.date || '')); return isNaN(d) || d >= since })
        .sort((a, b) => Number(b.reaction_counter || 0) - Number(a.reaction_counter || 0))
        .slice(0, maxPosts)
        .map((p) => ({ id: String(p.social_id || p.id), topic: topicOf(String(p.text || '')) }))
      if (!posts.length) return Response.json({ ok: true, done: true, reason: `Aucun post ≥ ${minReactions} réactions sur ${days} jours` })
      state = { posts, postIdx: 0, phase: 'reactions', cursor: null }
    }
    if (state.postIdx >= state.posts.length) return Response.json({ ok: true, done: true, reason: 'Tous les posts ont été traités' })

    // 2) Une page d'engageurs du post courant.
    const post = state.posts[state.postIdx]
    const path = state.phase === 'reactions' ? 'reactions' : 'comments'
    const qs = new URLSearchParams({ account_id: acc, limit: '100' })
    if (state.cursor) qs.set('cursor', state.cursor)
    const page = await unipileFetch(`/posts/${encodeURIComponent(post.id)}/${path}?${qs}`)
    const items = (page.items || []) as Array<Record<string, unknown>>
    const people = items.map(pickAuthor).filter(Boolean).map((e) => ({ ...(e as Engager), how: state!.phase === 'reactions' ? 'réaction' as const : 'commentaire' as const }))
    const nextCursor = (page.cursor as string | undefined) || null

    // 3) Décideurs uniquement, puis nettoyage.
    const stats = { engageurs: people.length, decideurs: 0, connus_ou_deja: 0, ajoutes: 0 }
    const cands = people.filter((p) => DECIDEUR.test(p.headline) && !EXCLU.test(p.headline))
    stats.decideurs = cands.length
    const ids = cands.map((c) => c.id)
    const known = new Set<string>()
    if (ids.length) {
      const [t, c, d, l] = await Promise.all([
        db.from('outreach_targets').select('provider_id').in('provider_id', ids),
        db.from('contacts').select('linkedin_id, status, chat_id').in('linkedin_id', ids),
        db.from('do_not_contact').select('provider_id').in('provider_id', ids),
        db.from('lead_magnet_sends').select('commenter_provider_id').in('commenter_provider_id', ids).not('message_sent', 'like', '[%'),
      ])
      ;(t.data || []).forEach((r) => known.add(r.provider_id as string))
      // Contact connu = conversation existante, ou statut client / prospect / ne plus contacter.
      ;(c.data || []).forEach((r) => { if (r.chat_id || ['client', 'prospect', 'do_not_contact', 'in_progress'].includes(r.status as string)) known.add(r.linkedin_id as string) })
      ;(d.data || []).forEach((r) => known.add(r.provider_id as string))
      ;(l.data || []).forEach((r) => known.add(r.commenter_provider_id as string))
      // Déjà reçu le message de bienvenue (invitation acceptée).
      const { data: acc2 } = await db.from('accepted_invites').select('provider_id').in('provider_id', ids)
      ;(acc2 || []).forEach((r) => known.add(r.provider_id as string))
      // Conversations LinkedIn récentes (source la plus fiable des « gens connus »).
      try { const chats = await sweepChats(acc, 6); ids.forEach((i) => { if (chats.has(i)) known.add(i) }) } catch { /* sans */ }
    }
    const fresh = cands.filter((c) => !known.has(c.id)).slice(0, maxScore)
    stats.connus_ou_deja = cands.length - cands.filter((c) => !known.has(c.id)).length

    // 4) Score IA sur l'ICP de la campagne + insertion « à valider ».
    const added: Array<{ name: string; headline: string; score: number }> = []
    for (const p of fresh) {
      const s = await scoreProfile({ name: p.name, jobTitle: p.headline, myBusinessContext: campaignContext(campaign as OutreachCampaign) })
      if (s.score < 5) continue // hors cible selon l'IA
      const company = companyFromHeadline(p.headline)
      const { error: insErr } = await db.from('outreach_targets').insert({
        campaign_id: id, provider_id: p.id, name: p.name, headline: p.headline, company,
        score: s.score, score_reason: `${p.how === 'réaction' ? 'A réagi' : 'A commenté'} : « ${post.topic} » · ${p.distance === 'DISTANCE_1' ? '1er degré' : p.distance ? '2e/3e degré' : ''} · ${s.reason}`,
        status: 'sourced', context: post.topic,
        // 1er degré : déjà en relation → message direct après validation, sans invitation.
        connected_at: p.distance === 'DISTANCE_1' ? new Date().toISOString() : null,
      })
      if (!insErr) { stats.ajoutes++; added.push({ name: p.name, headline: p.headline, score: s.score }) }
    }

    // 5) Position suivante : page suivante, puis commentaires, puis post suivant.
    if (nextCursor && items.length) state.cursor = nextCursor
    else if (state.phase === 'reactions') { state.phase = 'comments'; state.cursor = null }
    else { state.postIdx++; state.phase = 'reactions'; state.cursor = null }
    await db.from('app_settings').upsert({ key, value: JSON.stringify(state) }, { onConflict: 'key' })
    return Response.json({ ok: true, done: state.postIdx >= state.posts.length, post: post.topic, phase: path, ...stats, added })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
