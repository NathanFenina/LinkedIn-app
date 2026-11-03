'use client'

import { useEffect, useState } from 'react'

// PLUG Publish — calendrier : un post, plusieurs réseaux, une date.
// Les posts de Second Brain arrivent ici en brouillon ; « Planifier » les publie
// à l'heure prévue (LinkedIn et Instagram via Unipile, X via la file X ;
// Facebook, YouTube et TikTok restent à publier à la main pour l'instant).

interface Post {
  id: string; title: string | null; body: string; networks: string[]; scheduled_for: string | null; status: string
  media: Array<{ url: string; type?: string }>; lead_magnet: { url?: string; reply?: string } | null
  results: Record<string, { status: string; url?: string | null; error?: string }>; stats: Record<string, number>; source: string
}
interface XPost { id: string; source_text: string; status: string; scheduled_for: string; published_at: string | null }

const NETS: Array<{ key: string; label: string; auto: boolean }> = [
  { key: 'linkedin', label: 'LinkedIn', auto: true }, { key: 'x', label: 'X', auto: true }, { key: 'instagram', label: 'Instagram', auto: true },
  { key: 'facebook', label: 'Facebook', auto: false }, { key: 'youtube', label: 'YouTube', auto: false }, { key: 'tiktok', label: 'TikTok', auto: false },
]
const EMPTY = { id: '', title: '', body: '', networks: ['linkedin'], date: '', media: '', lm_url: '', lm_reply: '' }

function dayKey(iso: string) { return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }
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
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/plug/posts').then((x) => x.json()).then((r) => {
      if (!alive) return
      setPosts(r.posts || [])
      setXposts(r.xposts || [])
    })
    return () => { alive = false }
  }, [tick])

  async function save(status: 'draft' | 'scheduled') {
    const body = {
      id: form.id || undefined, title: form.title, body: form.body, networks: form.networks, status,
      scheduled_for: form.date ? new Date(form.date).toISOString() : null,
      media: form.media.split(/\s+/).filter(Boolean).map((url) => ({ url, type: /\.(mp4|mov)(\?|$)/i.test(url) ? 'video' : 'image' })),
      lead_magnet: form.lm_url ? { url: form.lm_url, reply: form.lm_reply || undefined } : null,
    }
    const r = await fetch('/api/plug/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json())
    setMsg(r.error || (status === 'scheduled' ? 'Planifié ✔' : 'Brouillon enregistré'))
    if (!r.error) { setForm(EMPTY); setTick((t) => t + 1) }
  }
  async function del(id: string) {
    await fetch('/api/plug/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, op: 'delete' }) })
    setTick((t) => t + 1)
  }
  function edit(p: Post) {
    setForm({ id: p.id, title: p.title || '', body: p.body, networks: p.networks, date: toLocalInput(p.scheduled_for), media: (p.media || []).map((m) => m.url).join(' '), lm_url: p.lead_magnet?.url || '', lm_reply: p.lead_magnet?.reply || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  type Row = { when: string | null; kind: 'plug' | 'x'; p?: Post; x?: XPost }
  const rows: Row[] = [
    ...posts.map((p) => ({ when: p.scheduled_for, kind: 'plug' as const, p })),
    ...xposts.map((x) => ({ when: x.scheduled_for, kind: 'x' as const, x })),
  ].sort((a, b) => String(a.when || '9999').localeCompare(String(b.when || '9999')))
  const groups = new Map<string, Row[]>()
  for (const r of rows) { const k = r.when ? dayKey(r.when) : 'Brouillons sans date'; groups.set(k, [...(groups.get(k) || []), r]) }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-bold text-gray-900">Calendrier</h1>
      <p className="text-xs text-gray-500 mb-4">Un post, plusieurs réseaux, une date. Les posts de Second Brain arrivent ici en brouillon.</p>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 space-y-2">
        <div className="font-semibold text-sm">{form.id ? 'Modifier le post' : 'Nouveau post'}</div>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Titre interne (optionnel)" className="w-full text-sm border rounded-lg px-2 py-1.5" />
        <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={7} placeholder="Texte du post" className="w-full text-sm border rounded-lg p-2" />
        <div className="flex flex-wrap gap-3 text-sm">
          {NETS.map((n) => (
            <label key={n.key} className="flex items-center gap-1">
              <input type="checkbox" checked={form.networks.includes(n.key)} onChange={(e) => setForm({ ...form, networks: e.target.checked ? [...form.networks, n.key] : form.networks.filter((x) => x !== n.key) })} />
              {n.label}{!n.auto && <span className="text-[10px] text-gray-400">(à la main)</span>}
            </label>
          ))}
        </div>
        <input value={form.media} onChange={(e) => setForm({ ...form, media: e.target.value })} placeholder="URL d'images ou vidéo (séparées par un espace) — obligatoire pour Instagram" className="w-full text-sm border rounded-lg px-2 py-1.5" />
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={form.lm_url} onChange={(e) => setForm({ ...form, lm_url: e.target.value })} placeholder="Ressource lead magnet (URL) — réponse auto aux commentaires LinkedIn" className="text-sm border rounded-lg px-2 py-1.5" />
          <input value={form.lm_reply} onChange={(e) => setForm({ ...form, lm_reply: e.target.value })} placeholder="Réponse (optionnel, {prenom} {magnet_url}, versions séparées par ===)" className="text-sm border rounded-lg px-2 py-1.5" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="text-sm border rounded-lg px-2 py-1.5" />
          <button disabled={!form.body || !form.date || !form.networks.length} onClick={() => save('scheduled')} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs disabled:opacity-40">Planifier</button>
          <button disabled={!form.body} onClick={() => save('draft')} className="px-3 py-1.5 rounded-lg border text-xs disabled:opacity-40">Brouillon</button>
          {form.id && <button onClick={() => setForm(EMPTY)} className="px-3 py-1.5 rounded-lg text-xs text-gray-500">Annuler</button>}
          {msg && <span className="text-xs text-gray-600">{msg}</span>}
        </div>
      </div>

      {[...groups.entries()].map(([day, items]) => (
        <div key={day} className="mb-4">
          <div className="text-xs font-bold text-gray-500 uppercase mb-1.5">{day}</div>
          <div className="space-y-2">
            {items.map((r) => r.kind === 'x' && r.x ? (
              <div key={`x-${r.x.id}`} className="bg-white border border-gray-200 rounded-lg p-3 text-sm">
                <span className="text-[11px] mr-2 px-1.5 py-0.5 rounded bg-black text-white">X</span>
                <span className="text-xs text-gray-400">{new Date(r.x.scheduled_for).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {r.x.status === 'published' ? 'publié' : 'planifié'} (page X)</span>
                <div className="mt-1 text-gray-700 line-clamp-2">{r.x.source_text}</div>
              </div>
            ) : r.p ? (
              <div key={r.p.id} className="bg-white border border-gray-200 rounded-lg p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.p.networks.map((n) => {
                    const res = r.p!.results?.[n]
                    const cls = res?.status === 'published' ? 'bg-green-100 text-green-800' : res?.status === 'error' ? 'bg-red-100 text-red-700' : res?.status === 'manual' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
                    return <span key={n} title={res?.error || res?.status || ''} className={`text-[11px] px-1.5 py-0.5 rounded ${cls}`}>{NETS.find((x) => x.key === n)?.label || n}{res?.status === 'manual' ? ' · à la main' : ''}</span>
                  })}
                  <span className="text-xs text-gray-400">{r.p.scheduled_for ? new Date(r.p.scheduled_for).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''} · {r.p.status}{r.p.source !== 'manual' ? ` · ${r.p.source}` : ''}{r.p.lead_magnet?.url ? ' · 🎁 ressource auto' : ''}</span>
                  {r.p.stats?.reactions !== undefined && <span className="text-xs text-gray-500">· {r.p.stats.reactions} réactions · {r.p.stats.comments} commentaires</span>}
                </div>
                {r.p.title && <div className="mt-1 font-medium">{r.p.title}</div>}
                <div className="mt-1 text-gray-700 whitespace-pre-wrap line-clamp-4">{r.p.body}</div>
                {r.p.results?.linkedin?.url && <a href={r.p.results.linkedin.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600">Voir sur LinkedIn</a>}
                {r.p.status !== 'published' && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => edit(r.p!)} className="px-2.5 py-1 rounded-lg border text-xs">Modifier</button>
                    <button onClick={() => del(r.p!.id)} className="px-2.5 py-1 rounded-lg border text-xs text-red-600">Supprimer</button>
                  </div>
                )}
              </div>
            ) : null)}
          </div>
        </div>
      ))}
    </div>
  )
}
