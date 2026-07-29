import { getServerSupabase } from '@/lib/supabase'
import {
  buildMemberSearchUrl,
  searchPostsBySearchUrl,
  sendPostComment,
  likePost,
  type SearchPost,
} from '@/lib/unipile'
import { generateLinkedInComment } from '@/lib/gemini'
import { getActiveAccountId } from '@/lib/account'
import type { CommentCampaign } from '@/types'

type Db = ReturnType<typeof getServerSupabase>

async function resolveAccountIdForCampaign(
  db: Db,
  linkedin_account_id: string | null
): Promise<string> {
  if (linkedin_account_id) {
    const { data } = await db
      .from('linkedin_accounts')
      .select('unipile_account_id')
      .eq('id', linkedin_account_id)
      .maybeSingle()
    if (data?.unipile_account_id) return data.unipile_account_id
  }
  return getActiveAccountId()
}

// Comptes de commentaires postés aujourd'hui (pour le plafond quotidien).
async function sentTodayCount(db: Db, campaignId: string): Promise<number> {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { count } = await db
    .from('comment_sends')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'sent')
    .gte('created_at', startOfDay.toISOString())
  return count || 0
}

export interface GenerateResult {
  generated: number
  posts_found: number
  skipped_reason?: string
  errors: string[]
}

/**
 * ÉTAPE 1 — Génère des BROUILLONS (status='draft') pour les posts récents des
 * membres, non encore traités. Ne poste RIEN. L'utilisateur les revoit/édite
 * ensuite dans l'UI avant le posting.
 */
export async function generateDrafts(
  db: Db,
  campaign: CommentCampaign,
  opts: { limit?: number } = {}
): Promise<GenerateResult> {
  const errors: string[] = []
  const memberIds: string[] = campaign.member_ids || []
  if (memberIds.length === 0) {
    return { generated: 0, posts_found: 0, skipped_reason: 'Aucun membre', errors }
  }

  const limit = opts.limit ?? 15
  const ACCOUNT_ID = await resolveAccountIdForCampaign(db, campaign.linkedin_account_id)

  // Posts déjà traités (tous statuts : draft, skipped, sent…) → anti-doublon.
  const { data: existing } = await db
    .from('comment_sends')
    .select('post_social_id')
    .eq('campaign_id', campaign.id)
  const doneSet = new Set((existing || []).map((s) => s.post_social_id))

  const searchUrl = buildMemberSearchUrl(memberIds)
  const fresh: SearchPost[] = []
  let cursor: string | undefined = undefined
  let pages = 0
  while (fresh.length < limit && pages < 3) {
    const { items, cursor: next } = await searchPostsBySearchUrl(ACCOUNT_ID, searchUrl, cursor)
    pages++
    for (const p of items) {
      if (!p.social_id) continue
      if (doneSet.has(p.social_id)) continue
      if (fresh.find((f) => f.social_id === p.social_id)) continue
      fresh.push(p)
    }
    if (!next || !items.length) break
    cursor = next
  }

  const selected = fresh.slice(0, limit)
  let generated = 0
  for (const post of selected) {
    let comment = ''
    try {
      comment = await generateLinkedInComment({
        authorName: post.author_name || 'l’auteur',
        postContent: post.post_content,
        allowSelfPromo: campaign.allow_self_promo,
        instructions: campaign.instructions,
      })
    } catch (err) {
      errors.push(`IA ${post.author_name}: ${String(err)}`)
      continue
    }
    if (!comment) continue

    const { error } = await db.from('comment_sends').insert({
      campaign_id: campaign.id,
      post_social_id: post.social_id,
      post_url: post.url,
      author_name: post.author_name,
      author_id: post.author_id,
      post_excerpt: (post.post_content || '').slice(0, 400),
      comment_text: comment,
      status: 'draft',
    })
    if (!error) generated++
  }

  return { generated, posts_found: fresh.length, errors: errors.slice(0, 5) }
}

export interface PostResult {
  posted: number
  pending: number
  remaining_today: number
  skipped_reason?: string
  error?: string
}

/**
 * ÉTAPE 2 — Poste LE PROCHAIN brouillon (le plus ancien non traité). Un seul
 * commentaire par appel : c'est le runner de session (GitHub Actions) qui
 * espace les appels de 3-4 min. Respecte le plafond quotidien et la fenêtre
 * horaire.
 */
export async function postNextDraft(db: Db, campaign: CommentCampaign): Promise<PostResult> {
  // Fenêtre horaire.
  if (campaign.active_hour_start != null && campaign.active_hour_end != null) {
    const h = new Date().getUTCHours()
    const inWindow =
      campaign.active_hour_start <= campaign.active_hour_end
        ? h >= campaign.active_hour_start && h < campaign.active_hour_end
        : h >= campaign.active_hour_start || h < campaign.active_hour_end
    if (!inWindow) {
      return { posted: 0, pending: 0, remaining_today: 0, skipped_reason: 'Hors fenêtre horaire' }
    }
  }

  const sent = await sentTodayCount(db, campaign.id)
  const remainingCap = Math.max(0, (campaign.daily_cap || 15) - sent)

  // Brouillons en attente.
  const { count: pendingCount } = await db
    .from('comment_sends')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'draft')

  if (remainingCap <= 0) {
    return { posted: 0, pending: pendingCount || 0, remaining_today: 0, skipped_reason: `Plafond atteint (${sent}/${campaign.daily_cap})` }
  }

  const { data: draft } = await db
    .from('comment_sends')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('status', 'draft')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!draft) {
    return { posted: 0, pending: 0, remaining_today: remainingCap, skipped_reason: 'Aucun brouillon en attente' }
  }

  const ACCOUNT_ID = await resolveAccountIdForCampaign(db, campaign.linkedin_account_id)

  try {
    await sendPostComment(ACCOUNT_ID, draft.post_social_id, draft.comment_text || '')
    let liked = false
    if (campaign.also_like) {
      try {
        await likePost(ACCOUNT_ID, draft.post_social_id)
        liked = true
      } catch {
        /* like best-effort */
      }
    }
    await db
      .from('comment_sends')
      .update({ status: 'sent', liked, error: null })
      .eq('id', draft.id)
    await db.from('comment_campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', campaign.id)

    const pendingLeft = Math.max(0, (pendingCount || 1) - 1)
    return {
      posted: 1,
      pending: pendingLeft,
      remaining_today: Math.min(pendingLeft, remainingCap - 1),
    }
  } catch (err) {
    await db
      .from('comment_sends')
      .update({ status: 'error', error: String(err).slice(0, 300) })
      .eq('id', draft.id)
    return { posted: 0, pending: Math.max(0, (pendingCount || 1) - 1), remaining_today: remainingCap, error: String(err) }
  }
}
