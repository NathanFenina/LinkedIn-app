import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

// Liste "ne plus contacter" : tag global qui exclut une personne du sourcing de
// TOUTES les campagnes. POST pour ajouter, DELETE pour retirer.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { provider_id, name, reason } = body as { provider_id?: string; name?: string; reason?: string }
  if (!provider_id) return Response.json({ error: 'provider_id manquant' }, { status: 400 })
  try {
    const db = getServerSupabase()
    const { error } = await db.from('do_not_contact').upsert(
      { provider_id, name: name || null, reason: reason || null },
      { onConflict: 'provider_id' }
    )
    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { provider_id } = (await request.json().catch(() => ({}))) as { provider_id?: string }
  if (!provider_id) return Response.json({ error: 'provider_id manquant' }, { status: 400 })
  try {
    const db = getServerSupabase()
    const { error } = await db.from('do_not_contact').delete().eq('provider_id', provider_id)
    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
