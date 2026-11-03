import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'
import { SENDABLE, type ActionType } from '@/lib/plug'

// Actions de Nathan sur une carte PLUG.
// body { op: 'send' | 'save' | 'later' | 'dismiss' | 'done' | 'reopen' | 'tag' | 'note', message?, tag?, note? }
// 'send' met l'action en file (status queued) : le cron plug-send l'envoie, espacée.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = (await request.json().catch(() => ({}))) as { op?: string; message?: string; tag?: string | null; note?: string | null }
  try {
    const db = getServerSupabase()
    const { data: a } = await db.from('plug_actions').select('id, type, status').eq('id', id).maybeSingle()
    if (!a) return Response.json({ error: 'Action introuvable' }, { status: 404 })
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.message === 'string') patch.message = body.message
    switch (body.op) {
      case 'send':
        if (!SENDABLE.includes(a.type as ActionType)) return Response.json({ error: 'Cette carte se traite à la main (Ouvrir puis Fait)' }, { status: 400 })
        if (a.type !== 'engager_invite' && !String(body.message ?? '').trim()) {
          const { data: cur } = await db.from('plug_actions').select('message').eq('id', id).maybeSingle()
          if (!String(cur?.message || '').trim()) return Response.json({ error: 'Message vide' }, { status: 400 })
        }
        patch.status = 'queued'
        patch.error = null
        break
      case 'save': break
      case 'later': patch.status = 'later'; break
      case 'dismiss': patch.status = 'dismissed'; break
      case 'done': patch.status = 'done'; break
      case 'reopen': patch.status = 'todo'; break
      case 'tag': patch.tag = body.tag || null; break
      case 'note': patch.note = body.note || null; break
      default: return Response.json({ error: 'op inconnue' }, { status: 400 })
    }
    const { error } = await db.from('plug_actions').update(patch).eq('id', id)
    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
