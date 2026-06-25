// Shared engine for the auto-comment feature. Faithful port of the n8n
// "Auto Comments" workflow:
//   feed/search URL → fetch posts (Unipile) → dedup vs what this account already
//   handled → language+mood → strategy → persona comment → like + comment.
//
// Two execution paths share these helpers:
//   - UI (manual, watched): queue + step endpoints drive a client-side loop so
//     each request stays short and the ~3 min wait + a Stop button live in the
//     browser. Posts already published stay logged; the pending queue is resumable.
//   - Cron (unattended): processes a small batch in one pass with short delays.
import { getServerSupabase } from '@/lib/supabase'
import {
  searchLinkedInByUrl,
  normalizeFeedPost,
  sendPostComment,
  sendPostReaction,
  type RawPost,
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
    | {
        id: string
        unipile_account_id: string
        persona_name: string | null
        persona_identity: string | null
        persona_brand: string | null
      }
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

export interface JobLike {
  id: string
  search_url: string
  like_post: boolean
  max_posts: number
  linkedin_account_id: string | null
}

export interface FreshPost {
  social_id: string
  post_url: string
  text: string
  author_name: string | null
}

// Walk the feed/search URL and return up to `limit` posts that this account has
// NOT handled yet (any existing auto_comment_posts row for the account = handled).
export async function fetchFreshPosts(
  db: DB,
  job: JobLike,
  ctx: AccountContext,
  limit: number
): Promise<{ posts: FreshPost[]; found: number; already: number }> {
  const { data: existing } = await db
    .from('auto_comment_posts')
    .select('post_url')
    .eq('linkedin_account_id', ctx.account_row_id)
  const seen = new Set((existing || []).map((r) => r.post_url))

  const posts: FreshPost[] = []
  let found = 0
  let already = 0
  let cursor: string | undefined = undefined
  let safety = 0

  while (posts.length < limit && safety < 10) {
    safety++
    let page: { items: RawPost[]; cursor?: string }
    try {
      page = await searchLinkedInByUrl(ctx.unipile_account_id, job.search_url, cursor)
    } catch {
      break
    }
    if (!page.items.length) break
    for (const raw of page.items) {
      const p = normalizeFeedPost(raw)
      if (!p.post_url || !p.social_id || !p.text) continue
      found++
      if (seen.has(p.post_url)) {
        already++
        continue
      }
      seen.add(p.post_url)
      posts.push({
        social_id: p.social_id,
        post_url: p.post_url,
        text: p.text,
        author_name: p.author_name,
      })
      if (posts.length >= limit) break
    }
    if (!page.cursor) break
    cursor = page.cursor
  }

  return { posts, found, already }
}

export interface GeneratedComment {
  language: string
  mood: string
  strategy: string
  description: string
  comment: string
}

// language+mood → strategy → persona comment, with the same cleaning the n8n
// "Set comment content" node did (NAME placeholder, newlines, markdown, spaces).
export async function generateCommentForPost(
  ctx: AccountContext,
  text: string,
  authorName: string | null
): Promise<GeneratedComment> {
  const { language, mood } = await detectLanguageAndMood(text)
  const strat = await chooseCommentStrategy({
    personaName: ctx.persona.name,
    brand: ctx.persona.brand,
    postText: text,
  })
  const raw = await generateLinkedInComment({
    personaName: ctx.persona.name,
    personaIdentity: ctx.persona.identity,
    brand: ctx.persona.brand,
    postText: text,
    language,
    mood,
    strategy: strat.strategy,
    strategyDescription: strat.description,
    selfReference: strat.self_reference,
  })
  const comment = String(raw || '')
    .replace(/NAME/g, authorName || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/[*_~`>]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { language, mood, strategy: strat.strategy, description: strat.description, comment }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A 429 / throttle / transient error means "retry LATER" (next run), NOT now —
// it lets us keep the post in the queue instead of burning it as 'rejected'.
export function isRetryableError(err: unknown): boolean {
  return /429|too_many_requests|temporarily|rate.?limit|50[234]|ECONNRESET|ETIMEDOUT/i.test(
    String(err)
  )
}

// Only NETWORK / 5xx blips are worth an immediate in-call retry. We deliberately
// do NOT retry a 429 in the moment: hammering a LinkedIn throttle a few seconds
// later just extends the block and risks an automation flag. On 429 we fail fast
// and the post stays in the queue for the next (well-spaced) run.
function isImmediatelyRetryable(err: unknown): boolean {
  return /50[234]|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(String(err))
}

async function callWithRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isImmediatelyRetryable(e) || i === attempts - 1) throw e
      await sleep(4000 * (i + 1))
    }
  }
  throw lastErr
}

// Like (optional) + comment a single post via Unipile, with a small gap between
// the two calls and a retry on transient throttling.
export async function likeAndComment(
  ctx: AccountContext,
  job: JobLike,
  socialId: string,
  comment: string
): Promise<void> {
  if (job.like_post) {
    try {
      await callWithRetry(() => sendPostReaction(ctx.unipile_account_id, socialId, 'like'))
    } catch {
      // a failed like shouldn't block the comment
    }
    await sleep(2500) // breathing room so the like+comment burst doesn't trip 429
  }
  try {
    await callWithRetry(() => sendPostComment(ctx.unipile_account_id, socialId, comment))
  } catch (e) {
    // label the failing action so the in-app log is unambiguous (it's the comment endpoint)
    throw new Error(`commentaire → ${String(e).replace(/^Error:\s*/, '')}`)
  }
}

// Cron path: process a small batch in one pass. Kept under the serverless time
// budget by using short delays (unattended runs don't need the human-like 3 min).
export async function runAutoCommentBatch(
  db: DB,
  job: JobLike,
  ctx: AccountContext
): Promise<{ commented: number; errors: string[] }> {
  const { posts } = await fetchFreshPosts(db, job, ctx, Math.max(1, job.max_posts || 5))
  let commented = 0
  const errors: string[] = []

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i]
    try {
      const gen = await generateCommentForPost(ctx, p.text, p.author_name)
      if (!gen.comment) {
        errors.push(`${p.post_url}: commentaire vide`)
        continue
      }
      await likeAndComment(ctx, job, p.social_id, gen.comment)
      await db.from('auto_comment_posts').insert({
        job_id: job.id,
        linkedin_account_id: ctx.account_row_id,
        post_url: p.post_url,
        social_id: p.social_id,
        post_author: p.author_name,
        post_content: p.text,
        language: gen.language,
        mood: gen.mood,
        strategy: `${gen.strategy} — ${gen.description}`.slice(0, 1000),
        comment: gen.comment,
        status: 'posted',
        commented_at: new Date().toISOString(),
      })
      commented++
      if (i < posts.length - 1) await sleep(4000 + Math.floor(Math.random() * 4000))
    } catch (err) {
      errors.push(`${p.author_name || p.post_url}: ${String(err)}`)
      // Transient (429/5xx): don't persist a row → the post stays "unseen" and
      // is retried on the next run. Genuine error: log it as rejected.
      if (!isRetryableError(err)) {
        await db.from('auto_comment_posts').insert({
          job_id: job.id,
          linkedin_account_id: ctx.account_row_id,
          post_url: p.post_url,
          social_id: p.social_id,
          post_author: p.author_name,
          post_content: p.text,
          status: 'rejected',
          error: String(err).slice(0, 500),
        })
      }
    }
  }
  return { commented, errors }
}
