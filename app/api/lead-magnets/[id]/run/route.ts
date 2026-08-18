import { getServerSupabase } from '@/lib/supabase'
import { getPostComments, startNewChat, normalizeComment, resolvePostSocialId } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'
import { guard } from '@/lib/limits'
import { extractFirstName } from '@/lib/gemini'

export const maxDuration = 300

async function resolveAccountIdForCampaign(
  db: ReturnType<typeof getServerSupabase>,
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

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const { dry_run = false } = await request.json().catch(() => ({}))

  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db
      .from('lead_magnet_campaigns')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !campaign) {
      return Response.json({ error: 'Campagne non trouvée' }, { status: 404 })
    }

    const ACCOUNT_ID = await resolveAccountIdForCampaign(db, campaign.linkedin_account_id)

    // Résout le social_id CANONIQUE (urn:li:activity:...). Un social_id stocké
    // en urn:li:share:... (numéro différent de l'activity) renvoie 0 commentaire,
    // donc on re-résout via getPost et on ré-écrit le bon en base.
    const socialId = await resolvePostSocialId(ACCOUNT_ID, campaign.social_id, campaign.post_url)
    if (!socialId) {
      return Response.json({ error: 'Impossible d\'extraire le social_id du post' }, { status: 400 })
    }
    if (socialId !== campaign.social_id) {
      await db.from('lead_magnet_campaigns').update({ social_id: socialId }).eq('id', id)
    }

    // Already-processed commenters (anti-doublon)
    const { data: alreadySent } = await db
      .from('lead_magnet_sends')
      .select('commenter_provider_id')
      .eq('campaign_id', id)
    const sentSet = new Set((alreadySent || []).map((s) => s.commenter_provider_id))

    // Walk all comments
    let cursor: string | undefined = undefined
    let commentsScanned = 0
    let triggeredMatches = 0
    let messagesSent = 0
    const errors: string[] = []
    const previewSends: Array<{ name: string | null; comment: string | null }> = []

    const triggerKw = campaign.trigger_keyword?.toLowerCase().trim() || ''

    // First pass: count comments to enforce min_comments threshold.
    if (campaign.min_comments && campaign.min_comments > 0) {
      let count = 0
      let countCursor: string | undefined = undefined
      while (true) {
        const { items, cursor: next } = await getPostComments(ACCOUNT_ID, socialId, countCursor, 100)
        count += items.length
        if (count >= campaign.min_comments || !next || !items.length) break
        countCursor = next
      }
      if (count < campaign.min_comments) {
        return Response.json({
          dry_run,
          comments_scanned: count,
          matches: 0,
          messages_sent: 0,
          skipped_reason: `Seulement ${count} commentaires (seuil: ${campaign.min_comments})`,
        })
      }
    }

    while (true) {
      const { items, cursor: next } = await getPostComments(ACCOUNT_ID, socialId, cursor, 100)
      if (!items.length) break
      for (const c of items) {
        commentsScanned++
        const n = normalizeComment(c)
        const providerId = n.commenter_provider_id
        if (!providerId) continue
        if (sentSet.has(providerId)) continue

        const matchesTrigger = !triggerKw || (n.comment_text || '').toLowerCase().includes(triggerKw)
        if (!matchesTrigger) continue
        triggeredMatches++

        if (dry_run) {
          previewSends.push({ name: n.commenter_name, comment: n.comment_text })
          continue
        }

        const quickFirst = (n.commenter_name || '').split(' ')[0] || ''
        const prenom = /\{prenom\}/i.test(campaign.message_template)
          ? (await extractFirstName(n.commenter_name || '')) || quickFirst
          : quickFirst
        const personalised = campaign.message_template
          .replace(/\{prenom\}/gi, prenom)
          .replace(/\{name\}/gi, quickFirst)
          .replace(/\{magnet_url\}/gi, campaign.magnet_url || '')

        const g = await guard(db, ACCOUNT_ID, 'dm')
        if (!g.allowed) {
          errors.push(g.reason || 'Plafond messages atteint')
          break // blocage dur
        }
        try {
          await startNewChat(ACCOUNT_ID, providerId, personalised)
          await db.from('lead_magnet_sends').insert({
            campaign_id: id,
            commenter_provider_id: providerId,
            commenter_name: n.commenter_name,
            commenter_profile_url: n.commenter_profile_url,
            comment_text: n.comment_text,
            message_sent: personalised,
          })
          messagesSent++
        } catch (err) {
          errors.push(`${n.commenter_name || providerId}: ${String(err)}`)
        }
      }
      if (!next) break
      cursor = next
    }

    if (!dry_run) {
      await db.from('lead_magnet_campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', id)
    }

    return Response.json({
      dry_run,
      comments_scanned: commentsScanned,
      matches: triggeredMatches,
      messages_sent: messagesSent,
      preview: dry_run ? previewSends.slice(0, 20) : undefined,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
