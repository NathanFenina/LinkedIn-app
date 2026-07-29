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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Db = ReturnType<typeof getServerSupabase>

export interface RunResult {
  dry_run: boolean
  campaign_id: string
  posts_found: number
  comments_posted: number
  remaining_today?: number
  skipped_reason?: string
  preview?: Array<{ author: string; excerpt: string; comment: string; url: string }>
  errors: string[]
}

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

/**
 * Runs a single comment campaign: finds recent posts from the member list,
 * generates a unique comment per post, and posts it (unless dryRun).
 * Enforces the daily cap, per-run batch size, active-hours window and
 * human-like random delays. Anti-doublon via comment_sends.
 */
export async function runCommentCampaign(
  db: Db,
  campaign: CommentCampaign,
  opts: { dryRun?: boolean } = {}
): Promise<RunResult> {
  const dry_run = !!opts.dryRun
  const base = { dry_run, campaign_id: campaign.id, posts_found: 0, comments_posted: 0, errors: [] as string[] }

  const memberIds: string[] = campaign.member_ids || []
  if (memberIds.length === 0) {
    return { ...base, skipped_reason: 'Aucun membre dans la campagne' }
  }

  // Active-hours guard (skip for dry_run).
  if (!dry_run && campaign.active_hour_start != null && campaign.active_hour_end != null) {
    const h = new Date().getUTCHours()
    const inWindow =
      campaign.active_hour_start <= campaign.active_hour_end
        ? h >= campaign.active_hour_start && h < campaign.active_hour_end
        : h >= campaign.active_hour_start || h < campaign.active_hour_end
    if (!inWindow) {
      return {
        ...base,
        skipped_reason: `Hors fenêtre horaire (${campaign.active_hour_start}h–${campaign.active_hour_end}h UTC)`,
      }
    }
  }

  // Daily cap.
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { count: sentToday } = await db
    .from('comment_sends')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'sent')
    .gte('created_at', startOfDay.toISOString())

  const remainingToday = Math.max(0, (campaign.daily_cap || 15) - (sentToday || 0))
  const batchSize = dry_run ? 10 : Math.min(remainingToday, campaign.max_per_run || 3)

  if (!dry_run && batchSize <= 0) {
    return { ...base, skipped_reason: `Plafond quotidien atteint (${sentToday}/${campaign.daily_cap})` }
  }

  const ACCOUNT_ID = await resolveAccountIdForCampaign(db, campaign.linkedin_account_id)

  const { data: alreadyDone } = await db
    .from('comment_sends')
    .select('post_social_id')
    .eq('campaign_id', campaign.id)
  const doneSet = new Set((alreadyDone || []).map((s) => s.post_social_id))

  // Fetch recent posts from the member list (paginate until batch is filled).
  const searchUrl = buildMemberSearchUrl(memberIds)
  const fresh: SearchPost[] = []
  let cursor: string | undefined = undefined
  let pages = 0
  while (fresh.length < batchSize && pages < 3) {
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

  const selected = fresh.slice(0, batchSize)
  if (selected.length === 0) {
    return {
      ...base,
      posts_found: fresh.length,
      skipped_reason: 'Aucun nouveau post à commenter (tous déjà traités ou aucun post <24h)',
    }
  }

  const preview: RunResult['preview'] = []
  const errors: string[] = []
  let posted = 0

  for (let i = 0; i < selected.length; i++) {
    const post = selected[i]
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
    if (!comment) {
      errors.push(`IA ${post.author_name}: commentaire vide`)
      continue
    }

    if (dry_run) {
      preview.push({
        author: post.author_name,
        excerpt: (post.post_content || '').slice(0, 160),
        comment,
        url: post.url,
      })
      continue
    }

    try {
      await sendPostComment(ACCOUNT_ID, post.social_id, comment)
      let liked = false
      if (campaign.also_like) {
        try {
          await likePost(ACCOUNT_ID, post.social_id)
          liked = true
        } catch {
          /* like is best-effort */
        }
      }
      await db.from('comment_sends').insert({
        campaign_id: campaign.id,
        post_social_id: post.social_id,
        post_url: post.url,
        author_name: post.author_name,
        author_id: post.author_id,
        post_excerpt: (post.post_content || '').slice(0, 300),
        comment_text: comment,
        liked,
        status: 'sent',
      })
      posted++
    } catch (err) {
      errors.push(`${post.author_name || post.social_id}: ${String(err)}`)
      await db.from('comment_sends').insert({
        campaign_id: campaign.id,
        post_social_id: post.social_id,
        post_url: post.url,
        author_name: post.author_name,
        author_id: post.author_id,
        post_excerpt: (post.post_content || '').slice(0, 300),
        comment_text: comment,
        status: 'error',
        error: String(err).slice(0, 300),
      })
    }

    // Human-like delay between comments (never after the last one).
    if (i < selected.length - 1) {
      const lo = campaign.min_delay_sec ?? 60
      const hi = Math.max(lo, campaign.max_delay_sec ?? 110)
      const delay = Math.floor(Math.random() * (hi - lo + 1)) + lo
      await sleep(delay * 1000)
    }
  }

  if (!dry_run) {
    await db.from('comment_campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', campaign.id)
  }

  return {
    dry_run,
    campaign_id: campaign.id,
    posts_found: fresh.length,
    comments_posted: posted,
    remaining_today: dry_run ? undefined : Math.max(0, remainingToday - posted),
    preview: dry_run ? preview : undefined,
    errors: errors.slice(0, 5),
  }
}
