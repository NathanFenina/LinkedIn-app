import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountRowId } from '@/lib/account'

// Config de l'auto-acceptation des invitations (par compte LinkedIn actif).
export async function GET() {
  try {
    const db = getServerSupabase()
    const accountRowId = await getActiveAccountRowId().catch(() => null)
    if (!accountRowId) return Response.json({ enabled: false, welcome_message: '', daily_cap: 20 })
    const { data } = await db
      .from('auto_accept_config')
      .select('*')
      .eq('linkedin_account_id', accountRowId)
      .maybeSingle()
    return Response.json(
      data || { linkedin_account_id: accountRowId, enabled: false, welcome_message: '', daily_cap: 20 }
    )
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  try {
    const db = getServerSupabase()
    const accountRowId = await getActiveAccountRowId().catch(() => null)
    if (!accountRowId) return Response.json({ error: 'Aucun compte LinkedIn actif' }, { status: 400 })
    const row = {
      linkedin_account_id: accountRowId,
      enabled: !!body.enabled,
      welcome_message: body.welcome_message?.trim() || null,
      daily_cap: Math.max(1, Math.min(50, Number(body.daily_cap) || 20)),
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await db
      .from('auto_accept_config')
      .upsert(row, { onConflict: 'linkedin_account_id' })
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
