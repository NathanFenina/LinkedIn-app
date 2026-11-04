import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'
import { NETWORKS } from '@/lib/plug-publish'
import { FORMATS, STATUS_KEYS, generateVariants } from '@/lib/plug-distribution'

// PLUG Publish — calendrier des posts multi-réseaux.
// GET  ?from=&to= : posts PLUG + posts X planifiés (pour le calendrier) ; avec
//      ?token=CRON_SECRET, sert aussi d'API de lecture pour Second Brain (stats incluses).
// POST : crée ou met à jour un post. Second Brain l'appelle avec ?token=CRON_SECRET :
//   { id?, title?, body, networks?: string[], scheduled_for?: ISO, media?: [{url,type}],
//     lead_magnet?: { url, reply? }, status?: idee|script|a_tourner|monte|draft|scheduled,
//     format?: texte|image|carrousel|video, script?, variants?: { reseau: texte }, source?, external_id? }
//   { id, op: 'delete' } supprime ; { id, op: 'variants' } génère les variantes par réseau (Gemini).
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const from = sp.get('from') || new Date(Date.now() - 7 * 86400000).toISOString()
  const to = sp.get('to') || new Date(Date.now() + 45 * 86400000).toISOString()
  try {
    const db = getServerSupabase()
    const { data: posts } = await db.from('plug_posts').select('*')
      .or(`scheduled_for.gte.${from},scheduled_for.is.null,published_at.gte.${from}`).order('scheduled_for', { ascending: true, nullsFirst: true }).limit(300)
    const { data: xposts } = await db.from('x_posts').select('id, source_text, status, scheduled_for, published_at, kind')
      .in('status', ['approved', 'published']).gte('scheduled_for', from).lte('scheduled_for', to).order('scheduled_for')
    return Response.json({ posts: (posts || []).filter((p) => !p.scheduled_for || p.scheduled_for <= to), xposts: (xposts || []).filter((x) => x.kind !== 'plug') })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const db = getServerSupabase()
    if (b.op === 'delete' && b.id) {
      await db.from('plug_posts').delete().eq('id', b.id as string)
      return Response.json({ ok: true })
    }
    if (b.op === 'variants' && b.id) return Response.json({ ok: true, variants: await generateVariants(db, b.id as string) })
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof b.body === 'string') row.body = b.body
    if (typeof b.title === 'string') row.title = b.title
    if (Array.isArray(b.networks)) row.networks = (b.networks as string[]).filter((n) => (NETWORKS as readonly string[]).includes(n))
    if (b.scheduled_for !== undefined) row.scheduled_for = b.scheduled_for || null
    if (Array.isArray(b.media)) row.media = b.media
    if (b.lead_magnet !== undefined) row.lead_magnet = b.lead_magnet || null
    if (typeof b.status === 'string' && STATUS_KEYS.includes(b.status) && !['published', 'error'].includes(b.status)) row.status = b.status
    if (typeof b.format === 'string' && (FORMATS as readonly string[]).includes(b.format)) row.format = b.format
    if (typeof b.script === 'string') row.script = b.script
    if (b.variants && typeof b.variants === 'object') row.variants = b.variants
    if (typeof b.source === 'string') row.source = b.source
    if (typeof b.external_id === 'string') row.external_id = b.external_id
    if (row.status === 'scheduled' && !row.scheduled_for && !b.id) return Response.json({ error: 'Date de publication requise' }, { status: 400 })
    if (b.id) {
      const { error } = await db.from('plug_posts').update(row).eq('id', b.id as string)
      if (error) throw error
      return Response.json({ ok: true, id: b.id })
    }
    if (!row.body && !row.title) return Response.json({ error: 'Texte ou titre requis' }, { status: 400 })
    if (row.status === 'scheduled' && !row.body) return Response.json({ error: 'Texte requis pour planifier' }, { status: 400 })
    if (!row.body) row.body = '' // idée ou script sans texte encore
    const { data, error } = await db.from('plug_posts').insert(row).select('id').single()
    if (error) throw error
    return Response.json({ ok: true, id: data.id })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
