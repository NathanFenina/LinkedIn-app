// Cron endpoint: triggers signal search + IA qualification for all active keywords
// Auth: header "Authorization: Bearer ${CRON_SECRET}"
// Trigger via Vercel Cron (vercel.json) or GitHub Actions

import { getServerSupabase } from '@/lib/supabase'
import { searchLinkedIn } from '@/lib/unipile'
import { qualifySignalPost } from '@/lib/gemini'

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET
const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT ||
  "Agence/freelance SEO et acquisition B2B."

interface RawSearchPost {
  id?: string
  social_id?: string
  share_url?: string
  permalink?: string
  text?: string
  date?: string
  posted_at?: string
  author?: {
    name?: string
    headline?: string
    profile_url?: string
    public_identifier?: string
    provider_id?: string
  }
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

async function runJob() {
  const db = getServerSupabase()
  const { data: keywords } = await db
    .from('signal_keywords')
    .select('*')
    .eq('active', true)
  if (!keywords || keywords.length === 0) {
    return { found: 0, qualified: 0, real: 0, keywords: 0 }
  }

  // Iterate over every connected LinkedIn account. Fallback to env if no row.
  const { data: accounts } = await db
    .from('linkedin_accounts')
    .select('id, unipile_account_id')
  const accountList: { id: string | null; unipile_account_id: string }[] =
    accounts && accounts.length > 0
      ? accounts
      : process.env.LINKEDIN_ACCOUNT_ID
        ? [{ id: null, unipile_account_id: process.env.LINKEDIN_ACCOUNT_ID }]
        : []

  let totalFound = 0
  for (const account of accountList) {
    for (const kw of keywords) {
      try {
        const { items } = await searchLinkedIn<RawSearchPost>(account.unipile_account_id, {
          category: 'posts',
          keywords: kw.keyword,
          sort_by: 'date',
          date_posted: 'past_24h' as never,
          limit: 50,
        })
        for (const post of items) {
          const socialId = post.social_id || post.id
          if (!socialId) continue
          const author = post.author || {}
          const { error: upErr } = await db.from('signal_posts').upsert(
            {
              social_id: socialId,
              post_url: post.share_url || post.permalink || null,
              author_name: author.name || null,
              author_headline: author.headline || null,
              author_profile_url: author.profile_url || null,
              author_provider_id: author.provider_id || author.public_identifier || null,
              content: post.text || null,
              posted_at: safeTimestamp(post.posted_at) || safeTimestamp(post.date),
              matched_keyword: kw.keyword,
              status: 'new',
              linkedin_account_id: account.id,
            },
            { onConflict: 'social_id', ignoreDuplicates: true }
          )
          if (!upErr) totalFound++
        }
        await db
          .from('signal_keywords')
          .update({ last_run_at: new Date().toISOString() })
          .eq('id', kw.id)
      } catch (err) {
        console.error(`Cron signals search ${kw.keyword}:`, err)
      }
    }
  }

  // Auto-qualify new posts
  const { data: unqualified } = await db
    .from('signal_posts')
    .select('*')
    .is('is_real_signal', null)
    .limit(50)

  let qualified = 0
  let real = 0
  if (unqualified) {
    for (const p of unqualified) {
      try {
        if (!p.content) continue
        const result = await qualifySignalPost({
          authorName: p.author_name || 'Anonyme',
          authorHeadline: p.author_headline,
          content: p.content,
          matchedKeyword: p.matched_keyword || '',
          context: DEFAULT_CONTEXT,
        })
        await db
          .from('signal_posts')
          .update({
            is_real_signal: result.is_real_signal,
            qualification_reason: result.reason,
            status: result.is_real_signal ? 'qualified' : 'ignored',
          })
          .eq('id', p.id)
        qualified++
        if (result.is_real_signal) real++
      } catch (err) {
        console.error('Cron qualify:', err)
      }
    }
  }

  return { found: totalFound, qualified, real, keywords: keywords.length }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runJob()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// Allow GET for ease (e.g., browser test) — same auth
export async function GET(request: Request) {
  return POST(request)
}
