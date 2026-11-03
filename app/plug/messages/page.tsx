'use client'

import { useEffect, useState } from 'react'

// PLUG — bibliothèque de messages : chaque version, son texte (modifiable) et
// ses résultats (envoyés, réponses, taux). On tranche après ~30 envois.

interface Tpl { id: string; key: string; name: string; kind: string; body: string; active: boolean; notes: string | null }
type Stats = Record<string, { sent: number; replies: number; hot: number }>

const KINDS: Record<string, string> = { approche: 'Approche', relance: 'Relance', ressource: 'Ressource', invitation: 'Invitation' }

export default function PlugMessagesPage() {
  const [tpls, setTpls] = useState<Tpl[]>([])
  const [stats, setStats] = useState<Stats>({})
  const [edit, setEdit] = useState<Record<string, Partial<Tpl>>>({})
  const [msg, setMsg] = useState('')
  const [nk, setNk] = useState({ key: '', name: '', kind: 'approche', body: '' })

  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/api/plug/templates').then((x) => x.json()).then((r) => {
      if (!alive) return
      setTpls(r.templates || [])
      setStats(r.stats || {})
    })
    return () => { alive = false }
  }, [tick])
  const load = () => setTick((t) => t + 1)

  async function save(t: Partial<Tpl> & { key: string }) {
    const r = await fetch('/api/plug/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).then((x) => x.json())
    setMsg(r.error || 'Enregistré')
    setEdit((e) => { const n = { ...e }; delete n[t.key]; return n })
    load()
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-bold text-gray-900">Messages</h1>
      <p className="text-xs text-gray-500 mb-4">Chaque version de message et ses résultats. Variables : {'{prenom} {question} {concurrents} {marque} {sujet}'}. On garde la gagnante après ~30 envois.</p>
      {msg && <div className="mb-3 text-xs text-gray-600">{msg}</div>}
      <div className="space-y-3">
        {tpls.map((t) => {
          const s = stats[t.key] || { sent: 0, replies: 0, hot: 0 }
          const rate = s.sent ? Math.round((s.replies / s.sent) * 100) : 0
          const e = edit[t.key] || {}
          return (
            <div key={t.key} className={`bg-white border rounded-xl p-4 ${t.active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] text-gray-400">{KINDS[t.kind] || t.kind} · {t.key}</span>
                  <div className="font-semibold text-gray-900">{t.name}</div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span><b>{s.sent}</b> envoyés</span>
                  <span><b>{s.replies}</b> réponses</span>
                  <span className={rate >= 20 ? 'text-green-700 font-semibold' : 'text-gray-600'}>{rate} %</span>
                  {s.hot > 0 && <span>🔥 {s.hot}</span>}
                  <label className="flex items-center gap-1"><input type="checkbox" checked={t.active} onChange={(ev) => save({ key: t.key, active: ev.target.checked })} />actif</label>
                </div>
              </div>
              {t.kind !== 'invitation' && (
                <textarea value={e.body ?? t.body} onChange={(ev) => setEdit((x) => ({ ...x, [t.key]: { ...e, body: ev.target.value } }))}
                  rows={4} className="mt-2 w-full text-sm border border-gray-200 rounded-lg p-2" />
              )}
              {t.notes && <div className="mt-1 text-[11px] text-gray-400">{t.notes}</div>}
              {e.body !== undefined && <button onClick={() => save({ key: t.key, body: e.body })} className="mt-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs">Enregistrer</button>}
            </div>
          )
        })}
      </div>

      <div className="mt-6 bg-white border border-dashed border-gray-300 rounded-xl p-4">
        <div className="font-semibold text-sm mb-2">Nouvelle version à tester</div>
        <div className="flex flex-wrap gap-2 mb-2">
          <input value={nk.key} onChange={(e) => setNk({ ...nk, key: e.target.value.replace(/\s+/g, '_') })} placeholder="code (ex. E_resultats)" className="text-sm border rounded-lg px-2 py-1" />
          <input value={nk.name} onChange={(e) => setNk({ ...nk, name: e.target.value })} placeholder="nom" className="text-sm border rounded-lg px-2 py-1 flex-1" />
          <select value={nk.kind} onChange={(e) => setNk({ ...nk, kind: e.target.value })} className="text-sm border rounded-lg px-2 py-1">
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <textarea value={nk.body} onChange={(e) => setNk({ ...nk, body: e.target.value })} rows={3} placeholder="Texte du message" className="w-full text-sm border rounded-lg p-2" />
        <button disabled={!nk.key || !nk.body} onClick={() => { save(nk); setNk({ key: '', name: '', kind: 'approche', body: '' }) }} className="mt-2 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs disabled:opacity-40">Ajouter</button>
      </div>
    </div>
  )
}
