import { getServerSupabase } from '@/lib/supabase'
import { fetchWatch } from '@/lib/plug-watch'
import { errMsg } from '@/lib/utils'

export const maxDuration = 300

// PLUG Veille.
// GET  ?days=7|30 : créateurs suivis + leurs meilleurs posts de la période (triés par score).
// POST { op: 'add', url, name? } | { op: 'remove', id } | { op: 'toggle', id, active }
//      { op: 'save', id, saved } (garder pour le swipe-file) | { op: 'refresh' } (récupère maintenant).
export async function GET(request: Request) {
  const days = Number(new URL(request.url).searchParams.get('days')) || 7
  try {
    const db = getServerSupabase()
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const { data: sources } = await db.from('plug_watch_sources').select('*').order('created_at')
    const { data: posts } = await db.from('plug_watch_posts').select('*').gte('posted_at', since).order('score', { ascending: false }).limit(60)
    const { data: saved } = await db.from('plug_watch_posts').select('*').eq('saved', true).order('posted_at', { ascending: false }).limit(30)
    return Response.json({ sources: sources || [], posts: posts || [], saved: saved || [] })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const db = getServerSupabase()
    if (b.op === 'add' && typeof b.url === 'string' && /linkedin\.com\/in\//i.test(b.url)) {
      const { error } = await db.from('plug_watch_sources').upsert({ url: b.url.split('?')[0].replace(/\/$/, ''), name: (b.name as string) || null, active: true }, { onConflict: 'url' })
      if (error) throw error
    } else if (b.op === 'add') {
      return Response.json({ error: 'Colle l’URL d’un profil LinkedIn (linkedin.com/in/…)' }, { status: 400 })
    } else if (b.op === 'remove' && b.id) {
      await db.from('plug_watch_sources').delete().eq('id', b.id as string)
    } else if (b.op === 'toggle' && b.id) {
      await db.from('plug_watch_sources').update({ active: !!b.active }).eq('id', b.id as string)
    } else if (b.op === 'save' && b.id) {
      await db.from('plug_watch_posts').update({ saved: !!b.saved }).eq('id', b.id as string)
    } else if (b.op === 'refresh') {
      return Response.json({ ok: true, ...(await fetchWatch(db, 6)) })
    }
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
