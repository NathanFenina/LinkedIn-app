// Shared engine for the auto-comment feature (used by the manual /run endpoint
// and by the cron). Faithful port of the n8n "Auto Comments" workflow:
//   feed/search URL → fetch posts (Unipile) → dedup vs what this account already
//   commented → language+mood → strategy → persona comment → like + comment.
import { getServerSupabase } from '@/lib/supabase'
import {
  searchLinkedInByUrl,
  normalizeFeedPost,
  sendPostComment,
  sendPostReaction,
} from '@/lib/unipile'
import {
  detectLanguageAndMood,
  chooseCommentStrategy,
  generateLinkedInComment,
} from '@/lib/gemini'

type DB = ReturnType<typeof getServerSupabase>

export interface PersonaConfig {
  name: string
  identity: string | null
  brand: string
}

export interface AccountContext {
  unipile_account_id: string
  account_row_id: string | null
  persona: PersonaConfig
}

// Resolve the Unipile account_id + persona for a given linkedin_accounts row id.
// Falls back to the first account / env when the row id is missing (cron case).
export async function resolveAccountContext(
  db: DB,
  linkedin_account_id: string | null
): Promise<AccountContext | null> {
  let row:
    | { id: string; unipile_account_id: string; persona_name: string | null; persona_identity: string | null; persona_brand: string | null }
    | null = null

  if (linkedin_account_id) {
    const { data } = await db
      .from('linkedin_accounts')
      .select('id, unipile_account_id, persona_name, persona_identity, persona_brand')
      .eq('id', linkedin_account_id)
      .maybeSingle()
    row = data
  }
  if (!row) {
    const { data } = await db
      .from('linkedin_accounts')
      .select('id, unipile_account_id, persona_name, persona_identity, persona_brand')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    row = data
  }

  if (row?.unipile_account_id) {
    return {
      unipile_account_id: row.unipile_account_id,
      account_row_id: row.id,
      persona: {
        name: row.persona_name || 'moi',
        identity: row.persona_identity,
        brand: row.persona_brand || 'Decupler',
      },
    }
  }
  const env = process.env.LINKEDIN_ACCOUNT_ID
  if (env) {
    return {
      unipile_account_id: env,
      account_row_id: linkedin_account_id,
      persona: { name: 'moi', identity: null, brand: 'Decupler' },
    }
  }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface RunResult {
  posts_found: number
  already_commented: number
  commented: number
  preview: Array<{ post_url: string | null; author: string | null; strategy: string; comment: string }>
  errors: string[]
}

interface RunOptions {
  dryRun?: boolean
  // delay window between two real comments (anti-spam, like the n8n 1-2 min wait).
  // kept short by default so a manual run fits inside the serverless time budget.
  minDelayMs?: number
  maxDelayMs?: number
}

// Type matching the auto_comment_jobs row fields the engine needs.
export interface JobLike {
  id: string
  search_url: string
  like_post: boolean
  max_posts: number
  linkedin_account_id: string | null
}

export async function runAutoCommentJob(
  db: DB,
  job: JobLike,
  ctx: AccountContext,
  options: RunOptions = {}
): Promise<RunResult> {
  const { dryRun = false, minDelayMs = 3000, maxDelayMs = 8000 } = options
  const ACCOUNT_ID = ctx.unipile_account_id
  const accountRowId = ctx.account_row_id
  const maxPosts = Math.max(1, job.max_posts || 5)

  // Posts already handled for THIS account (dedup across the whole account).
  const { data: existing } = await db
    .from('auto_comment_posts')
    .select('post_url')
    .eq('linkedin_account_id', accountRowId)
  const seen = new Set((existing || []).map((r) => r.post_url))

  const result: RunResult = {
    posts_found: 0,
    already_commented: 0,
    commented: 0,
    preview: [],
    errors: [],
  }

  // 1) Walk the feed/search URL until we have enough fresh posts (or run dry).
  const fresh: ReturnType<typeof normalizeFeedPost>[] = []
  let cursor: string | undefined = undefined
  let safety = 0
  while (fresh.length < maxPosts && safety < 10) {
    safety++
    let page: { items: import('@/lib/unipile').RawPost[]; cursor?: string }
    try {
      page = await searchLinkedInByUrl(ACCOUNT_ID, job.search_url, cursor)
    } catch (err) {
      result.errors.push(`search: ${String(err)}`)
      break
    }
    if (!page.items.length) break
    for (const raw of page.items) {
      const p = normalizeFeedPost(raw)
      if (!p.post_url || !p.social_id || !p.text) continue
      result.posts_found++
      if (seen.has(p.post_url)) {
        result.already_commented++
        continue
      }
      seen.add(p.post_url)
      fresh.push(p)
      if (fresh.length >= maxPosts) break
    }
    if (!page.cursor) break
    cursor = page.cursor
  }

  // 2) Generate + post a comment for each fresh post.
  for (let i = 0; i < fresh.length; i++) {
    const p = fresh[i]
    try {
      const { language, mood } = await detectLanguageAndMood(p.text || '')
      const strat = await chooseCommentStrategy({
        personaName: ctx.persona.name,
        brand: ctx.persona.brand,
        postText: p.text || '',
      })
      const raw = await generateLinkedInComment({
        personaName: ctx.persona.name,
        personaIdentity: ctx.persona.identity,
        brand: ctx.persona.brand,
        postText: p.text || '',
        language,
        mood,
        strategy: strat.strategy,
        strategyDescription: strat.description,
        selfReference: strat.self_reference,
      })
      // Clean the comment the same way the n8n "Set comment content" node did:
      // drop NAME placeholder, newlines, markdown chars, collapse spaces.
      const comment = String(raw || '')
        .replace(/NAME/g, p.author_name || '')
        .replace(/\r?\n+/g, ' ')
        .replace(/[*_~`>]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()

      if (!comment) {
        result.errors.push(`${p.post_url}: commentaire vide`)
        continue
      }

      if (dryRun) {
        result.preview.push({
          post_url: p.post_url,
          author: p.author_name,
          strategy: strat.strategy,
          comment,
        })
        continue
      }

      if (job.like_post) {
        try {
          await sendPostReaction(ACCOUNT_ID, p.social_id!, 'like')
        } catch {
          // a failed like shouldn't block the comment
        }
      }
      await sendPostComment(ACCOUNT_ID, p.social_id!, comment)

      await db.from('auto_comment_posts').insert({
        job_id: job.id,
        linkedin_account_id: accountRowId,
        post_url: p.post_url,
        social_id: p.social_id,
        post_author: p.author_name,
        post_content: p.text,
        language,
        mood,
        strategy: `${strat.strategy} — ${strat.description}`.slice(0, 1000),
        comment,
        status: 'posted',
        commented_at: new Date().toISOString(),
      })
      result.commented++

      // Human-like pause before the next comment (skip after the last one).
      if (i < fresh.length - 1) {
        await sleep(minDelayMs + Math.floor(Math.random() * Math.max(0, maxDelayMs - minDelayMs)))
      }
    } catch (err) {
      result.errors.push(`${p.author_name || p.post_url}: ${String(err)}`)
      // Record the failure so it shows in the tracking table and isn't retried blindly.
      await db.from('auto_comment_posts').insert({
        job_id: job.id,
        linkedin_account_id: accountRowId,
        post_url: p.post_url,
        social_id: p.social_id,
        post_author: p.author_name,
        post_content: p.text,
        status: 'rejected',
        error: String(err).slice(0, 500),
      })
    }
  }

  return result
}
