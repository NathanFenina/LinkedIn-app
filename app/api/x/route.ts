import { getServerSupabase } from '@/lib/supabase'
import { setSetting, claudeKey } from '@/lib/crosspost'
import { xAccount, xSettings, xPrices, monthSpend, publishedToday, importLinkedInPosts, generateXParts, faithfulParts, publishXPost } from '@/lib/x'
import { errMsg } from '@/lib/utils'

export const maxDuration = 300

// GET ?view=draft|approved|done → posts + état du compte + réglages.
// POST { op } :
//   import {archive?:boolean}       → importe les posts LinkedIn (nouveaux ou archive)
//   generate {id}                   → reformule avec l'IA (Claude, sinon Gemini)
//   faithful {id}                   → version fidèle (texte d'origine découpé, sans IA)
//   update {id, parts:string[]}     → enregistre le texte édité
//   approve {id} / reject {id} / reset {id}
//   publish {id}                    → publie tout de suite
//   settings {max_per_day?, monthly_cap_usd?, premium?}
export async function GET(request: Request) {
  try {
    const db = getServerSupabase()
    const view = new URL(request.url).searchParams.get('view') || 'draft'
    let q = db.from('x_posts').select('*').limit(60)
    if (view === 'draft') q = q.eq('status', 'draft').order('kind', { ascending: false }).order('reactions', { ascending: false })
    else if (view === 'approved') q = q.eq('status', 'approved').order('approved_at', { ascending: true })
    else q = q.in('status', ['published', 'rejected', 'error']).order('updated_at', { ascending: false })
    const { data: posts } = await q
    const [account, settings, prices, spent, today] = await Promise.all([xAccount(db), xSettings(db), xPrices(db), monthSpend(db), publishedToday(db)])
    const { data: counts } = await db.from('x_posts').select('status')
    const by: Record<string, number> = {}
    for (const c of counts || []) by[c.status as string] = (by[c.status as string] || 0) + 1
    return Response.json({
      posts: posts || [], account, settings, prices, spent, today, counts: by,
      env: { client: !!process.env.X_CLIENT_ID && !!process.env.X_CLIENT_SECRET, claude: !!claudeKey() },
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
    if (op === 'import') {
      const r = await importLinkedInPosts(db, { archive: !!body.archive, days: body.days != null ? Number(body.days) : undefined, limit: body.limit != null ? Number(body.limit) : undefined, maxPages: 4 })
      return Response.json({ ok: true, ...r })
    }
    if (op === 'settings') {
      const cur = await xSettings(db)
      const next = {
        max_per_day: body.max_per_day != null ? Math.max(0, Math.min(10, Number(body.max_per_day))) : cur.max_per_day,
        monthly_cap_usd: body.monthly_cap_usd != null ? Math.max(0, Number(body.monthly_cap_usd)) : cur.monthly_cap_usd,
        premium: body.premium != null ? !!body.premium : cur.premium,
      }
      await setSetting(db, 'x_settings', JSON.stringify(next))
      return Response.json({ ok: true, settings: next })
    }
    if (op === 'disconnect') {
      await setSetting(db, 'x_tokens', '')
      return Response.json({ ok: true })
    }
    if (!id) return Response.json({ error: 'id manquant' }, { status: 400 })

    if (op === 'generate') {
      const { data: row } = await db.from('x_posts').select('source_text').eq('id', id).maybeSingle()
      if (!row) return Response.json({ error: 'introuvable' }, { status: 404 })
      const g = await generateXParts(row.source_text as string, (await xSettings(db)).premium)
      await db.from('x_posts').update({ parts: g.parts, updated_at: now }).eq('id', id)
      return Response.json({ ok: true, parts: g.parts, note: g.note })
    }
    if (op === 'faithful') {
      const { data: row } = await db.from('x_posts').select('source_text').eq('id', id).maybeSingle()
      if (!row) return Response.json({ error: 'introuvable' }, { status: 404 })
      const parts = faithfulParts(row.source_text as string, (await xSettings(db)).premium)
      await db.from('x_posts').update({ parts, updated_at: now }).eq('id', id)
      return Response.json({ ok: true, parts })
    }
    if (op === 'update') {
      const parts = (Array.isArray(body.parts) ? body.parts : []).map((p: unknown) => String(p))
      await db.from('x_posts').update({ parts, updated_at: now }).eq('id', id)
      return Response.json({ ok: true })
    }
    if (op === 'approve') {
      await db.from('x_posts').update({ status: 'approved', approved_at: now, error: null, updated_at: now }).eq('id', id)
      return Response.json({ ok: true })
    }
    if (op === 'reject') {
      await db.from('x_posts').update({ status: 'rejected', updated_at: now }).eq('id', id)
      return Response.json({ ok: true })
    }
    if (op === 'reset') {
      await db.from('x_posts').update({ status: 'draft', approved_at: null, error: null, updated_at: now }).eq('id', id)
      return Response.json({ ok: true })
    }
    if (op === 'publish') {
      const r = await publishXPost(db, id)
      return Response.json({ ok: true, ...r })
    }
    return Response.json({ error: `op inconnue : ${op}` }, { status: 400 })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

