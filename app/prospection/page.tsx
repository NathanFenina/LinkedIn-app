'use client'

import { useEffect, useState, useCallback } from 'react'
import { Contact } from '@/types'
import { Target, Sparkles, Send, Loader2, CheckCircle2, AlertCircle, X, Flame, Clock, UserPlus2, ExternalLink } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface TreatRow { contact: Contact; tier: string; score: number }
interface RelanceRow extends TreatRow { step: { label: string; goal: string } }
interface Person { provider_id: string | null; name: string | null; headline: string | null; profile_url: string | null; public_identifier: string | null; already_in_crm: boolean }

const TIER_CLS: Record<string, string> = { P1: 'bg-red-100 text-red-700', P2: 'bg-amber-100 text-amber-700', P3: 'bg-gray-100 text-gray-500' }

export default function ProspectionPage() {
  const [tab, setTab] = useState<'treat' | 'relance' | 'source'>('treat')
  const [toTreat, setToTreat] = useState<TreatRow[]>([])
  const [relances, setRelances] = useState<RelanceRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  // sourcing
  const [searchUrl, setSearchUrl] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [pDraft, setPDraft] = useState<Record<string, string>>({})
  const [pDone, setPDone] = useState<Set<string>>(new Set())

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

  // --- Sourcing outbound ---
  const source = async () => {
    if (!searchUrl.includes('linkedin.com')) { setMsg('Colle une URL de recherche LinkedIn.'); return }
    setLoading(true); setMsg('Recherche des profils…')
    const res = await fetch('/api/prospection/source', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ search_url: searchUrl.trim() }),
    })
    const d = await res.json()
    setLoading(false)
    if (d.error) { setMsg(`Erreur: ${d.error}`); return }
    setPeople(d.people || [])
    setMsg(`${d.fresh} nouveau(x) sur ${d.total} profils (le reste est déjà dans ton CRM).`)
  }

  const prepInvite = async (p: Person) => {
    if (!p.provider_id) return
    setBusyId(p.provider_id)
    const res = await fetch('/api/prospection/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preview: true, name: p.name, headline: p.headline }),
    })
    const d = await res.json()
    if (d.preview_message !== undefined) setPDraft((prev) => ({ ...prev, [p.provider_id!]: d.preview_message }))
    setBusyId(null)
  }

  const sendInvite = async (p: Person) => {
    if (!p.provider_id) return
    if (!confirm(`Inviter ${p.name} ?`)) return
    setBusyId(p.provider_id); setMsg('Envoi de l\'invitation…')
    const res = await fetch('/api/prospection/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: p.provider_id, message: (pDraft[p.provider_id] || '').trim() || undefined }),
    })
    const d = await res.json()
    setBusyId(null)
    if (!res.ok || d.error) { setMsg(`Erreur: ${d.error || res.statusText}${d.limited ? ' (garde-fou)' : ''}`); return }
    setPDone((prev) => new Set(prev).add(p.provider_id!))
    setMsg(`Invitation envoyée à ${p.name} ✅`)
  }

  const isError = msg.toLowerCase().startsWith('erreur')
  const TABS = [
    { k: 'treat' as const, label: 'À traiter', icon: Flame, count: toTreat.length },
    { k: 'relance' as const, label: 'Relances dues', icon: Clock, count: relances.length },
    { k: 'source' as const, label: 'Nouveaux à prospecter', icon: UserPlus2 },
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

        {/* À TRAITER */}
        {tab === 'treat' && (
          <div className="space-y-2">
            {loading && toTreat.length === 0 && <div className="text-center text-sm text-gray-400 py-8">Chargement…</div>}
            {!loading && toTreat.length === 0 && <Empty label="Rien à traiter 🎉 (personne n'attend ta réponse)" />}
            {toTreat.map(({ contact: c, tier }) => (
              <LeadCard key={c.id} c={c} tier={tier} draft={drafts[c.id]} busy={busyId === c.id}
                onGen={() => genFor(c.id)} onDraft={(t) => setDrafts((p) => ({ ...p, [c.id]: t }))}
                onSend={() => sendReply(c)} sendLabel="Répondre" />
            ))}
          </div>
        )}

        {/* RELANCES */}
        {tab === 'relance' && (
          <div className="space-y-2">
            {!loading && relances.length === 0 && <Empty label="Aucune relance due aujourd'hui ✅" />}
            {relances.map(({ contact: c, tier, step }) => (
              <LeadCard key={c.id} c={c} tier={tier} draft={drafts[c.id]} busy={busyId === c.id}
                badge={`Relance ${(c.relance_count || 0) + 1}/3 · ${step.label}`}
                onGen={() => genFor(c.id, step.goal)} onDraft={(t) => setDrafts((p) => ({ ...p, [c.id]: t }))}
                onSend={() => sendRelance(c)} sendLabel="Relancer" />
            ))}
          </div>
        )}

        {/* SOURCING */}
        {tab === 'source' && (
          <div className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Colle une URL de recherche LinkedIn (Sales Nav / recherche de personnes — ex. CMO SaaS France)
              </label>
              <div className="flex gap-2">
                <input value={searchUrl} onChange={(e) => setSearchUrl(e.target.value)}
                  placeholder="https://www.linkedin.com/search/results/people/?keywords=..."
                  className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:border-blue-400 focus:outline-none" />
                <button onClick={source} disabled={loading}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />} Sourcer
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Les profils déjà dans ton CRM (déjà échangé) sont marqués — tu ne re-prospectes pas quelqu&apos;un que tu connais.</p>
            </div>
            {people.map((p) => {
              const key = p.provider_id || p.public_identifier || p.name || ''
              const draft = p.provider_id ? pDraft[p.provider_id] : undefined
              const done = p.provider_id ? pDone.has(p.provider_id) : false
              return (
                <div key={key} className={`bg-white border rounded-xl p-4 shadow-sm ${p.already_in_crm ? 'border-gray-100 opacity-70' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 text-sm truncate flex items-center gap-2">
                        {p.name || 'Profil'}
                        {p.already_in_crm && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">déjà échangé</span>}
                      </div>
                      {p.headline && <div className="text-[12px] text-gray-500 truncate">{p.headline}</div>}
                    </div>
                    {p.profile_url && <a href={p.profile_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 inline-flex items-center gap-0.5 ml-auto shrink-0 hover:underline">profil <ExternalLink className="w-2.5 h-2.5" /></a>}
                  </div>
                  {!p.already_in_crm && !done && (
                    <>
                      {draft !== undefined && (
                        <textarea value={draft} onChange={(e) => setPDraft((prev) => ({ ...prev, [p.provider_id!]: e.target.value }))} rows={3} maxLength={300}
                          className="mt-2 w-full text-[13px] text-gray-900 border border-gray-200 rounded-lg p-2 focus:border-blue-400 focus:outline-none" />
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        {draft === undefined ? (
                          <button disabled={busyId === p.provider_id} onClick={() => prepInvite(p)}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                            {busyId === p.provider_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Préparer le message
                          </button>
                        ) : (
                          <button disabled={busyId === p.provider_id} onClick={() => sendInvite(p)}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                            <Send className="w-3.5 h-3.5" /> Envoyer l&apos;invitation
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {done && <div className="text-xs text-green-600 mt-1 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> invitation envoyée</div>}
                </div>
              )
            })}
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

function LeadCard({ c, tier, draft, busy, badge, sendLabel, onGen, onDraft, onSend }: {
  c: Contact; tier: string; draft?: string; busy: boolean; badge?: string; sendLabel: string
  onGen: () => void; onDraft: (t: string) => void; onSend: () => void
}) {
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
        </div>
      </div>
      {draft !== undefined && (
        <textarea value={draft} onChange={(e) => onDraft(e.target.value)} rows={3}
          className="mt-2 w-full text-[13px] text-gray-900 border border-gray-200 rounded-lg p-2 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none" />
      )}
      <div className="flex items-center gap-2 mt-2">
        <button disabled={busy} onClick={onGen} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} {draft !== undefined ? 'Régénérer' : 'Préparer le message'}
        </button>
        <button disabled={busy || !draft?.trim()} onClick={onSend} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
          <Send className="w-3.5 h-3.5" /> {sendLabel}
        </button>
      </div>
    </div>
  )
}
