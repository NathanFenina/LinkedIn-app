'use client'

import { useEffect, useState, useCallback } from 'react'
import { Contact, ContactStatus, STATUS_LABELS, STATUS_OPTIONS } from '@/types'
import { Inbox, Sparkles, Send, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

const DEFAULT_GOAL =
  'répondre naturellement et humainement à son dernier message, faire avancer la conversation (vers un échange ou une ressource), sans pitcher, avec une seule question ouverte à la fin'

export default function InboxPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [preparingAll, setPreparingAll] = useState(false)
  const [msg, setMsg] = useState('')
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())

  const fetchInbox = useCallback(async () => {
    setLoading(true)
    try {
      const data: Contact[] = await fetch('/api/contacts?tab=conversations').then((r) => r.json())
      // « À répondre » = le contact a écrit en dernier (is_sender_last === false).
      const waiting = (Array.isArray(data) ? data : []).filter((c) => !c.is_sender_last)
      setContacts(waiting)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInbox()
  }, [fetchInbox])

  const draftFor = useCallback(
    async (id: string): Promise<string | null> => {
      const res = await fetch(`/api/contacts/${id}/generate-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim() || DEFAULT_GOAL }),
      })
      const data = await res.json()
      if (data.text) {
        setDrafts((prev) => ({ ...prev, [id]: data.text }))
        return data.text
      }
      return null
    },
    [goal]
  )

  const prepareOne = async (id: string) => {
    setBusyId(id)
    setMsg('Génération de la réponse…')
    await draftFor(id)
    setBusyId(null)
    setMsg('')
  }

  const prepareAll = async () => {
    const todo = contacts.filter((c) => !drafts[c.id] && !sentIds.has(c.id)).slice(0, 15)
    if (todo.length === 0) return
    setPreparingAll(true)
    setMsg(`Préparation de ${todo.length} réponse(s)… (rien n'est envoyé)`)
    for (const c of todo) {
      await draftFor(c.id).catch(() => null)
    }
    setPreparingAll(false)
    setMsg(`${todo.length} réponse(s) prête(s). Relis, édite, puis envoie une par une.`)
  }

  const send = async (c: Contact, status?: ContactStatus) => {
    const text = (drafts[c.id] || '').trim()
    if (!text) {
      setMsg('Erreur: réponse vide — génère ou écris un message avant d\'envoyer.')
      return
    }
    if (!confirm(`Envoyer ce message à ${c.name} ?`)) return
    setBusyId(c.id)
    setMsg('Envoi…')
    const res = await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: c.id, chat_id: c.chat_id, linkedin_id: c.linkedin_id, text }),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      setBusyId(null)
      setMsg(`Erreur: ${data.error || res.statusText}`)
      return
    }
    // Maj CRM : statut choisi (par défaut « en cours »).
    const newStatus = status || 'in_progress'
    await fetch(`/api/contacts/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    }).catch(() => {})
    setSentIds((prev) => new Set(prev).add(c.id))
    setBusyId(null)
    setMsg(`Envoyé à ${c.name} ✅ — statut passé à « ${STATUS_LABELS[newStatus]} ».`)
  }

  const isError = msg.toLowerCase().startsWith('erreur')
  const pending = contacts.filter((c) => !sentIds.has(c.id))
  const readyCount = pending.filter((c) => drafts[c.id]).length

  return (
    <>
      <header className="bg-white/90 backdrop-blur border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1000px] mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm">
              <Inbox className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 text-base leading-tight">Boîte de réception — à répondre</h1>
              <p className="text-xs text-gray-500">Conversations où la personne a écrit en dernier. L&apos;IA prépare, tu valides, tu envoies.</p>
            </div>
          </div>
          <button onClick={fetchInbox} disabled={loading}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
          </button>
        </div>
      </header>

      <div className="max-w-[1000px] mx-auto px-6 py-6 space-y-4">
        {/* Barre d'action */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold text-gray-900">{pending.length}</span>
            <span className="text-gray-500">à répondre</span>
            <span className="text-gray-300">·</span>
            <span className="font-semibold text-blue-600">{readyCount}</span>
            <span className="text-gray-500">réponse(s) prête(s)</span>
          </div>
          <label className="block text-xs font-medium text-gray-600">
            Objectif / ton des réponses (guide l&apos;IA)
            <input value={goal} onChange={(e) => setGoal(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none" />
          </label>
          <button onClick={prepareAll} disabled={preparingAll || pending.length === 0}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-sm">
            {preparingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Préparer les réponses (max 15)
          </button>
        </div>

        {msg && (
          <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 border ${isError ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
            {isError ? <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />}
            <span className="flex-1">{msg}</span>
            <button onClick={() => setMsg('')} className="opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {loading && contacts.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-10">Chargement…</div>
        )}

        {!loading && pending.length === 0 && (
          <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-white">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-gray-600 font-medium">Rien à répondre 🎉</p>
            <p className="text-xs text-gray-400 mt-1">Toutes tes conversations sont à jour (ou tu as répondu en dernier).</p>
          </div>
        )}

        {pending.map((c) => (
          <section key={c.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-900 text-sm truncate">{c.name}</h2>
                  {c.job_title && <span className="text-[11px] text-gray-400 truncate">{c.job_title}</span>}
                </div>
                {c.last_message && (
                  <p className="text-[13px] text-gray-600 mt-1 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
                    <span className="text-[10px] uppercase text-gray-400 font-semibold mr-1">reçu</span>
                    {c.last_message}
                  </p>
                )}
              </div>
              <span className="text-[10px] text-gray-400 shrink-0">{c.last_message_at ? formatDistanceToNow(c.last_message_at) : ''}</span>
            </div>

            {drafts[c.id] !== undefined ? (
              <div className="mt-3">
                <div className="text-[10px] font-bold uppercase text-blue-600 mb-1">Réponse proposée — édite librement</div>
                <textarea
                  value={drafts[c.id]}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  rows={3}
                  className="w-full text-sm text-gray-900 border border-gray-200 rounded-lg p-2.5 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button disabled={busyId === c.id} onClick={() => prepareOne(c.id)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {busyId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {drafts[c.id] !== undefined ? 'Régénérer' : 'Préparer une réponse'}
              </button>
              <button disabled={busyId === c.id || !drafts[c.id]?.trim()} onClick={() => send(c)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
                <Send className="w-3.5 h-3.5" /> Envoyer
              </button>
              <select
                onChange={(e) => { if (e.target.value) send(c, e.target.value as ContactStatus) }}
                defaultValue=""
                disabled={busyId === c.id || !drafts[c.id]?.trim()}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 text-gray-600 disabled:opacity-40"
                title="Envoyer ET fixer le statut CRM">
                <option value="">Envoyer + statut…</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>Envoyer → {STATUS_LABELS[s]}</option>)}
              </select>
              {c.profile_url && (
                <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 inline-flex items-center gap-1 ml-auto hover:underline">
                  profil <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
