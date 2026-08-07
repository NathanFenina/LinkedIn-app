import { getServerSupabase } from '@/lib/supabase'
import { rescanHistory } from '@/lib/outreach-runner'
import { errMsg } from '@/lib/utils'
import type { OutreachCampaign } from '@/types'

export const maxDuration = 300

// Re-scanne les conversations LinkedIn et marque "déjà échangé" les cibles
// ratées au sourcing (échanges anciens), sans re-sourcer la campagne.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db.from('outreach_campaigns').select('*').eq('id', id).single()
    if (error) throw error
    const res = await rescanHistory(db, campaign as OutreachCampaign)
    return Response.json({ ok: true, ...res })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
