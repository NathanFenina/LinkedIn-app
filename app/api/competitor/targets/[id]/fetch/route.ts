import { getServerSupabase } from '@/lib/supabase'
import { getPost, getPostComments, extractPostIdFromUrl } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'

export const maxDuration = 300

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data: target, error } = await db
      .from('competitor_targets')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !target) {
      return Response.json({ error: 'Target non trouvé' }, { status: 404 })
    }

    let ACCOUNT_ID: string
    if (target.linkedin_account_id) {
      const { data: acc } = await db
        .from('linkedin_accounts')
        .select('unipile_account_id')
        .eq('id', target.linkedin_account_id)
        .maybeSingle()
      ACCOUNT_ID = acc?.unipile_account_id || (await getActiveAccountId())
    } else {
      ACCOUNT_ID = await getActiveAccountId()
    }

    // Re-extract if missing, OR if stored social_id looks stale (raw numeric
    // for a share/ugcPost URL — legacy rows from before the URN fix).
    const looksStale = (id: string | null, url: string): boolean => {
      if (!id) return true
      if (id.startsWith('urn:li:')) return false
      // bare numeric stored, but URL is share/ugcPost → must be re-extracted
      return /\/(posts)\//i.test(url) && /(share|ugcPost)/i.test(url)
    }

    let socialId = target.social_id
    if (looksStale(socialId, target.post_url)) {
      const extracted = extractPostIdFromUrl(target.post_url)
      if (extracted) {
        try {
          const post = await getPost(ACCOUNT_ID, extracted)
          socialId = post.social_id || extracted
        } catch {
          socialId = extracted
        }
      }
      if (socialId) {
        await db.from('competitor_targets').update({ social_id: socialId }).eq('id', id)
      }
    }
    if (!socialId) {
      return Response.json({ error: "Impossible d'extraire le social_id" }, { status: 400 })
    }

    let cursor: string | undefined = undefined
    let scanned = 0
    let stored = 0
    let skippedNoId = 0
    let sampleComment: unknown = null
    const errors: string[] = []

    while (true) {
      const { items, cursor: next } = await getPostComments(ACCOUNT_ID, socialId, cursor, 100)
      if (!items.length) break
      for (const c of items) {
        scanned++
        if (!sampleComment) sampleComment = c
        // Unipile field names vary by provider version; try several.
        const author = (c.author || {}) as Record<string, unknown>
        const providerId =
          (author.provider_id as string | undefined) ||
          (author.public_identifier as string | undefined) ||
          (author.id as string | undefined) ||
          ((c as Record<string, unknown>).provider_id as string | undefined) ||
          ((c as Record<string, unknown>).author_id as string | undefined) ||
          null
        if (!providerId) {
          skippedNoId++
          continue
        }

        const { error: upErr } = await db.from('competitor_leads').upsert(
          {
            target_id: id,
            commenter_provider_id: providerId,
            commenter_name: (author.name as string | undefined) || null,
            commenter_headline: (author.headline as string | undefined) || null,
            commenter_profile_url: (author.profile_url as string | undefined) || null,
            comment_text: c.text || null,
            commented_at: c.date || null,
            status: 'new',
          },
          { onConflict: 'target_id,commenter_provider_id', ignoreDuplicates: true }
        )
        if (upErr) errors.push(`${providerId}: ${upErr.message}`)
        else stored++
      }
      if (!next) break
      cursor = next
    }

    await db
      .from('competitor_targets')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', id)

    return Response.json({
      scanned,
      stored,
      skipped_no_id: skippedNoId,
      sample: sampleComment,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
