import { getServerSupabase } from '@/lib/supabase'
import { detectNewPosts, generateVariants, publishToInstagram, getSetting, setSetting, listUnipileAccounts, sourceLinkedInAccount, claudeKey } from '@/lib/crosspost'
import { errMsg } from '@/lib/utils'

export const maxDuration = 120

// GET  ?view=pending|done → posts + réglages + comptes Unipile disponibles.
// POST { op } :
//   detect                       → détection manuelle (+ génération)
//   settings {instagram_account_id?, linkedin_account_id?}
//   regenerate {id}              → régénère les variantes (Claude)
//   update {id, platform, text}  → enregistre le texte édité
//   publish {id, platform:'instagram', text}
//   mark {id, platform:'facebook'|'instagram', status:'done'|'skipped'|'pending'}
export async function GET(request: Request) {
  try {
    const db = getServerSupabase()
    const view = new URL(request.url).searchParams.get('view') || 'pending'
    let q = db.from('cross_posts').select('*').order('posted_at', { ascending: false, nullsFirst: false }).limit(50)
    q = view === 'pending' ? q.or('ig_status.eq.pending,fb_status.eq.pending') : q.not('ig_status', 'eq', 'pending').not('fb_status', 'eq', 'pending')
    const { data: posts } = await q
    const [ig, li] = await Promise.all([getSetting(db, 'crosspost_instagram_account_id'), sourceLinkedInAccount(db)])
    let accounts: Array<{ id: string; type: string; name?: string }> = []
    try { accounts = await listUnipileAccounts() } catch { /* affiché vide */ }
    return Response.json({
      posts: posts || [],
      settings: { instagram_account_id: ig, linkedin_account_id: li, claude: !!claudeKey() },
      accounts,
    })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { op, id } = body as { op?: string; id?: string }
  try {
    const db = getServerSupabase()
    const now = new Date().toISOString()

    if (op === 'detect') {
      const r = await detectNewPosts(db, { limit: 10 })
      return Response.json({ ok: !r.error, ...r })
    }
    if (op === 'settings') {
      if (typeof body.instagram_account_id === 'string') await setSetting(db, 'crosspost_instagram_account_id', body.instagram_account_id)
      if (typeof body.linkedin_account_id === 'string') await setSetting(db, 'crosspost_linkedin_account_id', body.linkedin_account_id)
      return Response.json({ ok: true })
    }
    if (!id) return Response.json({ error: 'id manquant' }, { status: 400 })

    if (op === 'regenerate') {
      const { data: row } = await db.from('cross_posts').select('source_text, source_images').eq('id', id).maybeSingle()
      if (!row) return Response.json({ error: 'introuvable' }, { status: 404 })
      const g = await generateVariants(row.source_text as string, ((row.source_images as string[]) || []).length > 0)
      await db.from('cross_posts').update({ variants: g.variants, generated_at: now, generation_note: g.note || null, updated_at: now }).eq('id', id)
      return Response.json({ ok: true, variants: g.variants, note: g.note })
    }
    if (op === 'update') {
      const { platform, text } = body as { platform?: 'instagram' | 'facebook'; text?: string }
      if (!platform) return Response.json({ error: 'platform manquante' }, { status: 400 })
      const { data: row } = await db.from('cross_posts').select('variants').eq('id', id).maybeSingle()
      const variants = { ...((row?.variants as Record<string, string>) || {}), [platform]: text || '' }
      await db.from('cross_posts').update({ variants, updated_at: now }).eq('id', id)
      return Response.json({ ok: true })
    }
    if (op === 'publish') {
      const { platform, text } = body as { platform?: string; text?: string }
      if (platform !== 'instagram') return Response.json({ error: 'Seul Instagram publie via l’API en v1 ; Facebook = copier-coller' }, { status: 400 })
      if (!text?.trim()) return Response.json({ error: 'Texte vide' }, { status: 400 })
      const { data: row } = await db.from('cross_posts').select('variants').eq('id', id).maybeSingle()
      const variants = { ...((row?.variants as Record<string, string>) || {}), instagram: text }
      await db.from('cross_posts').update({ variants }).eq('id', id)
      try {
        const r = await publishToInstagram(db, id, text.trim())
        return Response.json({ ok: true, post_id: r.post_id })
      } catch (err) {
        await db.from('cross_posts').update({ ig_error: errMsg(err).slice(0, 300), updated_at: now }).eq('id', id)
        throw err
      }
    }
    if (op === 'mark') {
      const { platform, status } = body as { platform?: string; status?: string }
      if (!platform || !status) return Response.json({ error: 'platform/status manquants' }, { status: 400 })
      const patch: Record<string, unknown> = { updated_at: now }
      if (platform === 'facebook') { patch.fb_status = status === 'done' ? 'copied' : status; patch.fb_done_at = status === 'pending' ? null : now }
      else { patch.ig_status = status === 'done' ? 'published' : status; if (status === 'pending') patch.ig_error = null }
      await db.from('cross_posts').update(patch).eq('id', id)
      return Response.json({ ok: true })
    }
    return Response.json({ error: 'op inconnu' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
