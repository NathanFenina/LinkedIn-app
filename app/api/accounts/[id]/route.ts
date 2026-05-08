import { getServerSupabase } from '@/lib/supabase'

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const db = getServerSupabase()

  const updates: Record<string, unknown> = {}
  if (typeof body.label === 'string') updates.label = body.label.trim()
  if (typeof body.unipile_account_id === 'string')
    updates.unipile_account_id = body.unipile_account_id.trim()
  if (typeof body.is_default === 'boolean') updates.is_default = body.is_default

  if (updates.is_default === true) {
    await db.from('linkedin_accounts').update({ is_default: false }).neq('id', id)
  }

  const { data, error } = await db
    .from('linkedin_accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const db = getServerSupabase()
  const { error } = await db.from('linkedin_accounts').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
