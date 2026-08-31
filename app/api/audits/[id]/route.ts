import { getServerSupabase } from '@/lib/supabase'

// PATCH : met à jour une cible (choix du contact, édition manuelle, statut…).
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const allowed = [
    'company',
    'audit_url',
    'provider_id',
    'contact_name',
    'contact_headline',
    'contact_profile_url',
    'status',
  ] as const
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of allowed) if (k in body) update[k] = body[k]
  try {
    const db = getServerSupabase()
    const { error } = await db.from('audit_targets').update(update).eq('id', id)
    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { error } = await db.from('audit_targets').delete().eq('id', id)
    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
