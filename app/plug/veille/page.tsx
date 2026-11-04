'use client'

import { useEffect, useState } from 'react'

// PLUG — Veille : les meilleurs posts des créateurs que Nathan suit (LinkedIn, via Unipile),
// classés par score (réactions + 3×commentaires + 2×partages), avec « pourquoi ça marche » (Gemini).
// Récupération automatique chaque matin (GitHub Actions) ; bouton « Récupérer maintenant ».

interface Source { id: string; name: string | null; url: string; active: boolean; last_fetched_at: string | null }
interface WPost { id: string; author: string | null; url: string; text: string; posted_at: string | null; reactions: number; comments: number; reposts: number; score: number; why: string | null; saved: boolean }

export default function PlugVeillePage() {
  const [sources, setSources] = useState<Source[]>([])
  const [posts, setPosts] = useState<WPost[]>([])
  const [saved, setSaved] = useState<WPost[]>([])
  const [days, setDays] = useState(7)
  const [url, setUrl] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    fetch(`/api/plug/watch?days=${days}`).then((x) => x.json()).then((r) => {
      if (!alive) return
      setSources(r.sources || []); setPosts(r.posts || []); setSaved(r.saved || [])
    })
    return () => { alive = false }
  }, [tick, days])

  async function op(body: Record<string, unknown>) {
    const r = await fetch('/api/plug/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json())
    if (r.error) setMsg(r.error)
    setTick((t) => t + 1)
    return r
  }
  async function refresh() {
    setBusy(true); setMsg('Récupération…')
    const r = await op({ op: 'refresh' })
    setBusy(false)
    if (!r.error) setMsg(`${r.posts} posts récupérés sur ${r.sources} profils${r.errors?.length ? ` · ${r.errors.join(' · ')}` : ''}`)
  }

  function Item({ p }: { p: WPost }) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-800">{p.author || '?'}</span>
          <span>{p.posted_at ? new Date(p.posted_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''}</span>
          <span>· {p.reactions} réactions · {p.comments} commentaires · {p.reposts} partages</span>
          <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-600 ml-auto">Ouvrir</a>
          <button onClick={() => op({ op: 'save', id: p.id, saved: !p.saved })} className="px-2 py-0.5 border rounded">{p.saved ? '★ gardé' : '☆ garder'}</button>
        </div>
        <div className="mt-1 text-gray-700 whitespace-pre-wrap line-clamp-6">{p.text}</div>
        {p.why && <div className="mt-2 text-xs bg-indigo-50 text-indigo-900 rounded p-2">💡 {p.why}</div>}
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-bold text-gray-900">Veille</h1>
      <p className="text-xs text-gray-500 mb-4">Les posts qui marchent chez les créateurs que tu suis, et pourquoi. Récupération automatique chaque matin.</p>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 space-y-2">
        <div className="font-semibold text-sm">Créateurs suivis ({sources.length})</div>
        <div className="flex flex-wrap gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/in/…" className="flex-1 min-w-60 text-sm border rounded-lg px-2 py-1.5" />
          <button onClick={() => { op({ op: 'add', url }); setUrl('') }} disabled={!url} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs disabled:opacity-40">Suivre</button>
          <button onClick={refresh} disabled={busy || !sources.length} className="px-3 py-1.5 rounded-lg border text-xs disabled:opacity-40">Récupérer maintenant</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <span key={s.id} className={`text-xs border rounded-full pl-2 pr-1 py-0.5 flex items-center gap-1 ${s.active ? '' : 'opacity-50'}`}>
              <a href={s.url} target="_blank" rel="noreferrer">{s.name || s.url.replace(/.*\/in\//, '')}</a>
              <button title={s.active ? 'Mettre en pause' : 'Réactiver'} onClick={() => op({ op: 'toggle', id: s.id, active: !s.active })} className="px-1">{s.active ? '⏸' : '▶'}</button>
              <button title="Ne plus suivre" onClick={() => op({ op: 'remove', id: s.id })} className="px-1 text-red-600">×</button>
            </span>
          ))}
        </div>
        {msg && <div className="text-xs text-gray-600">{msg}</div>}
      </div>

      <div className="flex items-center gap-2 mb-3">
        {[7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 rounded-lg text-xs border ${days === d ? 'bg-gray-900 text-white' : 'bg-white'}`}>{d === 7 ? '7 derniers jours' : '30 derniers jours'}</button>
        ))}
      </div>
      <div className="space-y-2 mb-8">
        {posts.length ? posts.map((p) => <Item key={p.id} p={p} />) : <div className="text-sm text-gray-500">Rien sur la période. Ajoute des créateurs, puis « Récupérer maintenant ».</div>}
      </div>

      {saved.length > 0 && (
        <>
          <div className="text-xs font-bold text-gray-500 uppercase mb-1.5">Gardés pour le swipe-file ({saved.length})</div>
          <div className="space-y-2">{saved.map((p) => <Item key={p.id} p={p} />)}</div>
        </>
      )}
    </div>
  )
}
