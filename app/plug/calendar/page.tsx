'use client'

import { useEffect, useMemo, useState } from 'react'

// PLUG Publish — calendrier et production : un post, plusieurs réseaux, une date.
// Trois vues : Calendrier (mois), Production (idée → script → à tourner → monté → brouillon → planifié → publié), Liste.
// Chaque post a un format (texte, image, carrousel, vidéo) : les réseaux sont proposés selon le format, et chaque
// réseau peut recevoir sa variante de texte (générée par Gemini depuis le texte LinkedIn, puis relue).
// Les posts de Second Brain arrivent ici en brouillon (titre « #NN · nom · type »).

interface Post {
  id: string; title: string | null; body: string; networks: string[]; scheduled_for: string | null; status: string
  format: string; script: string | null; variants: Record<string, string>
  media: Array<{ url: string; type?: string }>; lead_magnet: { url?: string; reply?: string } | null
  results: Record<string, { status: string; url?: string | null; error?: string }>; stats: Record<string, number>; source: string
}
interface XPost { id: string; source_text: string; status: string; scheduled_for: string; published_at: string | null }

const NETS: Array<{ key: string; label: string; auto: boolean }> = [
  { key: 'linkedin', label: 'LinkedIn', auto: true }, { key: 'x', label: 'X', auto: true }, { key: 'instagram', label: 'Instagram', auto: true },
  { key: 'facebook', label: 'Facebook (page)', auto: true }, { key: 'youtube', label: 'YouTube', auto: false }, { key: 'tiktok', label: 'TikTok', auto: false },
  { key: 'substack', label: 'Substack', auto: false },
]
const FORMATS = [
  { key: 'texte', label: '📝 Texte' }, { key: 'image', label: '🖼️ Image' }, { key: 'carrousel', label: '📑 Carrousel' }, { key: 'video', label: '🎬 Vidéo' },
]
const STATUSES = [
  { key: 'idee', label: 'Idée', cls: 'bg-gray-100 text-gray-700' }, { key: 'script', label: 'Script', cls: 'bg-sky-100 text-sky-800' },
  { key: 'a_tourner', label: 'À tourner', cls: 'bg-orange-100 text-orange-800' }, { key: 'monte', label: 'Monté', cls: 'bg-violet-100 text-violet-800' },
  { key: 'draft', label: 'Brouillon', cls: 'bg-slate-100 text-slate-700' }, { key: 'scheduled', label: 'Planifié', cls: 'bg-blue-100 text-blue-800' },
  { key: 'published', label: 'Publié', cls: 'bg-green-100 text-green-800' }, { key: 'error', label: 'Erreur', cls: 'bg-red-100 text-red-700' },
]
const NETWORKS_BY_FORMAT: Record<string, string[]> = {
  video: ['linkedin', 'instagram', 'facebook', 'youtube', 'tiktok', 'x'],
  image: ['linkedin', 'instagram', 'facebook', 'x'],
  carrousel: ['linkedin', 'instagram', 'facebook'],
  texte: ['linkedin', 'x', 'facebook', 'substack'],
}
const st = (k: string) => STATUSES.find((s) => s.key === k) || { key: k, label: k, cls: 'bg-gray-100 text-gray-700' }
const fmt = (k: string) => FORMATS.find((f) => f.key === k)?.label.split(' ')[0] || '📝'

interface Net { accounts: Array<{ id: string; type: string; name?: string }>; settings: { instagram_account_id: string; fb_page_id: string; fb_token_set: boolean } }

function Networks() {
  const [net, setNet] = useState<Net | null>(null)
  const [fb, setFb] = useState({ id: '', token: '' })
  const [msg, setMsg] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/api/plug/networks').then((x) => x.json()).then((r) => { if (alive && !r.error) setNet(r) })
    return () => { alive = false }
  }, [tick])
  async function post(body: Record<string, string>) {
    const r = await fetch('/api/plug/networks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json())
    if (r.url) window.open(r.url, '_blank')
    setMsg(r.error || (r.url ? 'Connexion ouverte dans un nouvel onglet' : 'Enregistré'))
    setTick((t) => t + 1)
  }
  if (!net) return null
  const ig = net.accounts.filter((a) => /instagram/i.test(a.type))
  return (
    <details className="bg-white border border-gray-200 rounded-xl p-4 mb-6 text-sm">
      <summary className="font-semibold cursor-pointer">Réseaux connectés</summary>
      <div className="mt-3 space-y-3">
        <div>Comptes : {net.accounts.map((a) => `${a.type} (${a.name || a.id})`).join(' · ') || 'aucun'}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Instagram :</span>
          {ig.length ? (
            <select value={net.settings.instagram_account_id} onChange={(e) => post({ op: 'settings', instagram_account_id: e.target.value })} className="border rounded-lg px-2 py-1 text-xs">
              <option value="">Choisir…</option>
              {ig.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
          ) : <span className="text-xs text-gray-500">pas encore connecté</span>}
          <button onClick={() => post({ op: 'connect', provider: 'INSTAGRAM' })} className="px-2.5 py-1 rounded-lg border text-xs">Connecter Instagram</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Page Facebook :</span>
          <input value={fb.id} onChange={(e) => setFb({ ...fb, id: e.target.value })} placeholder={net.settings.fb_page_id || 'ID de la page'} className="border rounded-lg px-2 py-1 text-xs" />
          <input value={fb.token} onChange={(e) => setFb({ ...fb, token: e.target.value })} placeholder={net.settings.fb_token_set ? 'jeton enregistré ✔' : 'jeton de page'} className="border rounded-lg px-2 py-1 text-xs flex-1 min-w-40" />
          <button onClick={() => post({ op: 'settings', fb_page_id: fb.id || net.settings.fb_page_id, fb_page_token: fb.token })} className="px-2.5 py-1 rounded-lg border text-xs">Enregistrer</button>
        </div>
        <div className="text-xs text-gray-500">YouTube (posts écrits ou image), TikTok et Substack n’ont pas d’API de publication utilisable : le post est marqué « à la main » avec le texte prêt.</div>
        {msg && <div className="text-xs text-gray-600">{msg}</div>}
      </div>
    </details>
  )
}const EMPTY = { id: '', title: '', body: '', format: 'texte', status: 'draft', script: '', networks: NETWORKS_BY_FORMAT.texte, date: '', media: '', lm_url: '', lm_reply: '', variants: {} as Record<string, string> }

function dayKey(iso: string) { return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function PlugCalendarPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [xposts, setXposts] = useState<XPost[]>([])
  const [form, setForm] = useState(EMPTY)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [view, setView] = useState<'mois' | 'production' | 'liste'>('mois')
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })

  useEffect(() => {
    let alive = true
    const from = new Date(month.getFullYear(), month.getMonth() - 1, 1).toISOString()
    const to = new Date(month.getFullYear(), month.getMonth() + 2, 1).toISOString()
    fetch(`/api/plug/posts?from=${from}&to=${to}`).then((x) => x.json()).then((r) => {
      if (!alive) return
      setPosts(r.posts || [])
      setXposts(r.xposts || [])
    })
    return () => { alive = false }
  }, [tick, month])

  async function call(body: Record<string, unknown>) {
    return fetch('/api/plug/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json())
  }
  async function save(status?: string) {
    const s = status || form.status
    const body = {
      id: form.id || undefined, title: form.title, body: form.body, networks: form.networks, status: s, format: form.format, script: form.script,
      variants: form.variants, scheduled_for: form.date ? new Date(form.date).toISOString() : null,
      media: form.media.split(/\s+/).filter(Boolean).map((url) => ({ url, type: /\.(mp4|mov)(\?|$)/i.test(url) ? 'video' : 'image' })),
      lead_magnet: form.lm_url ? { url: form.lm_url, reply: form.lm_reply || undefined } : null,
    }
    const r = await call(body)
    setMsg(r.error || (s === 'scheduled' ? 'Planifié ✔' : 'Enregistré ✔'))
    if (!r.error) { setForm(EMPTY); setTick((t) => t + 1) }
  }
  async function variants() {
    if (!form.id) { setMsg('Enregistre d\'abord le post'); return }
    setBusy(true)
    await call({ id: form.id, networks: form.networks, body: form.body, format: form.format })
    const r = await call({ id: form.id, op: 'variants' })
    setBusy(false)
    if (r.error) setMsg(r.error)
    else { setForm({ ...form, variants: r.variants || {} }); setMsg('Variantes générées : relis-les avant de planifier') }
  }
  async function del(id: string) {
    await call({ id, op: 'delete' })
    setTick((t) => t + 1)
  }
  async function move(p: Post, status: string) {
    await call({ id: p.id, status })
    setTick((t) => t + 1)
  }
  function edit(p: Post) {
    setForm({ id: p.id, title: p.title || '', body: p.body, format: p.format || 'texte', status: p.status, script: p.script || '', networks: p.networks,
      date: toLocalInput(p.scheduled_for), media: (p.media || []).map((m) => m.url).join(' '), lm_url: p.lead_magnet?.url || '', lm_reply: p.lead_magnet?.reply || '',
      variants: p.variants || {} })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function setFormat(f: string) {
    setForm({ ...form, format: f, networks: NETWORKS_BY_FORMAT[f] || form.networks })
  }

  const isVideo = form.format === 'video'
  const showScript = isVideo || ['idee', 'script', 'a_tourner'].includes(form.status)
  const otherNets = form.networks.filter((n) => n !== 'linkedin')

  // Grille du mois (lundi → dimanche)
  const days = useMemo(() => {
    const first = new Date(month)
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  }, [month])
  const byDay = useMemo(() => {
    const m = new Map<string, Array<{ label: string; cls: string; p?: Post }>>()
    for (const p of posts) if (p.scheduled_for) {
      const k = ymd(new Date(p.scheduled_for))
      m.set(k, [...(m.get(k) || []), { label: `${fmt(p.format)} ${p.title || p.body.slice(0, 40)}`, cls: st(p.status).cls, p }])
    }
    for (const x of xposts) {
      const k = ymd(new Date(x.scheduled_for))
      m.set(k, [...(m.get(k) || []), { label: `X · ${x.source_text.slice(0, 40)}`, cls: 'bg-black text-white' }])
    }
    return m
  }, [posts, xposts])

  function Card({ p }: { p: Post }) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[11px] px-1.5 py-0.5 rounded ${st(p.status).cls}`}>{st(p.status).label}</span>
          <span className="text-[11px]">{fmt(p.format)}</span>
          {p.networks.map((n) => {
            const res = p.results?.[n]
            const cls = res?.status === 'published' ? 'bg-green-100 text-green-800' : res?.status === 'error' ? 'bg-red-100 text-red-700' : res?.status === 'manual' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
            return <span key={n} title={res?.error || res?.status || ''} className={`text-[11px] px-1.5 py-0.5 rounded ${cls}`}>{NETS.find((x) => x.key === n)?.label || n}{res?.status === 'manual' ? ' · à la main' : ''}{p.variants?.[n] ? ' ✎' : ''}</span>
          })}
          <span className="text-xs text-gray-400">{p.scheduled_for ? new Date(p.scheduled_for).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}{p.lead_magnet?.url ? ' · 🎁 ressource auto' : ''}</span>
          {p.stats?.reactions !== undefined && <span className="text-xs text-gray-500">· {p.stats.reactions} réactions · {p.stats.comments} commentaires</span>}
        </div>
        {p.title && <div className="mt-1 font-medium">{p.title}</div>}
        {p.body && <div className="mt-1 text-gray-700 whitespace-pre-wrap line-clamp-3">{p.body}</div>}
        {p.media?.find((m) => m.type === 'video') && <a href={p.media.find((m) => m.type === 'video')!.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 mr-3">Vidéo</a>}
        {p.results?.linkedin?.url && <a href={p.results.linkedin.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600">Voir sur LinkedIn</a>}
        {p.status !== 'published' && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => edit(p)} className="px-2.5 py-1 rounded-lg border text-xs">Modifier</button>
            <select value="" onChange={(e) => e.target.value && move(p, e.target.value)} className="px-2 py-1 rounded-lg border text-xs">
              <option value="">Passer à…</option>
              {STATUSES.filter((s) => !['published', 'error', 'scheduled', p.status].includes(s.key)).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button onClick={() => del(p.id)} className="px-2.5 py-1 rounded-lg border text-xs text-red-600">Supprimer</button>
          </div>
        )}
      </div>
    )
  }

  const rows = [...posts].sort((a, b) => String(a.scheduled_for || '9999').localeCompare(String(b.scheduled_for || '9999')))
  const groups = new Map<string, Post[]>()
  for (const p of rows) { const k = p.scheduled_for ? dayKey(p.scheduled_for) : 'Sans date'; groups.set(k, [...(groups.get(k) || []), p]) }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-bold text-gray-900">Calendrier</h1>
      <p className="text-xs text-gray-500 mb-4">Un post, plusieurs réseaux, une date. Le format choisit les réseaux ; chaque réseau peut avoir sa variante de texte.</p>
      <Networks />

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 space-y-2">
        <div className="font-semibold text-sm">{form.id ? 'Modifier le post' : 'Nouveau post'}</div>
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Titre interne : #NN · nom" className="text-sm border rounded-lg px-2 py-1.5" />
          <select value={form.format} onChange={(e) => setFormat(e.target.value)} className="text-sm border rounded-lg px-2 py-1.5">
            {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="text-sm border rounded-lg px-2 py-1.5">
            {STATUSES.filter((s) => !['published', 'error', 'scheduled'].includes(s.key)).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        {showScript && <textarea value={form.script} onChange={(e) => setForm({ ...form, script: e.target.value })} rows={6} placeholder="Script de tournage (ce que tu dis face caméra)" className="w-full text-sm border rounded-lg p-2 bg-orange-50/40" />}
        <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={7} placeholder="Texte du post (version LinkedIn)" className="w-full text-sm border rounded-lg p-2" />
        <div className="flex flex-wrap gap-3 text-sm">
          {NETS.map((n) => (
            <label key={n.key} className="flex items-center gap-1">
              <input type="checkbox" checked={form.networks.includes(n.key)} onChange={(e) => setForm({ ...form, networks: e.target.checked ? [...form.networks, n.key] : form.networks.filter((x) => x !== n.key) })} />
              {n.label}{!n.auto && <span className="text-[10px] text-gray-400">(à la main)</span>}
            </label>
          ))}
        </div>
        <input value={form.media} onChange={(e) => setForm({ ...form, media: e.target.value })} placeholder={isVideo ? 'URL de la vidéo (.mp4)' : "URL d'images (séparées par un espace) — obligatoire pour Instagram"} className="w-full text-sm border rounded-lg px-2 py-1.5" />
        {otherNets.length > 0 && (
          <details className="border rounded-lg p-2" open={Object.keys(form.variants).length > 0}>
            <summary className="text-sm font-medium cursor-pointer">Variantes par réseau ({Object.keys(form.variants).filter((k) => otherNets.includes(k)).length}/{otherNets.length})</summary>
            <div className="mt-2 space-y-2">
              <button onClick={variants} disabled={busy || !form.id} className="px-2.5 py-1 rounded-lg border text-xs disabled:opacity-40">{busy ? 'Génération…' : 'Générer les variantes (Gemini)'}</button>
              {!form.id && <span className="text-xs text-gray-400 ml-2">enregistre le post d&apos;abord</span>}
              {otherNets.map((n) => (
                <div key={n}>
                  <div className="text-xs text-gray-500">{NETS.find((x) => x.key === n)?.label} {form.variants[n] ? '' : '(sinon : texte LinkedIn)'}</div>
                  <textarea value={form.variants[n] || ''} onChange={(e) => setForm({ ...form, variants: { ...form.variants, [n]: e.target.value } })} rows={3} className="w-full text-xs border rounded-lg p-2" />
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={form.lm_url} onChange={(e) => setForm({ ...form, lm_url: e.target.value })} placeholder="Ressource lead magnet (URL) — réponse auto aux commentaires LinkedIn" className="text-sm border rounded-lg px-2 py-1.5" />
          <input value={form.lm_reply} onChange={(e) => setForm({ ...form, lm_reply: e.target.value })} placeholder="Réponse (optionnel, {prenom} {magnet_url}, versions séparées par ===)" className="text-sm border rounded-lg px-2 py-1.5" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="text-sm border rounded-lg px-2 py-1.5" />
          <button disabled={!form.body || !form.date || !form.networks.length} onClick={() => save('scheduled')} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs disabled:opacity-40">Planifier</button>
          <button disabled={!form.body && !form.title} onClick={() => save()} className="px-3 py-1.5 rounded-lg border text-xs disabled:opacity-40">Enregistrer ({st(form.status).label})</button>
          {form.id && <button onClick={() => setForm(EMPTY)} className="px-3 py-1.5 rounded-lg text-xs text-gray-500">Annuler</button>}
          {msg && <span className="text-xs text-gray-600">{msg}</span>}
        </div>
        {isVideo && form.networks.some((n) => ['linkedin', 'instagram', 'facebook'].includes(n)) && <div className="text-[11px] text-amber-700">Vidéo : publication branchée sur LinkedIn, Instagram, Facebook et X, à vérifier sur le premier post publié.</div>}
      </div>

      <div className="flex items-center gap-2 mb-3">
        {(['mois', 'production', 'liste'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg text-xs border ${view === v ? 'bg-gray-900 text-white' : 'bg-white'}`}>{v === 'mois' ? 'Calendrier' : v === 'production' ? 'Production' : 'Liste'}</button>
        ))}
        {view === 'mois' && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="px-2 py-1 border rounded-lg">←</button>
            <span className="font-medium w-36 text-center">{month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</span>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="px-2 py-1 border rounded-lg">→</button>
          </div>
        )}
      </div>

      {view === 'mois' && (
        <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden text-xs">
          {['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => <div key={d} className="bg-gray-50 px-2 py-1 font-semibold text-gray-500 uppercase">{d}</div>)}
          {days.map((d) => {
            const items = byDay.get(ymd(d)) || []
            const today = ymd(d) === ymd(new Date())
            return (
              <div key={d.toISOString()} className={`bg-white min-h-24 p-1 ${d.getMonth() !== month.getMonth() ? 'opacity-40' : ''}`}>
                <div className={`text-[11px] mb-1 ${today ? 'font-bold text-blue-600' : 'text-gray-400'}`}>{d.getDate()}</div>
                {items.map((it, i) => (
                  <button key={i} onClick={() => it.p && edit(it.p)} className={`block w-full text-left truncate rounded px-1 py-0.5 mb-0.5 ${it.cls}`}>{it.label}</button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {view === 'mois' && posts.some((p) => !p.scheduled_for) && (
        <div className="mt-4">
          <div className="text-xs font-bold text-gray-500 uppercase mb-1.5">Sans date ({posts.filter((p) => !p.scheduled_for).length})</div>
          <div className="grid sm:grid-cols-2 gap-2">{posts.filter((p) => !p.scheduled_for).map((p) => <Card key={p.id} p={p} />)}</div>
        </div>
      )}

      {view === 'production' && (
        <div className="grid sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {STATUSES.filter((s) => s.key !== 'error').map((s) => {
            const col = posts.filter((p) => p.status === s.key || (s.key === 'draft' && p.status === 'error'))
            return (
              <div key={s.key} className="bg-gray-100 rounded-xl p-2 min-h-32">
                <div className="text-xs font-semibold mb-2 flex justify-between"><span>{s.label}</span><span className="text-gray-400">{col.length}</span></div>
                <div className="space-y-2">{col.map((p) => <Card key={p.id} p={p} />)}</div>
              </div>
            )
          })}
        </div>
      )}

      {view === 'liste' && [...groups.entries()].map(([day, items]) => (
        <div key={day} className="mb-4">
          <div className="text-xs font-bold text-gray-500 uppercase mb-1.5">{day}</div>
          <div className="space-y-2">{items.map((p) => <Card key={p.id} p={p} />)}</div>
        </div>
      ))}
    </div>
  )
}
