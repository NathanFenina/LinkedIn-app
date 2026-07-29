import { getServerSupabase } from '@/lib/supabase'
import { extractMemberIdsFromSearchUrl } from '@/lib/unipile'
import { getActiveAccount, getActiveAccountRowId, scopeQueryToAccount } from '@/lib/account'

export async function GET() {
  try {
    const db = getServerSupabase()
    let query = db.from('comment_campaigns').select('*')
    try {
      const account = await getActiveAccount()
      query = scopeQueryToAccount(query, account)
    } catch {}
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// Accepts either an explicit list of member_ids, a pasted LinkedIn search URL
// (fromMember=[...]), or a newline/comma-separated blob of ACoAA... ids.
function parseMembers(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.member_ids)) {
    return (body.member_ids as string[]).map((m) => String(m).trim()).filter(Boolean)
  }
  const raw = String(body.members_input || body.search_url || '')
  const fromUrl = extractMemberIdsFromSearchUrl(raw)
  if (fromUrl.length) return fromUrl
  // Fallback: split a plain list.
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((m) => m.trim())
        .filter((m) => m.startsWith('ACo'))
    )
  )
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name } = body
  const member_ids = parseMembers(body)

  if (!name?.trim()) {
    return Response.json({ error: 'name requis' }, { status: 400 })
  }
  if (member_ids.length === 0) {
    return Response.json(
      { error: 'Aucun membre valide. Colle ton URL de recherche LinkedIn (fromMember) ou des ids ACoAA...' },
      { status: 400 }
    )
  }

  try {
    const db = getServerSupabase()
    const accountRowId = await getActiveAccountRowId().catch(() => null)
    const { data, error } = await db
      .from('comment_campaigns')
      .insert({
        name: name.trim(),
        member_ids,
        daily_cap: Math.max(1, Number(body.daily_cap) || 15),
        max_per_run: Math.max(1, Number(body.max_per_run) || 1),
        min_delay_sec: Math.max(0, Number(body.min_delay_sec) || 180),
        max_delay_sec: Math.max(1, Number(body.max_delay_sec) || 240),
        active_hour_start:
          body.active_hour_start === null || body.active_hour_start === undefined
            ? null
            : Number(body.active_hour_start),
        active_hour_end:
          body.active_hour_end === null || body.active_hour_end === undefined
            ? null
            : Number(body.active_hour_end),
        also_like: body.also_like !== false,
        allow_self_promo: !!body.allow_self_promo,
        instructions: body.instructions?.trim() || null,
        active: true,
        linkedin_account_id: accountRowId,
      })
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
