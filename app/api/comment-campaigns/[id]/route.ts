import { getServerSupabase } from '@/lib/supabase'

// Whitelist of columns a client is allowed to PATCH.
const EDITABLE = new Set([
  'name',
  'member_ids',
  'post_urls',
  'daily_cap',
  'max_per_run',
  'min_delay_sec',
  'max_delay_sec',
  'active_hour_start',
  'active_hour_end',
  'also_like',
  'allow_self_promo',
  'auto_generate',
  'instructions',
  'active',
])

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db
      .from('comment_campaigns')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error
    // On charge brouillons ET postés SÉPARÉMENT : sinon, quand il y a beaucoup
    // de brouillons récents, ils poussaient les commentaires postés (plus
    // anciens) hors de la limite → compteurs à 0 alors que des commentaires
    // étaient bien partis.
    const [{ data: drafts }, { data: sent }] = await Promise.all([
      db.from('comment_sends').select('*').eq('campaign_id', id).eq('status', 'draft').order('created_at', { ascending: false }).limit(120),
      db.from('comment_sends').select('*').eq('campaign_id', id).eq('status', 'sent').order('created_at', { ascending: false }).limit(60),
    ])
    const sends = [...(drafts || []), ...(sent || [])]
    return Response.json({ campaign, sends })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json()
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE.has(k)) patch[k] = v
  }
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('comment_campaigns')
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
    const { error } = await db.from('comment_campaigns').delete().eq('id', id)
    if (error) throw error
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
