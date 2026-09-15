import { getServerSupabase } from '@/lib/supabase'
import { scoreProfile } from '@/lib/gemini'
import { campaignContext } from '@/lib/outreach-runner'
import { errMsg } from '@/lib/utils'
import type { OutreachCampaign } from '@/types'

export const maxDuration = 300

// Re-score les prospects "sourced" d'une campagne avec SA cible (icp) — utile
// après avoir précisé la cible, ou quand la liste a été sourcée avec le contexte
// par défaut. Traite jusqu'à `limit` profils par appel (has_more si reste).
// Body : { limit?: number, min_score_skip?: number } — si min_score_skip est
// donné, les profils scorés en dessous passent directement en 'skipped'.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const limit = Math.min(300, Math.max(1, Number(body.limit) || 200))
  const minSkip = body.min_score_skip == null ? null : Number(body.min_score_skip)
  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db.from('outreach_campaigns').select('*').eq('id', id).single()
    if (error) throw error
    const context = campaignContext(campaign as OutreachCampaign)
    const { data: targets } = await db
      .from('outreach_targets')
      .select('id, name, headline')
      .eq('campaign_id', id)
      .eq('status', 'sourced')
      .is('rescored_at', null)
      .limit(limit)
    let scored = 0, skipped = 0
    for (let i = 0; i < (targets || []).length; i += 20) {
      const chunk = (targets || []).slice(i, i + 20)
      await Promise.all(chunk.map(async (t) => {
        let score = 5, reason = ''
        try {
          const s = await scoreProfile({ name: t.name || '', jobTitle: t.headline || null, myBusinessContext: context })
          score = s.score; reason = s.reason
        } catch { /* garde 5 */ }
        const patch: Record<string, unknown> = { score, score_reason: reason, rescored_at: new Date().toISOString() }
        if (minSkip != null && score < minSkip) { patch.status = 'skipped'; skipped++ }
        await db.from('outreach_targets').update(patch).eq('id', t.id)
        scored++
      }))
    }
    const { count } = await db.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'sourced').is('rescored_at', null)
    return Response.json({ ok: true, scored, skipped, has_more: (count || 0) > 0, remaining: count || 0 })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
