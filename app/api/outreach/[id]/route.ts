import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

const EDITABLE = new Set(['name', 'search_url', 'msg1', 'msg2', 'followup_days', 'daily_cap', 'active'])

// Détail campagne + toutes ses cibles (triées : à valider d'abord, meilleur score en haut).
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db.from('outreach_campaigns').select('*').eq('id', id).single()
    if (error) throw error
    const { data: targets } = await db
      .from('outreach_targets')
      .select('*')
      .eq('campaign_id', id)
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })

    // Historique : est-ce qu'on a déjà échangé avec ce profil ? (match provider_id
    // ↔ contacts.linkedin_id). On attache un aperçu du dernier message pour que
    // Nathan décide de garder ou écarter avant de lancer la séquence.
    const list = (targets || []) as Array<Record<string, unknown>>
    const providerIds = list.map((t) => t.provider_id).filter(Boolean) as string[]
    const historyBy: Record<string, { last_message: string | null; last_message_at: string | null; is_sender_last: boolean; status: string }> = {}
    if (providerIds.length) {
      const { data: contacts } = await db
        .from('contacts')
        .select('linkedin_id, last_message, last_message_at, is_sender_last, status')
        .in('linkedin_id', providerIds)
      for (const c of contacts || []) {
        if (c.linkedin_id) historyBy[c.linkedin_id] = {
          last_message: c.last_message ?? null,
          last_message_at: c.last_message_at ?? null,
          is_sender_last: !!c.is_sender_last,
          status: c.status,
        }
      }
    }
    const enriched = list.map((t) => ({
      ...t,
      history: t.provider_id ? historyBy[t.provider_id as string] || null : null,
    }))

    return Response.json({ campaign, targets: enriched })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json()
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) if (EDITABLE.has(k)) patch[k] = v
  try {
    const db = getServerSupabase()
    const { data, error } = await db.from('outreach_campaigns').update(patch).eq('id', id).select().single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    await db.from('outreach_targets').delete().eq('campaign_id', id)
    const { error } = await db.from('outreach_campaigns').delete().eq('id', id)
    if (error) throw error
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
