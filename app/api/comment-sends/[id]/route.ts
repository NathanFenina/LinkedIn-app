import { getServerSupabase } from '@/lib/supabase'

// Édite un brouillon : modifier le texte, le passer (skip) ou le remettre en
// attente (draft). Seuls ces champs sont modifiables.
const EDITABLE = new Set(['comment_text', 'status'])
const ALLOWED_STATUS = new Set(['draft', 'skipped'])

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json()
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (!EDITABLE.has(k)) continue
    if (k === 'status' && !ALLOWED_STATUS.has(String(v))) continue
    patch[k] = v
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Rien à modifier' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('comment_sends')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
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
    const { error } = await db.from('comment_sends').delete().eq('id', id)
    if (error) throw error
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
