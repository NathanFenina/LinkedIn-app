import { getServerSupabase } from '@/lib/supabase'
import { sendLinkedInInvitation } from '@/lib/unipile'
import { generateInvitationMessage } from '@/lib/gemini'
import { getActiveAccountId } from '@/lib/account'

export const maxDuration = 300

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT ||
  "Agence/freelance SEO et acquisition B2B."

const DAILY_QUOTA = 10
const MIN_SCORE = 7

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const dryRun: boolean = body.dry_run === true
  const overrideMin: number =
    typeof body.min_score === 'number' ? body.min_score : MIN_SCORE
  const overrideQuota: number =
    typeof body.quota === 'number' ? body.quota : DAILY_QUOTA

  try {
    const db = getServerSupabase()
    const ACCOUNT_ID = await getActiveAccountId()

    // Count how many invitations went out in the last 24h (safety bumper).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: sentLast24h } = await db
      .from('profile_visitors')
      .select('id', { count: 'exact', head: true })
      .gte('invited_at', since)

    const remaining = Math.max(0, overrideQuota - (sentLast24h || 0))
    if (remaining === 0 && !dryRun) {
      return Response.json({
        sent: 0,
        skipped_reason: `Quota journalier atteint (${overrideQuota} envois sur les 24h).`,
        already_sent_24h: sentLast24h || 0,
      })
    }

    // Pick top scored, not yet invited, not yet contacted.
    const { data: candidates, error } = await db
      .from('profile_visitors')
      .select('*')
      .gte('score', overrideMin)
      .is('invited_at', null)
      .eq('contacted', false)
      .order('score', { ascending: false })
      .order('visited_at', { ascending: false })
      .limit(Math.max(remaining, dryRun ? 50 : 0))
    if (error) throw error

    if (!candidates || candidates.length === 0) {
      return Response.json({
        sent: 0,
        skipped_reason: `Aucun visiteur scoré ≥ ${overrideMin}/10 non invité.`,
      })
    }

    let sent = 0
    const errors: string[] = []
    const preview: Array<{ name: string; score: number; message: string | null }> = []

    for (const v of candidates) {
      if (sent >= remaining && !dryRun) break

      const providerId = v.provider_id || v.linkedin_id
      if (!providerId) {
        errors.push(`${v.name}: pas de provider_id`)
        continue
      }

      // Generate message via AI. Never mention "you visited my profile" —
      // creepy. Just connect on a relevant common interest.
      let message: string | null = null
      try {
        message = await generateInvitationMessage({
          commenterName: v.name || 'là',
          commenterHeadline: v.job_title,
          commentText: v.job_title || '',
          myBusinessContext: DEFAULT_CONTEXT,
        })
      } catch (err) {
        errors.push(`AI message ${v.name}: ${String(err)}`)
        continue
      }

      if (dryRun) {
        preview.push({ name: v.name, score: v.score, message })
        continue
      }

      try {
        await sendLinkedInInvitation(ACCOUNT_ID, providerId, message || undefined)
        await db
          .from('profile_visitors')
          .update({
            invited_at: new Date().toISOString(),
            invitation_message: message,
            contacted: true,
          })
          .eq('id', v.id)
        sent++
      } catch (err) {
        errors.push(`Invite ${v.name}: ${String(err)}`)
      }
    }

    return Response.json({
      dry_run: dryRun,
      sent,
      remaining_quota: Math.max(0, remaining - sent),
      already_sent_24h: sentLast24h || 0,
      candidates: candidates.length,
      preview: dryRun ? preview.slice(0, 10) : undefined,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
