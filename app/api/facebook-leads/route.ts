import { getServerSupabase } from '@/lib/supabase'

// GET  → liste des leads artisans + groupes sources + compteurs.
// POST → gestion des groupes sources (ajouter / activer / supprimer).
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    const db = getServerSupabase()
    const url = new URL(request.url)
    const status = url.searchParams.get('status') || 'to_call'
    const onlyPhone = url.searchParams.get('phone') === '1'

    let q = db.from('facebook_leads').select('*').order('created_at', { ascending: false }).limit(300)
    if (status !== 'all') q = q.eq('status', status)
    if (onlyPhone) q = q.not('phone', 'is', null)
    const { data: leads } = await q

    const { data: groups } = await db
      .from('facebook_group_sources')
      .select('*')
      .order('created_at', { ascending: true })

    const cnt = async (b: PromiseLike<{ count: number | null }>) => (await b).count || 0
    const [toCall, withPhone, called] = await Promise.all([
      cnt(db.from('facebook_leads').select('id', { count: 'exact', head: true }).eq('status', 'to_call')),
      cnt(db.from('facebook_leads').select('id', { count: 'exact', head: true }).eq('status', 'to_call').not('phone', 'is', null)),
      cnt(db.from('facebook_leads').select('id', { count: 'exact', head: true }).eq('status', 'called')),
    ])

    return Response.json({
      leads: leads || [],
      groups: groups || [],
      counts: { to_call: toCall, with_phone: withPhone, called },
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { op, url, id, active } = body as { op?: string; url?: string; id?: string; active?: boolean }
  try {
    const db = getServerSupabase()
    if (op === 'add_group') {
      if (!url || !/facebook\.com\/groups\//i.test(url)) {
        return Response.json({ error: 'URL de groupe Facebook invalide' }, { status: 400 })
      }
      const { error } = await db.from('facebook_group_sources').upsert({ url: url.trim(), active: true }, { onConflict: 'url' })
      if (error) throw error
      return Response.json({ ok: true })
    }
    if (op === 'toggle_group' && id) {
      const { error } = await db.from('facebook_group_sources').update({ active: !!active }).eq('id', id)
      if (error) throw error
      return Response.json({ ok: true })
    }
    if (op === 'delete_group' && id) {
      const { error } = await db.from('facebook_group_sources').delete().eq('id', id)
      if (error) throw error
      return Response.json({ ok: true })
    }
    return Response.json({ error: 'op inconnu' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
