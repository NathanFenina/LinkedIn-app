'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ExternalLink, Sparkles, Check, X as XIcon, Send, Settings2, Plus, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface Post {
  id: string
  share_url: string | null
  source_text: string
  posted_at: string | null
  reactions: number
  comments: number
  kind: 'new' | 'archive'
  parts: string[] | null
  status: string
  x_post_ids: string[] | null
  cost_usd: number
  error: string | null
  published_at: string | null
  media: { type: 'image' | 'video'; url: string }[] | null
}
interface Data {
  posts: Post[]
  account: { connected: boolean; username?: string }
  settings: { max_per_day: number; monthly_cap_usd: number; premium: boolean }
  prices: { post: number; post_link: number; read: number }
  spent: number
  today: number
  counts: Record<string, number>
  env: { client: boolean; claude: boolean }
}

// Longueur pondérée X (latin = 1, emoji/CJK = 2, URL = 23) — même règle que lib/x.ts.
function xLength(text: string): number {
  let n = 0
  const noUrls = text.replace(/https?:\/\/\S+/g, () => { n += 23; return '' })
  for (const ch of noUrls) {
    const c = ch.codePointAt(0) || 0
    n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2
  }
  return n
}

export default function XPage() {
  const [data, setData] = useState<Data | null>(null)
  const [view, setView] = useState<'draft' | 'approved' | 'done'>('draft')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState<Record<string, string[]>>({})
  const [showSettings, setShowSettings] = useState(false)

  const load = useCallback(async (v = view) => {
    setLoading(true)
    try {
      const d = await fetch(`/api/x?view=${v}`).then((r) => r.json())
      if (d.error) { setErr(d.error); return }
      setData(d)
      const e: Record<string, string[]> = {}
      for (const p of d.posts as Post[]) e[p.id] = p.parts && p.parts.length ? p.parts : []
      setEdit(e)
    } catch (e) { setErr(String(e)) } finally { setLoading(false) }
  }, [view])
  useEffect(() => { load(view) }, [load, view])
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('connected')) setMsg(`Compte X connecté ✓ (@${q.get('connected')})`)
    if (q.get('error')) setErr(`Connexion X : ${q.get('error')}`)
  }, [])

  const call = async (payload: Record<string, unknown>) => {
    const d = await fetch('/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((r) => r.json())
    if (d.error) throw new Error(d.error)
    return d
  }
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(''); setMsg('')
    try { await fn() } catch (e) { setErr(String(e).replace(/^Error: /, '')) } finally { setBusy(null) }
  }

  const importPosts = (archive: boolean, days?: number) => run(archive ? (days ? 'month' : 'arch') : 'new', async () => {
    const d = await call({ op: 'import', archive, ...(days ? { days, limit: 15 } : {}) })
    setMsg(`${d.scanned} posts LinkedIn lus · ${d.added} ajoutés en brouillon (texte d’origine, médias repris).`)
    await load()
  })
  const faithful = (p: Post) => run(p.id + 'fid', async () => {
    const d = await call({ op: 'faithful', id: p.id })
    setEdit((e) => ({ ...e, [p.id]: d.parts }))
  })
  const save = async (p: Post) => { try { await call({ op: 'update', id: p.id, parts: edit[p.id] || [] }) } catch { /* silencieux */ } }
  const generate = (p: Post) => run(p.id + 'gen', async () => {
    const d = await call({ op: 'generate', id: p.id })
    setEdit((e) => ({ ...e, [p.id]: d.parts }))
    if (d.note) setMsg(d.note)
  })
  const act = (p: Post, op: 'approve' | 'reject' | 'reset') => run(p.id + op, async () => {
    if (op === 'approve') await call({ op: 'update', id: p.id, parts: edit[p.id] || [] })
    await call({ op, id: p.id }); await load()
  })
  const publishNow = (p: Post) => run(p.id + 'pub', async () => {
    const parts = (edit[p.id] || []).filter((x) => x.trim())
    if (!confirm(`Publier maintenant sur X (${parts.length} post${parts.length > 1 ? 's' : ''}) ?\n\n${(parts[0] || '').slice(0, 200)}`)) return
    await call({ op: 'update', id: p.id, parts })
    const d = await call({ op: 'publish', id: p.id })
    setMsg(`Publié sur X ✓ (${d.ids.length} post${d.ids.length > 1 ? 's' : ''})`)
    await load()
  })
  const saveSettings = (patch: Record<string, unknown>) => run('settings', async () => { await call({ op: 'settings', ...patch }); await load(); setMsg('Réglages enregistrés.') })

  const s = data?.settings
  const limit = s?.premium ? 25000 : 280
  const setPart = (id: string, i: number, v: string) => setEdit((e) => { const a = [...(e[id] || [])]; a[i] = v; return { ...e, [id]: a } })

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">X (Twitter)</h1>
            <p className="text-xs text-gray-500">Tes posts LinkedIn adaptés pour X : tu valides, l’app publie aux créneaux (≈ 8h30, 12h30, 18h30).</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {data?.account.connected
              ? <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">@{data.account.username || 'connecté'}</span>
              : <a href="/api/x/connect" className="text-xs px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800">Connecter mon compte X</a>}
            <button onClick={() => setShowSettings((v) => !v)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5" /> Réglages</button>
            <button onClick={() => load()} disabled={loading} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir</button>
            <button onClick={() => importPosts(false)} disabled={!!busy} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'new' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : '🔎'} Nouveaux posts</button>
            <button onClick={() => importPosts(true, 30)} disabled={!!busy} className="text-xs px-3 py-1.5 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'month' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : '🏆'} Meilleurs posts du mois</button>
            <button onClick={() => importPosts(true)} disabled={!!busy} className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'arch' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : '🗂'} Toute l’archive</button>
          </div>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-5 space-y-4">
        {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">Erreur : {err}</div>}
        {msg && <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</div>}
        {data && !data.env.client && <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">X_CLIENT_ID / X_CLIENT_SECRET absents sur Vercel.</div>}

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2"><div className="text-gray-500">Publiés aujourd’hui</div><div className="text-base font-semibold">{data.today} / {s?.max_per_day}</div></div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2"><div className="text-gray-500">Validés en file</div><div className="text-base font-semibold">{data.counts.approved || 0}</div></div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2"><div className="text-gray-500">Brouillons</div><div className="text-base font-semibold">{data.counts.draft || 0}</div></div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2"><div className="text-gray-500">Dépense du mois</div><div className="text-base font-semibold">{data.spent.toFixed(2)} $ / {s?.monthly_cap_usd} $</div></div>
          </div>
        )}

        {showSettings && s && (
          <div className="bg-white border border-gray-200 rounded-lg p-3 grid md:grid-cols-3 gap-3 text-sm">
            <label className="text-xs text-gray-600">Posts max par jour
              <input type="number" min={0} max={10} defaultValue={s.max_per_day} onBlur={(e) => saveSettings({ max_per_day: e.target.value })} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-1.5" />
            </label>
            <label className="text-xs text-gray-600">Plafond mensuel ($)
              <input type="number" min={0} defaultValue={s.monthly_cap_usd} onBlur={(e) => saveSettings({ monthly_cap_usd: e.target.value })} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-1.5" />
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-2 mt-5">
              <input type="checkbox" defaultChecked={s.premium} onChange={(e) => saveSettings({ premium: e.target.checked })} /> Compte X Premium (posts longs au lieu de threads)
            </label>
            <p className="md:col-span-3 text-[11px] text-gray-400">Tarifs : {data?.prices.post} $ / post · {data?.prices.post_link} $ avec lien · {data?.prices.read} $ / lecture. Un thread = 1 post facturé par partie. {data?.account.connected && <button onClick={() => { if (confirm('Déconnecter le compte X ?')) run('disc', async () => { await call({ op: 'disconnect' }); await load() }) }} className="underline ml-1">Déconnecter X</button>}</p>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs">
          {([['draft', 'À valider'], ['approved', 'Validés (file)'], ['done', 'Publiés / rejetés']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-full border ${view === v ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{l}</button>
          ))}
        </div>

        <div className="space-y-4">
          {!data || data.posts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg text-center py-10 text-gray-400 text-sm">
              {view === 'draft' ? 'Aucun brouillon. Clique « Meilleurs posts du mois » ou « Nouveaux posts ».' : view === 'approved' ? 'Rien en file : valide des brouillons.' : 'Rien de publié pour l’instant.'}
            </div>
          ) : data.posts.map((p) => {
            const parts = edit[p.id] || []
            const editable = p.status === 'draft' || p.status === 'approved'
            return (
              <div key={p.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                  <div className="p-4 bg-gray-50/60">
                    <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                      <span className="font-semibold text-gray-700">LinkedIn</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${p.kind === 'new' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>{p.kind === 'new' ? 'nouveau' : 'archive'}</span>
                      {p.posted_at && <span>· {formatDistanceToNow(p.posted_at)}</span>}
                      <span>· {p.reactions} réactions · {p.comments} comm.</span>
                      {p.share_url && <a href={p.share_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">ouvrir <ExternalLink className="w-2.5 h-2.5" /></a>}
                    </div>
                    <p className="text-[13px] text-gray-800 whitespace-pre-wrap mt-2 max-h-72 overflow-y-auto">{p.source_text}</p>
                    {(p.media || []).length > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {(p.media || []).map((m, i) => m.type === 'video'
                          ? <video key={i} src={m.url} className="h-24 rounded border border-gray-200" controls muted />
                          : <img key={i} src={m.url} alt="" className="h-24 w-24 object-cover rounded border border-gray-200" />)}
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900">Version X {parts.length > 1 && <span className="text-xs text-gray-500 font-normal">· thread de {parts.length}</span>}
                      <span className="flex-1" />
                      {(p.media || []).length > 0 && <span className="text-[11px] text-gray-500 font-normal">{(p.media || []).some((m) => m.type === 'video') ? '🎬 vidéo' : `🖼 ${(p.media || []).length} image(s)`} jointe(s) au 1er post</span>}
                      {editable && <button onClick={() => faithful(p)} disabled={!!busy} title="Texte d’origine découpé, sans reformulation" className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50">{busy === p.id + 'fid' ? <RefreshCw className="w-3 h-3 animate-spin inline" /> : '↺'} Version fidèle</button>}
                      {editable && <button onClick={() => generate(p)} disabled={!!busy} title="Reformulation courte par l’IA" className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50">{busy === p.id + 'gen' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Reformuler (IA)</button>}
                    </div>
                    {parts.map((t, i) => {
                      const len = xLength(t)
                      return (
                        <div key={i}>
                          <textarea value={t} disabled={!editable} onChange={(e) => setPart(p.id, i, e.target.value)} onBlur={() => save(p)} rows={Math.min(10, Math.max(3, Math.ceil(t.length / 60)))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] disabled:bg-gray-50" />
                          <div className="flex items-center text-[11px] gap-2">
                            <span className={len > limit ? 'text-red-600 font-medium' : 'text-gray-400'}>{parts.length > 1 ? `${i + 1}/${parts.length} · ` : ''}{len}/{limit}{/https?:\/\//.test(t) ? ' · ⚠️ lien = 0,20 $' : ''}</span>
                            <span className="flex-1" />
                            {editable && parts.length > 1 && <button onClick={() => setEdit((e) => ({ ...e, [p.id]: parts.filter((_, j) => j !== i) }))} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>}
                          </div>
                        </div>
                      )
                    })}
                    {editable && <button onClick={() => setEdit((e) => ({ ...e, [p.id]: [...parts, ''] }))} className="text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter un post au thread</button>}
                    {p.error && <p className="text-[11px] text-red-600">{p.error}</p>}
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] pt-1">
                      {p.status === 'draft' && <>
                        <button onClick={() => act(p, 'approve')} disabled={!parts.length || !!busy} className="px-2.5 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Valider (file d’attente)</button>
                        <button onClick={() => act(p, 'reject')} disabled={!!busy} className="px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50 inline-flex items-center gap-1"><XIcon className="w-3 h-3" /> Rejeter</button>
                      </>}
                      {p.status === 'approved' && <button onClick={() => act(p, 'reset')} disabled={!!busy} className="px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50">Repasser en brouillon</button>}
                      {editable && <button onClick={() => publishNow(p)} disabled={!parts.length || !data?.account.connected || !!busy} title={!data?.account.connected ? 'Connecte ton compte X' : ''} className="px-2.5 py-1 bg-black text-white rounded hover:bg-gray-800 disabled:opacity-40 inline-flex items-center gap-1">{busy === p.id + 'pub' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Publier maintenant</button>}
                      {p.status === 'published' && <span className="text-green-700 inline-flex items-center gap-1"><Check className="w-3 h-3" /> publié {p.published_at && formatDistanceToNow(p.published_at)} · {Number(p.cost_usd).toFixed(3)} $
                        {data?.account.username && p.x_post_ids?.[0] && <a href={`https://x.com/${data.account.username}/status/${p.x_post_ids[0]}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5 ml-1">voir <ExternalLink className="w-2.5 h-2.5" /></a>}</span>}
                      {(p.status === 'rejected' || p.status === 'error') && <button onClick={() => act(p, 'reset')} className="px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50">Remettre en brouillon</button>}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
