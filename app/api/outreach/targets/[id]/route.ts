import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

// Validation manuelle d'une cible : approve / skip, ou édition du score/nom.
// C'est ici que Nathan garde la main : seuls les 'approved' partent en séquence.
const EDITABLE = new Set(['status', 'name', 'score', 'score_reason'])
const ALLOWED_STATUS = new Set(['sourced', 'approved', 'skipped'])

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json()
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) if (EDITABLE.has(k)) patch[k] = v
  if (typeof patch.status === 'string' && !ALLOWED_STATUS.has(patch.status)) {
    return Response.json({ error: 'statut non autorisé' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const { data, error } = await db.from('outreach_targets').update(patch).eq('id', id).select().single()
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
    const { error } = await db.from('outreach_targets').delete().eq('id', id)
    if (error) throw error
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
