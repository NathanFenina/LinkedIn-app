// Cron: runs every active campaign with auto_run=true.
// Auth: header "Authorization: Bearer ${CRON_SECRET}".
//
// For each campaign:
//   - Resolve the unipile account_id (campaign.linkedin_account_id → fallback first account → fallback env)
//   - Count comments; skip if below min_comments
//   - Walk comments matching trigger_keyword and send the DM (idempotent via lead_magnet_sends UNIQUE)
//
// Designed to fit on Vercel Hobby (single cron entry, all campaigns in one pass).

import { getServerSupabase } from '@/lib/supabase'
import { getPost, getPostComments, startNewChat, extractPostIdFromUrl, normalizeComment } from '@/lib/unipile'

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

async function resolveAccountId(
  db: ReturnType<typeof getServerSupabase>,
  linkedin_account_id: string | null
): Promise<string | null> {
  if (linkedin_account_id) {
    const { data } = await db
      .from('linkedin_accounts')
      .select('unipile_account_id')
      .eq('id', linkedin_account_id)
      .maybeSingle()
    if (data?.unipile_account_id) return data.unipile_account_id
  }
  const { data: first } = await db
    .from('linkedin_accounts')
    .select('unipile_account_id')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (first?.unipile_account_id) return first.unipile_account_id
  return process.env.LINKEDIN_ACCOUNT_ID || null
}

async function runJob() {
  const db = getServerSupabase()
  const { data: campaigns } = await db
    .from('lead_magnet_campaigns')
    .select('*')
    .eq('active', true)
    .eq('auto_run', true)

  if (!campaigns || campaigns.length === 0) {
    return { campaigns: 0, sent: 0, skipped: 0 }
  }

  let sent = 0
  let skipped = 0
  const errors: string[] = []

  for (const campaign of campaigns) {
    try {
      const ACCOUNT_ID = await resolveAccountId(db, campaign.linkedin_account_id)
      if (!ACCOUNT_ID) {
        errors.push(`${campaign.name}: aucun compte LinkedIn disponible`)
        continue
      }

      let socialId = campaign.social_id
      if (!socialId) {
        const extracted = extractPostIdFromUrl(campaign.post_url)
        if (extracted) {
          try {
            const post = await getPost(ACCOUNT_ID, extracted)
            socialId = post.social_id || extracted
          } catch {
            socialId = extracted
          }
          if (socialId) {
            await db
              .from('lead_magnet_campaigns')
              .update({ social_id: socialId })
              .eq('id', campaign.id)
          }
        }
      }
      if (!socialId) {
        errors.push(`${campaign.name}: social_id introuvable`)
        continue
      }

      // min_comments threshold
      if (campaign.min_comments && campaign.min_comments > 0) {
        let count = 0
        let countCursor: string | undefined = undefined
        while (true) {
          const { items, cursor: next } = await getPostComments(
            ACCOUNT_ID,
            socialId,
            countCursor,
            100
          )
          count += items.length
          if (count >= campaign.min_comments || !next || !items.length) break
          countCursor = next
        }
        if (count < campaign.min_comments) {
          skipped++
          continue
        }
      }

      const { data: alreadySent } = await db
        .from('lead_magnet_sends')
        .select('commenter_provider_id')
        .eq('campaign_id', campaign.id)
      const sentSet = new Set(
        (alreadySent || []).map((s) => s.commenter_provider_id)
      )
      const triggerKw = campaign.trigger_keyword?.toLowerCase().trim() || ''

      let cursor: string | undefined = undefined
      while (true) {
        const { items, cursor: next } = await getPostComments(
          ACCOUNT_ID,
          socialId,
          cursor,
          100
        )
        if (!items.length) break
        for (const c of items) {
          const n = normalizeComment(c)
          const providerId = n.commenter_provider_id
          if (!providerId || sentSet.has(providerId)) continue

          const matches = !triggerKw || (n.comment_text || '').toLowerCase().includes(triggerKw)
          if (!matches) continue

          const personalised = campaign.message_template
            .replace(/\{name\}/gi, (n.commenter_name || '').split(' ')[0] || '')
            .replace(/\{magnet_url\}/gi, campaign.magnet_url || '')

          try {
            await startNewChat(ACCOUNT_ID, providerId, personalised)
            await db.from('lead_magnet_sends').insert({
              campaign_id: campaign.id,
              commenter_provider_id: providerId,
              commenter_name: n.commenter_name,
              commenter_profile_url: n.commenter_profile_url,
              comment_text: n.comment_text,
              message_sent: personalised,
            })
            sent++
          } catch (err) {
            errors.push(`${campaign.name} → ${n.commenter_name}: ${String(err)}`)
          }
        }
        if (!next) break
        cursor = next
      }

      await db
        .from('lead_magnet_campaigns')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', campaign.id)
    } catch (err) {
      errors.push(`${campaign.name}: ${String(err)}`)
    }
  }

  return { campaigns: campaigns.length, sent, skipped, errors: errors.slice(0, 5) }
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

export async function GET(request: Request) {
  return POST(request)
}
