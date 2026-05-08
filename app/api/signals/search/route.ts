import { getServerSupabase } from '@/lib/supabase'
import { searchLinkedIn } from '@/lib/unipile'
import { getActiveAccount } from '@/lib/account'

export const maxDuration = 300

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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const keywordIds: string[] | undefined = body.keyword_ids
  const datePosted: string = body.date_posted || 'past_week'

  try {
    const db = getServerSupabase()
    const account = await getActiveAccount()
    const ACCOUNT_ID = account.unipile_account_id

    let kwQuery = db.from('signal_keywords').select('*').eq('active', true)
    if (keywordIds && keywordIds.length > 0) kwQuery = kwQuery.in('id', keywordIds)
    const { data: keywords, error } = await kwQuery
    if (error) throw error
    if (!keywords || keywords.length === 0) {
      return Response.json({ found: 0, keywords: 0, errors: ['Aucun mot-clé actif'] })
    }

    let totalFound = 0
    let totalReturned = 0
    const errors: string[] = []
    const sample: unknown[] = []

    for (const kw of keywords) {
      try {
        const { items } = await searchLinkedIn<RawSearchPost>(ACCOUNT_ID, {
          category: 'posts',
          keywords: kw.keyword,
          sort_by: 'date',
          date_posted: datePosted as never,
          limit: 50,
        })

        totalReturned += items.length
        if (sample.length === 0 && items.length > 0) {
          // Capture 1st item shape for debugging
          sample.push(items[0])
        }

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
          if (upErr) {
            errors.push(`upsert ${socialId}: ${upErr.message}`)
          } else {
            totalFound++
          }
        }

        await db
          .from('signal_keywords')
          .update({ last_run_at: new Date().toISOString() })
          .eq('id', kw.id)
      } catch (err) {
        errors.push(`${kw.keyword}: ${String(err)}`)
      }
    }

    return Response.json({
      found: totalFound,
      returned: totalReturned,
      keywords: keywords.length,
      errors: errors.slice(0, 5),
      sample: sample[0] || null,
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
