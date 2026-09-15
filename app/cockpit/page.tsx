'use client'

import { useEffect, useState, useCallback } from 'react'
import { Flame, RefreshCw, ExternalLink, CheckCircle2, UserPlus2, Radio, ChevronLeft, ChevronRight, Bell, Clock } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface Campaign { type: string; name: string; active: boolean; envoyes: number; retours: number; succes: number }
interface HotItem { id: string; source: 'outreach' | 'lead-magnet'; name: string | null; campaign: string | null; company: string | null; provider_id: string | null; profile_url: string | null; when: string | null; rdv: boolean; last_inbound: string | null; handled: boolean; has_chat: boolean }
interface Followup { id: string; source: 'outreach' | 'lead-magnet'; name: string | null; company: string | null; campaign: string | null; since: string; last_inbound: string | null }
interface Note { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string }
interface Draft { messages: Array<{ text: string; is_sender: boolean; created_at: string }>; draft: string; calendly: string }
interface Weekly { offset: number; label: string; canNext: boolean; dm: number; comment: number; replies: number; prev: { dm: number; replies: number } }
interface Data {
  today: { sent: Record<string, number>; lead_magnets: number; invites: number; accepted: number; replies: number }
  followups: Followup[]
  notes: Note[]
  campaigns: Campaign[]
  weekly: Weekly
  engines: { comments: { active: boolean; posted_7j: number }; autoAccept: { active: boolean; accepted_7j: number } }
  hot: { count: number; todo: number; items: HotItem[] }
}

const KIND_META: Record<string, { cls: string; label: string }> = {
  alert: { cls: 'bg-red-50 border-red-200 text-red-800', label: '⚠️' },
  action: { cls: 'bg-amber-50 border-amber-200 text-amber-900', label: '👉' },
  result: { cls: 'bg-green-50 border-green-200 text-green-800', label: '✅' },
  info: { cls: 'bg-blue-50 border-blue-200 text-blue-900', label: 'ℹ️' },
}

export default function CockpitPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [week, setWeek] = useState(0)
  const [tab, setTab] = useState<'today' | 'machine'>('today')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [rtMsg, setRtMsg] = useState('')

  const load = useCallback(async (wk: number) => {
    setLoading(true)
    try {
      const d = await fetch(`/api/cockpit?week=${wk}`).then((r) => r.json())
      if (d.error) setErr(String(d.error))
      else { setData(d); setErr('') }
    } catch (e) { setErr(String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(week) }, [load, week])

  const act = async (item: { id: string; source: string; name: string | null; provider_id: string | null; profile_url: string | null }, op: 'rdv' | 'crm') => {
    setBusy(item.id + op)
    try {
      const res = await fetch('/api/cockpit/lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, source: item.source, id: item.id, name: item.name, provider_id: item.provider_id, profile_url: item.profile_url }),
      })
      const d = await res.json()
      if (d.error) { setErr(d.error); return }
      if (op === 'rdv') setData((prev) => prev ? { ...prev, hot: { ...prev.hot, items: prev.hot.items.map((h) => h.id === item.id ? { ...h, rdv: true } : h) }, followups: prev.followups.filter((f) => f.id !== item.id) } : prev)
      if (op === 'crm') setErr('')
    } finally { setBusy(null) }
  }

  // Prépare la réponse IA (fil + brouillon) pour un item "à traiter".
  const prepare = async (item: { id: string; source: string }) => {
    setBusy(item.id + 'prep')
    try {
      const d = await fetch(`/api/cockpit/reply?source=${item.source}&id=${item.id}`).then((r) => r.json())
      if (d.error) { setErr(d.error); return }
      setDrafts((p) => ({ ...p, [item.id]: d }))
      setEditing((p) => ({ ...p, [item.id]: d.draft || '' }))
    } finally { setBusy(null) }
  }
  // Envoie (ou passe) et clôt l'item.
  const finish = async (item: { id: string; source: string }, op: 'send' | 'skip') => {
    setBusy(item.id + op)
    try {
      const d = await fetch('/api/cockpit/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: item.source, id: item.id, op, text: editing[item.id] || '' }),
      }).then((r) => r.json())
      if (d.error) { setErr(d.error); return }
      setData((prev) => prev ? {
        ...prev,
        hot: { ...prev.hot, todo: Math.max(0, prev.hot.todo - 1), items: prev.hot.items.map((h) => h.id === item.id ? { ...h, handled: true } : h) },
        followups: prev.followups.filter((f) => f.id !== item.id),
      } : prev)
      setDrafts((p) => { const n = { ...p }; delete n[item.id]; return n })
    } finally { setBusy(null) }
  }
  const enableRealtime = async () => {
    setBusy('rt'); setRtMsg('')
    try {
      const d = await fetch('/api/webhooks/unipile/register', { method: 'POST' }).then((r) => r.json())
      setRtMsg(d.error ? 'Erreur : ' + d.error : d.already ? 'Temps réel déjà actif ✓' : 'Temps réel activé ✓ (les réponses arrivent ici instantanément)')
    } finally { setBusy(null) }
  }
  const readNote = async (id: string | 'all') => {
    await fetch('/api/cockpit/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id === 'all' ? { op: 'read_all' } : { op: 'read', id }) })
    setData((prev) => prev ? { ...prev, notes: id === 'all' ? [] : prev.notes.filter((n) => n.id !== id) } : prev)
  }

  const w = data?.weekly
  const todo = (data?.hot.items || []).filter((h) => !h.handled)
  const rate = w && w.dm > 0 ? Math.round((w.replies / w.dm) * 100) : null
  const sentTotal = Object.values(data?.today.sent || {}).reduce((a, b) => a + b, 0)
  const todayCount = todo.length + (data?.followups.length || 0) + (data?.notes.length || 0)

  // Bloc réponse (fil + brouillon + envoyer) réutilisé pour "à traiter" et "à relancer".
  const replyBlock = (h: { id: string; source: 'outreach' | 'lead-magnet'; rdv?: boolean; has_chat?: boolean; name: string | null; provider_id?: string | null; profile_url?: string | null }, mode: 'todo' | 'followup') => {
    const d = drafts[h.id]
    if (!d) return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => prepare(h)} disabled={busy === h.id + 'prep' || h.has_chat === false} className="text-[11px] px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
          {busy === h.id + 'prep' ? <RefreshCw className="w-3 h-3 animate-spin" /> : '✍️'} {mode === 'todo' ? 'Préparer la réponse' : 'Préparer la relance'}
        </button>
        {!h.rdv && <button onClick={() => act({ id: h.id, source: h.source, name: h.name, provider_id: h.provider_id || null, profile_url: h.profile_url || null }, 'rdv')} className="text-[11px] px-2 py-1 border border-green-200 text-green-700 rounded hover:bg-green-50 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> RDV pris</button>}
        <button onClick={() => finish(h, 'skip')} className="text-[11px] px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50">{mode === 'todo' ? 'Déjà traité' : 'Laisser tomber'}</button>
        {h.has_chat === false && <span className="text-[10px] text-gray-400">(pas de fil connu — réponds sur LinkedIn)</span>}
      </div>
    )
    return (
      <div className="space-y-1.5">
        <div className="max-h-40 overflow-y-auto space-y-1 text-[12px]">
          {d.messages.slice(-6).map((m, i) => (
            <div key={i} className={`px-2 py-1 rounded ${m.is_sender ? 'bg-blue-50 text-blue-900 ml-6' : 'bg-gray-100 text-gray-800 mr-6'}`}>{m.text}</div>
          ))}
        </div>
        <textarea value={editing[h.id] ?? ''} onChange={(e) => setEditing((p) => ({ ...p, [h.id]: e.target.value }))} rows={3} className="w-full border border-blue-200 rounded px-2.5 py-2 text-[13px]" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => finish(h, 'send')} disabled={busy === h.id + 'send'} className="text-[11px] px-2.5 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">📨 Envoyer</button>
          {d.calendly && <button onClick={() => setEditing((p) => ({ ...p, [h.id]: `${(p[h.id] || '').trim()}\n${d.calendly}`.trim() }))} className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50">+ lien Calendly</button>}
          {!h.rdv && <button onClick={() => act({ id: h.id, source: h.source, name: h.name, provider_id: h.provider_id || null, profile_url: h.profile_url || null }, 'rdv')} className="text-[11px] px-2 py-1 border border-green-200 text-green-700 rounded hover:bg-green-50">RDV pris</button>}
          <button onClick={() => finish(h, 'skip')} className="text-[11px] px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50">Passer</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Pilotage</h1>
            <p className="text-xs text-gray-500">Ton créneau du jour d&apos;un côté, la machine de l&apos;autre.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button onClick={() => setTab('today')} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === 'today' ? 'bg-orange-50 text-orange-800 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                <Flame className="w-3.5 h-3.5" /> Aujourd&apos;hui
                {todayCount > 0 && <span className="text-[10px] font-semibold px-1.5 rounded-full bg-orange-100 text-orange-700">{todayCount}</span>}
              </button>
              <button onClick={() => setTab('machine')} className={`px-3 py-1.5 inline-flex items-center gap-1.5 border-l border-gray-200 ${tab === 'machine' ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                <Radio className="w-3.5 h-3.5" /> La machine
              </button>
            </div>
            <button onClick={() => load(week)} disabled={loading} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-5 space-y-6">
        {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">Erreur : {err}</div>}

        {tab === 'today' && (
          <>
            {/* 1. Ce que je te remonte aujourd'hui */}
            <section>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h2 className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                  <Bell className="w-4 h-4 text-blue-500" /> Points du jour
                  <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${data?.notes.length ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{data?.notes.length ?? 0}</span>
                </h2>
                {!!data?.notes.length && <button onClick={() => readNote('all')} className="text-[11px] text-gray-500 hover:underline">tout marquer lu</button>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Envoyés aujourd&apos;hui</div>
                  <div className="text-xl font-semibold text-gray-900">{data ? sentTotal : '—'}</div>
                  <div className="text-[10px] text-gray-400 truncate">{Object.entries(data?.today.sent || {}).map(([n, c]) => `${c} ${n.split(' ')[0]}`).join(' · ') || 'rien encore'}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Réponses reçues</div>
                  <div className="text-xl font-semibold text-green-700">{data?.today.replies ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">aujourd&apos;hui</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Lead-magnets</div>
                  <div className="text-xl font-semibold text-gray-900">{data?.today.lead_magnets ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">envois + relances</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Invitations</div>
                  <div className="text-xl font-semibold text-gray-900">{data?.today.invites ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">envoyées (2e degré)</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Acceptées</div>
                  <div className="text-xl font-semibold text-gray-900">{data?.today.accepted ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">→ message envoyé</div>
                </div>
              </div>
              {!!data?.notes.length && (
                <div className="space-y-1.5">
                  {data.notes.map((n) => {
                    const m = KIND_META[n.kind] || KIND_META.info
                    return (
                      <div key={n.id} className={`border rounded-lg px-3 py-2 text-[13px] flex items-start gap-2 ${m.cls}`}>
                        <span className="shrink-0">{m.label}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{n.title}</div>
                          {n.body && <div className="text-[12px] opacity-90 whitespace-pre-line mt-0.5">{n.body}</div>}
                          <div className="text-[10px] opacity-60 mt-0.5">{formatDistanceToNow(n.created_at)}{n.link && <> · <a href={n.link} className="underline">ouvrir</a></>}</div>
                        </div>
                        <button onClick={() => readNote(n.id)} className="text-[11px] opacity-60 hover:opacity-100 shrink-0">✓ lu</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* 2. À traiter maintenant — réponses reçues, réponse IA prête à envoyer */}
            <section>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h2 className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-orange-500" /> À traiter maintenant
                  <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${todo.length ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>{todo.length}</span>
                </h2>
                <div className="flex items-center gap-2">
                  {rtMsg && <span className="text-[11px] text-gray-500">{rtMsg}</span>}
                  <button onClick={enableRealtime} disabled={busy === 'rt'} title="Déclare le webhook Unipile : chaque réponse arrive ici instantanément" className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50">⚡ Activer le temps réel</button>
                </div>
              </div>
              <div className="bg-white border border-orange-200 rounded-lg divide-y divide-gray-100">
                {todo.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-sm">Rien en attente. Quand quelqu&apos;un répond, il apparaît ici avec une réponse prête. 👌</div>
                ) : todo.map((h) => (
                  <div key={h.id} className="px-3 py-3 text-sm space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${h.source === 'outreach' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>{h.source === 'outreach' ? 'Outreach' : 'Lead-magnet'}</span>
                      <span className="font-medium text-gray-900">{h.name || 'Anonyme'}</span>
                      {h.company && <span className="text-[11px] text-gray-500">· {h.company}</span>}
                      {h.campaign && <span className="text-[11px] text-gray-400">· {h.campaign}</span>}
                      {h.when && <span className="text-[11px] text-gray-400">· {formatDistanceToNow(h.when)}</span>}
                      <span className="flex-1" />
                      {h.profile_url && <a href={h.profile_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5">profil <ExternalLink className="w-2.5 h-2.5" /></a>}
                    </div>
                    {h.last_inbound && (
                      <div className="text-[13px] text-gray-800 bg-gray-50 border border-gray-100 rounded px-2.5 py-2">
                        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mr-1.5">Sa réponse</span>{h.last_inbound}
                      </div>
                    )}
                    {replyBlock(h, 'todo')}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Ouvre cette page à ton créneau de setting : tout ce qui a répondu est là, avec une réponse dans ta voix à valider en 1 clic.</p>
            </section>

            {/* 3. Leads chauds à relancer — ont répondu, traités, pas de RDV, silence 3 j+ */}
            <section>
              <h2 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-500" /> Leads chauds à relancer
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${data?.followups.length ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{data?.followups.length ?? 0}</span>
              </h2>
              <div className="bg-white border border-amber-200 rounded-lg divide-y divide-gray-100">
                {!data || data.followups.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-sm">Aucun lead chaud en attente de relance.</div>
                ) : data.followups.map((f) => (
                  <div key={f.id} className="px-3 py-3 text-sm space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${f.source === 'outreach' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>{f.source === 'outreach' ? 'Outreach' : 'Lead-magnet'}</span>
                      <span className="font-medium text-gray-900">{f.name || 'Anonyme'}</span>
                      {f.company && <span className="text-[11px] text-gray-500">· {f.company}</span>}
                      {f.campaign && <span className="text-[11px] text-gray-400">· {f.campaign}</span>}
                      <span className="text-[11px] text-amber-700">· traité {formatDistanceToNow(f.since)}, pas de RDV</span>
                    </div>
                    {f.last_inbound && <div className="text-[12px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-2.5 py-1.5 line-clamp-2">{f.last_inbound}</div>}
                    {replyBlock({ id: f.id, source: f.source, name: f.name, rdv: false }, 'followup')}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Ils ont répondu, tu as échangé, mais pas de RDV pris depuis 3 jours et plus : une relance courte ici, ou « RDV pris » / « Laisser tomber ».</p>
            </section>
          </>
        )}

        {tab === 'machine' && (
          <>
            {/* A. Campagnes — tunnel Envoyés → Retours → Succès */}
            <section>
              <h2 className="text-sm font-medium text-gray-900 mb-2">Campagnes de prospection</h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-50">
                      <th className="text-left font-semibold px-3 py-2">Campagne</th>
                      <th className="text-right font-semibold px-3 py-2">Envoyés</th>
                      <th className="text-right font-semibold px-3 py-2">Retours</th>
                      <th className="text-right font-semibold px-3 py-2">Succès (RDV)</th>
                      <th className="text-right font-semibold px-3 py-2">Taux réponse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.campaigns.length ? data.campaigns.map((c, i) => {
                      const tx = c.envoyes > 0 ? Math.round((c.retours / c.envoyes) * 100) : 0
                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <span className="font-medium text-gray-900">{c.name}</span>
                            <span className="text-[10px] text-gray-400 ml-1.5">{c.type}</span>
                            {c.active ? <span className="text-[10px] text-green-600 ml-1.5">● actif</span> : <span className="text-[10px] text-gray-400 ml-1.5">pause</span>}
                          </td>
                          <td className="text-right px-3 py-2 text-gray-700">{c.envoyes}</td>
                          <td className="text-right px-3 py-2 text-gray-700">{c.retours}</td>
                          <td className="text-right px-3 py-2 font-medium text-green-700">{c.succes}</td>
                          <td className="text-right px-3 py-2 text-gray-500">{tx}%</td>
                        </tr>
                      )
                    }) : (
                      <tr><td colSpan={5} className="text-center py-6 text-gray-400 text-xs">Aucune campagne.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* B. Semaine (navigable) */}
            <section>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h2 className="text-sm font-medium text-gray-900">Suivi par semaine</h2>
                <div className="inline-flex items-center gap-1 text-xs">
                  <button onClick={() => setWeek((x) => x + 1)} disabled={loading} className="px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40" title="Semaine précédente"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <span className="px-2 font-medium text-gray-700 min-w-[130px] text-center">{week === 0 ? 'Cette semaine' : w?.label || '…'}</span>
                  <button onClick={() => setWeek((x) => Math.max(0, x - 1))} disabled={loading || week === 0} className="px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40" title="Semaine suivante"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="text-[11px] text-gray-400 mb-2">{w?.label}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Messages envoyés</div>
                  <div className="text-2xl font-semibold text-gray-900">{w?.dm ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">sem. préc. : {w?.prev.dm ?? '—'}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Retours (réponses)</div>
                  <div className="text-2xl font-semibold text-gray-900">{w?.replies ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">sem. préc. : {w?.prev.replies ?? '—'}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Taux de réponse</div>
                  <div className="text-2xl font-semibold text-gray-900">{rate != null ? `${rate}%` : '—'}</div>
                  <div className="text-[10px] text-gray-400">réponses / envoyés</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Commentaires postés</div>
                  <div className="text-2xl font-semibold text-gray-900">{w?.comment ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">semaine sélectionnée</div>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Navigue de semaine en semaine avec les flèches. Les retours se comptent quand l&apos;app détecte la réponse (temps réel ou balayage du soir).</p>
            </section>

            {/* C. Moteurs de fond */}
            <section>
              <div className="flex flex-wrap gap-2">
                <div className="inline-flex items-center gap-2 text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5">
                  <Radio className={`w-3.5 h-3.5 ${data?.engines.comments.active ? 'text-green-500' : 'text-gray-300'}`} />
                  Commentaires auto {data?.engines.comments.active ? <span className="text-green-600">● tourne</span> : <span className="text-gray-400">off</span>}
                  <span className="text-gray-400">· {data?.engines.comments.posted_7j ?? 0} sur 7j</span>
                </div>
                <div className="inline-flex items-center gap-2 text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5">
                  <Radio className={`w-3.5 h-3.5 ${data?.engines.autoAccept.active ? 'text-green-500' : 'text-gray-300'}`} />
                  Acceptation d&apos;invitations {data?.engines.autoAccept.active ? <span className="text-green-600">● tourne</span> : <span className="text-gray-400">off</span>}
                  <span className="text-gray-400">· {data?.engines.autoAccept.accepted_7j ?? 0} sur 7j</span>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Rythme quotidien (lun–sam) : invitations acceptées 8h · lead-magnets 12h · outbound 14h→20h (CMO 14h, SEO 15h, 2e degré 16h) · détection des réponses 19h + temps réel.</p>
            </section>

            {/* D. Historique — ont répondu */}
            <section>
              <h2 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-gray-400" /> Historique — ont répondu {data && <span className="text-[11px] font-normal text-gray-500">({data.hot.count})</span>}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                {!data || data.hot.items.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">Personne pour l&apos;instant. 👌</div>
                ) : data.hot.items.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 px-3 py-2 text-sm flex-wrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${h.source === 'outreach' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                      {h.source === 'outreach' ? 'Outreach' : 'Lead-magnet'}
                    </span>
                    <span className="font-medium text-gray-900">{h.name || 'Anonyme'}</span>
                    {h.campaign && <span className="text-[11px] text-gray-400">· {h.campaign}</span>}
                    {h.when && <span className="text-[11px] text-gray-400">· {formatDistanceToNow(h.when)}</span>}
                    {h.rdv && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">RDV ✓</span>}
                    {!h.handled && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">à traiter</span>}
                    <span className="flex-1" />
                    {h.profile_url && (
                      <a href={h.profile_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5">profil <ExternalLink className="w-2.5 h-2.5" /></a>
                    )}
                    {!h.rdv && (
                      <button onClick={() => act(h, 'rdv')} disabled={busy === h.id + 'rdv'} className="text-[11px] px-2 py-1 border border-green-200 text-green-700 rounded hover:bg-green-50 inline-flex items-center gap-1 disabled:opacity-50">
                        <CheckCircle2 className="w-3 h-3" /> RDV
                      </button>
                    )}
                    <button onClick={() => act(h, 'crm')} disabled={busy === h.id + 'crm' || !h.provider_id} className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50" title={h.provider_id ? 'Envoyer dans le CRM' : 'Pas d’identifiant LinkedIn'}>
                      <UserPlus2 className="w-3 h-3" /> CRM
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">« RDV » marque un succès (compté par campagne). « CRM » bascule la personne dans tes leads.</p>
            </section>
          </>
        )}
      </div>
    </>
  )
}
