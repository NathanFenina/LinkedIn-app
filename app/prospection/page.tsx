'use client'

import { useEffect, useState, useCallback } from 'react'
import { Contact, ContactStatus, STATUS_LABELS, STATUS_OPTIONS } from '@/types'
import { Target, Sparkles, Send, Loader2, CheckCircle2, AlertCircle, X, Flame, Clock, UserPlus2, ExternalLink, History, ChevronDown, Ban } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface TreatRow { contact: Contact; tier: string; score: number }
interface RelanceRow extends TreatRow { step: { label: string; goal: string } }

const TIER_CLS: Record<string, string> = { P1: 'bg-red-100 text-red-700', P2: 'bg-amber-100 text-amber-700', P3: 'bg-gray-100 text-gray-500' }

export default function ProspectionPage() {
  const [tab, setTab] = useState<'treat' | 'relance'>('treat')
  const [toTreat, setToTreat] = useState<TreatRow[]>([])
  const [relances, setRelances] = useState<RelanceRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [deciderOnly, setDeciderOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [historyById, setHistoryById] = useState<Record<string, Array<{ text: string; is_sender: boolean }>>>({})
  const [historyLoading, setHistoryLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetch('/api/prospection').then((r) => r.json())
      if (d.error) { setMsg(`Erreur: ${d.error}`); return }
      setToTreat(d.toTreat || [])
      setRelances(d.relances || [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const DECIDER_RE = /\b(cmo|ceo|coo|founder|fondateur|dirigeant|g[ée]rant|head of|vp|directeur|director|chief|owner)\b/i
  const isDecider = (c: Contact) => DECIDER_RE.test(c.job_title || '')
  const applyFilter = <T extends { contact: Contact }>(rows: T[]) => (deciderOnly ? rows.filter((r) => isDecider(r.contact)) : rows)

  const setStatus = async (c: Contact, status: ContactStatus) => {
    setToTreat((p) => p.map((r) => (r.contact.id === c.id ? { ...r, contact: { ...r.contact, status } } : r)))
    setRelances((p) => p.map((r) => (r.contact.id === c.id ? { ...r, contact: { ...r.contact, status } } : r)))
    await fetch(`/api/contacts/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).catch(() => {})
  }

  const dismiss = async (c: Contact) => {
    setToTreat((p) => p.filter((r) => r.contact.id !== c.id))
    setRelances((p) => p.filter((r) => r.contact.id !== c.id))
    await fetch(`/api/contacts/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'do_not_contact' }) }).catch(() => {})
    setMsg(`${c.name} écarté (non qualifié).`)
  }

  const toggleHistory = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!historyById[id]) {
      setHistoryLoading(id)
      const d = await fetch(`/api/contacts/${id}/thread`).then((r) => r.json()).catch(() => [])
      setHistoryById((p) => ({ ...p, [id]: Array.isArray(d) ? d : [] }))
      setHistoryLoading(null)
    }
  }

  const genFor = async (id: string, goal?: string) => {
    setBusyId(id)
    const res = await fetch(`/api/contacts/${id}/generate-message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: goal || 'répondre naturellement, faire avancer sans pitcher, une seule question ouverte à la fin' }),
    })
    const d = await res.json()
    if (d.text) setDrafts((p) => ({ ...p, [id]: d.text }))
    setBusyId(null)
  }

  const sendReply = async (c: Contact) => {
    const text = (drafts[c.id] || '').trim()
    if (!text || !confirm(`Envoyer à ${c.name} ?`)) return
    setBusyId(c.id); setMsg('Envoi…')
    const res = await fetch('/api/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: c.id, chat_id: c.chat_id, linkedin_id: c.linkedin_id, text }),
    })
    const d = await res.json()
    setBusyId(null)
    if (!res.ok || d.error) { setMsg(`Erreur: ${d.error || res.statusText}${d.limited ? ' (garde-fou)' : ''}`); return }
    setToTreat((p) => p.filter((x) => x.contact.id !== c.id))
    setMsg(`Envoyé à ${c.name} ✅`)
  }

  const sendRelance = async (c: Contact) => {
    const text = (drafts[c.id] || '').trim()
    if (!text || !confirm(`Relancer ${c.name} ?`)) return
    setBusyId(c.id); setMsg('Relance…')
    const res = await fetch('/api/prospection/relance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: c.id, chat_id: c.chat_id, text }),
    })
    const d = await res.json()
    setBusyId(null)
    if (!res.ok || d.error) { setMsg(`Erreur: ${d.error || res.statusText}${d.limited ? ' (garde-fou)' : ''}`); return }
    setRelances((p) => p.filter((x) => x.contact.id !== c.id))
    setMsg(`Relancé ${c.name} ✅ (relance n°${d.relance_count})`)
  }

  const isError = msg.toLowerCase().startsWith('erreur')
  const TABS = [
    { k: 'treat' as const, label: 'À traiter', icon: Flame, count: toTreat.length },
    { k: 'relance' as const, label: 'Relances dues', icon: Clock, count: relances.length },
  ]

  return (
    <>
      <header className="bg-white/90 backdrop-blur border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-3 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm"><Target className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Prospection</h1>
            <p className="text-xs text-gray-500">Ton cockpit setting : qui traiter, qui relancer, qui prospecter — dans l&apos;ordre.</p>
          </div>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map(({ k, label, icon: Icon, count }) => (
            <button key={k} onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border transition ${tab === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Icon className="w-4 h-4" /> {label}{typeof count === 'number' && <span className={`text-[11px] ${tab === k ? 'text-blue-100' : 'text-gray-400'}`}>({count})</span>}
            </button>
          ))}
        </div>

        {msg && (
          <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 border ${isError ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
            {isError ? <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />}
            <span className="flex-1">{msg}</span>
            <button onClick={() => setMsg('')} className="opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {(tab === 'treat' || tab === 'relance') && (
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={deciderOnly} onChange={(e) => setDeciderOnly(e.target.checked)} />
            Décideurs seulement (CMO / CEO / founder…) — masque les agences & prestataires
          </label>
        )}

        {/* À TRAITER */}
        {tab === 'treat' && (
          <div className="space-y-2">
            {loading && toTreat.length === 0 && <div className="text-center text-sm text-gray-400 py-8">Chargement…</div>}
            {!loading && applyFilter(toTreat).length === 0 && <Empty label="Rien à traiter 🎉" />}
            {applyFilter(toTreat).map(({ contact: c, tier }) => (
              <LeadCard key={c.id} c={c} tier={tier} draft={drafts[c.id]} busy={busyId === c.id} sendLabel="Répondre"
                onGen={() => genFor(c.id)} onDraft={(t) => setDrafts((p) => ({ ...p, [c.id]: t }))} onSend={() => sendReply(c)}
                onStatus={(s) => setStatus(c, s)} onDismiss={() => dismiss(c)}
                expanded={expandedId === c.id} history={historyById[c.id]} historyLoading={historyLoading === c.id} onToggleHistory={() => toggleHistory(c.id)} />
            ))}
          </div>
        )}

        {/* RELANCES */}
        {tab === 'relance' && (
          <div className="space-y-2">
            {!loading && applyFilter(relances).length === 0 && <Empty label="Aucune relance due aujourd'hui ✅" />}
            {applyFilter(relances).map(({ contact: c, tier, step }) => (
              <LeadCard key={c.id} c={c} tier={tier} draft={drafts[c.id]} busy={busyId === c.id} sendLabel="Relancer"
                badge={`Relance ${(c.relance_count || 0) + 1}/3 · ${step.label}`}
                onGen={() => genFor(c.id, step.goal)} onDraft={(t) => setDrafts((p) => ({ ...p, [c.id]: t }))} onSend={() => sendRelance(c)}
                onStatus={(s) => setStatus(c, s)} onDismiss={() => dismiss(c)}
                expanded={expandedId === c.id} history={historyById[c.id]} historyLoading={historyLoading === c.id} onToggleHistory={() => toggleHistory(c.id)} />
            ))}
          </div>
        )}

      </div>
    </>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-white">
      <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
      <p className="text-sm text-gray-600 font-medium">{label}</p>
    </div>
  )
}

function LeadCard({ c, tier, draft, busy, badge, sendLabel, onGen, onDraft, onSend, onStatus, onDismiss, expanded, history, historyLoading, onToggleHistory }: {
  c: Contact; tier: string; draft?: string; busy: boolean; badge?: string; sendLabel: string
  onGen: () => void; onDraft: (t: string) => void; onSend: () => void
  onStatus: (s: ContactStatus) => void; onDismiss: () => void
  expanded: boolean; history?: Array<{ text: string; is_sender: boolean }>; historyLoading: boolean; onToggleHistory: () => void
}) {
  const text = draft ?? ''
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {c.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 border border-gray-100" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-semibold shrink-0">{(c.name || '?').slice(0, 1).toUpperCase()}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{c.name}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TIER_CLS[tier] || TIER_CLS.P3}`}>{tier}</span>
            {badge && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{badge}</span>}
            {c.last_message_at && <span className="text-[10px] text-gray-400">{formatDistanceToNow(c.last_message_at)}</span>}
          </div>
          {c.job_title && <div className="text-[11px] text-gray-400 line-clamp-1">{c.job_title}</div>}
          {c.last_message && <div className="text-[12px] text-gray-500 mt-1 line-clamp-2 bg-gray-50 rounded px-2 py-1">{c.last_message}</div>}
          <button onClick={onToggleHistory} className="mt-1 inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline">
            <History className="w-3 h-3" /> historique <ChevronDown className={`w-3 h-3 transition ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <select value={c.status} onChange={(e) => onStatus(e.target.value as ContactStatus)} className="text-[11px] border border-gray-300 rounded-lg px-1.5 py-1 text-gray-600 shrink-0">
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {expanded && (
        <div className="mt-2 bg-gray-50 rounded-lg p-2.5 space-y-1.5">
          {historyLoading ? (
            <div className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> chargement…</div>
          ) : (history || []).length === 0 ? (
            <div className="text-xs text-gray-400">Aucun message récupéré.</div>
          ) : (history || []).map((m, i) => (
            <div key={i} className={`flex ${m.is_sender ? 'justify-end' : 'justify-start'}`}>
              <div className={`text-[13px] rounded-2xl px-3 py-1.5 max-w-[80%] ${m.is_sender ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>{m.text}</div>
            </div>
          ))}
        </div>
      )}

      <textarea value={text} onChange={(e) => onDraft(e.target.value)} rows={3}
        placeholder="écris ta réponse, ou clique « IA » pour la générer…"
        className="mt-2 w-full text-[13px] text-gray-900 border border-gray-200 rounded-lg p-2 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none" />
      <div className="flex items-center gap-2 mt-2">
        <button disabled={busy} onClick={onGen} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} {text ? 'Régénérer IA' : 'IA'}
        </button>
        <button disabled={busy || !text.trim()} onClick={onSend} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
          <Send className="w-3.5 h-3.5" /> {sendLabel}
        </button>
        <button onClick={onDismiss} title="Écarter (non qualifié) — le sort de la liste"
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-200 text-gray-400 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 ml-auto">
          <Ban className="w-3.5 h-3.5" /> Écarter
        </button>
      </div>
    </div>
  )
}
