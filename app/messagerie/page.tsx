'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Contact, ContactStatus, STATUS_LABELS, STATUS_OPTIONS } from '@/types'
import { MessageSquare, Sparkles, Send, RefreshCw, Loader2, CheckCircle2, AlertCircle, X, Check, Star, Mail } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

const DEFAULT_GOAL =
  'répondre naturellement et humainement à son dernier message, faire avancer la conversation, sans pitcher, avec une seule question ouverte à la fin'
const READ_KEY = 'messagerie_read_v1'

type Filter = 'unread' | 'important' | 'all'

export default function MessageriePage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [filter, setFilter] = useState<Filter>('unread')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [readIds, setReadIds] = useState<Set<string>>(new Set())

  // "Marqué lu" persistant côté navigateur (local, aucune action LinkedIn).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(READ_KEY)
      if (raw) setReadIds(new Set(JSON.parse(raw)))
    } catch {}
  }, [])
  const persistRead = (s: Set<string>) => {
    try { localStorage.setItem(READ_KEY, JSON.stringify([...s])) } catch {}
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const data: Contact[] = await fetch('/api/contacts?tab=conversations').then((r) => r.json())
      setContacts(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { fetchData() }, [fetchData])

  const isUnread = (c: Contact) => !c.is_sender_last && !readIds.has(c.id)
  const isImportant = (c: Contact) => (c.score || 0) >= 7

  const rows = useMemo(() => {
    let list = contacts
    if (filter === 'unread') list = contacts.filter(isUnread)
    else if (filter === 'important') list = contacts.filter((c) => isImportant(c) && !readIds.has(c.id))
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, filter, readIds])

  const unreadCount = contacts.filter(isUnread).length
  const importantCount = contacts.filter((c) => isImportant(c) && isUnread(c)).length

  const draftFor = useCallback(async (id: string): Promise<string | null> => {
    const res = await fetch(`/api/contacts/${id}/generate-message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: goal.trim() || DEFAULT_GOAL }),
    })
    const data = await res.json()
    if (data.text) { setDrafts((p) => ({ ...p, [id]: data.text })); return data.text }
    return null
  }, [goal])

  const prepareOne = async (id: string) => { setBusyId(id); setMsg(''); await draftFor(id); setBusyId(null) }

  const prepareSelected = async () => {
    const todo = rows.filter((c) => selected.has(c.id) && !drafts[c.id]).slice(0, 15)
    if (!todo.length) return
    setBulkBusy(true); setMsg(`Préparation de ${todo.length} réponse(s)… (rien n'est envoyé)`)
    for (const c of todo) await draftFor(c.id).catch(() => null)
    setBulkBusy(false); setMsg(`${todo.length} réponse(s) prête(s). Relis, édite, puis envoie.`)
  }

  const sendOne = async (c: Contact): Promise<boolean> => {
    const text = (drafts[c.id] || '').trim()
    if (!text) return false
    const res = await fetch('/api/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: c.id, chat_id: c.chat_id, linkedin_id: c.linkedin_id, text }),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      setMsg(`Erreur: ${data.error || res.statusText}${data.limited ? ' (garde-fou LinkedIn)' : ''}`)
      return false
    }
    // maj optimiste : la personne n'est plus "en attente".
    setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_sender_last: true } : x)))
    setSelected((prev) => { const n = new Set(prev); n.delete(c.id); return n })
    return true
  }

  const send = async (c: Contact) => {
    if (!confirm(`Envoyer ce message à ${c.name} ?`)) return
    setBusyId(c.id); setMsg('Envoi…')
    const ok = await sendOne(c)
    setBusyId(null)
    if (ok) setMsg(`Envoyé à ${c.name} ✅`)
  }

  const sendSelected = async () => {
    const targets = rows.filter((c) => selected.has(c.id) && (drafts[c.id] || '').trim())
    if (!targets.length) { setMsg('Aucune réponse prête dans la sélection.'); return }
    if (!confirm(`Envoyer ${targets.length} message(s) ? (délai aléatoire entre chaque)`)) return
    setBulkBusy(true); let ok = 0
    for (const c of targets) {
      const done = await sendOne(c)
      if (done) { ok++; setMsg(`${ok}/${targets.length} envoyé(s)…`) }
      else break // garde-fou / erreur → on stoppe le bulk
      await new Promise((r) => setTimeout(r, 20000 + Math.random() * 20000)) // 20-40s
    }
    setBulkBusy(false); setMsg(`${ok} message(s) envoyé(s).`)
  }

  const setStatus = async (c: Contact, status: ContactStatus) => {
    setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, status } : x)))
    await fetch(`/api/contacts/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }).catch(() => {})
  }

  const markRead = (ids: string[]) => {
    setReadIds((prev) => { const n = new Set(prev); ids.forEach((i) => n.add(i)); persistRead(n); return n })
    setSelected((prev) => { const n = new Set(prev); ids.forEach((i) => n.delete(i)); return n })
  }

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSel = rows.length > 0 && rows.every((c) => selected.has(c.id))
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(rows.map((c) => c.id)))

  const isError = msg.toLowerCase().startsWith('erreur')
  const FILTERS: { k: Filter; label: string; icon: typeof Mail; count?: number }[] = [
    { k: 'unread', label: 'Non lus', icon: Mail, count: unreadCount },
    { k: 'important', label: 'Importants', icon: Star, count: importantCount },
    { k: 'all', label: 'Tous', icon: MessageSquare },
  ]

  return (
    <>
      <header className="bg-white/90 backdrop-blur border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1300px] mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm"><MessageSquare className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="font-semibold text-gray-900 text-base leading-tight">Messagerie</h1>
              <p className="text-xs text-gray-500">Tes conversations. L&apos;IA prépare la réponse, tu valides et tu envoies (à l&apos;unité ou en lot).</p>
            </div>
          </div>
          <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
          </button>
        </div>
      </header>

      <div className="max-w-[1300px] mx-auto px-6 py-6 space-y-4">
        {/* Filtres */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(({ k, label, icon: Icon, count }) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition ${filter === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Icon className="w-3.5 h-3.5" /> {label}{typeof count === 'number' && <span className={`text-[10px] ${filter === k ? 'text-blue-100' : 'text-gray-400'}`}>({count})</span>}
            </button>
          ))}
        </div>

        {/* Barre d'action */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-gray-600 mr-1">
            <input type="checkbox" checked={allSel} onChange={toggleAll} /> {selected.size > 0 ? `${selected.size} sél.` : 'Tout'}
          </label>
          <div className="h-4 w-px bg-gray-200 mx-1" />
          <button disabled={bulkBusy || selected.size === 0} onClick={prepareSelected} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Préparer (sél.)
          </button>
          <button disabled={bulkBusy || selected.size === 0} onClick={sendSelected} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
            <Send className="w-3.5 h-3.5" /> Envoyer (sél.)
          </button>
          <button disabled={selected.size === 0} onClick={() => markRead([...selected])} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <Check className="w-3.5 h-3.5" /> Marquer lu (sél.)
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 ml-auto">
            ton IA :
            <input value={goal} onChange={(e) => setGoal(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-[11px] w-64 focus:border-blue-400 focus:outline-none" />
          </label>
        </div>

        {msg && (
          <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 border ${isError ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
            {isError ? <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />}
            <span className="flex-1">{msg}</span>
            <button onClick={() => setMsg('')} className="opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {/* Tableau */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="w-8 p-3"></th>
                <th className="text-left font-semibold p-3 min-w-[160px]">Contact</th>
                <th className="text-left font-semibold p-3 min-w-[220px]">Dernier message reçu</th>
                <th className="text-left font-semibold p-3 min-w-[280px]">Message proposé</th>
                <th className="text-left font-semibold p-3 min-w-[130px]">Statut CRM</th>
                <th className="text-right font-semibold p-3 min-w-[150px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 align-top">
                  <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td className="p-3">
                    <div className="font-medium text-gray-900 flex items-center gap-1">{c.name}{isImportant(c) && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}</div>
                    {c.job_title && <div className="text-[11px] text-gray-400 line-clamp-1">{c.job_title}</div>}
                    <div className="text-[10px] text-gray-300">{c.last_message_at ? formatDistanceToNow(c.last_message_at) : ''}</div>
                  </td>
                  <td className="p-3 text-[13px] text-gray-600"><div className="line-clamp-3">{c.last_message || <span className="text-gray-300">—</span>}</div></td>
                  <td className="p-3">
                    {drafts[c.id] !== undefined ? (
                      <textarea value={drafts[c.id]} onChange={(e) => setDrafts((p) => ({ ...p, [c.id]: e.target.value }))} rows={3}
                        className="w-full text-[13px] text-gray-900 border border-gray-200 rounded-lg p-2 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none" />
                    ) : (
                      <button disabled={busyId === c.id} onClick={() => prepareOne(c.id)} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                        {busyId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Préparer
                      </button>
                    )}
                  </td>
                  <td className="p-3">
                    <select value={c.status} onChange={(e) => setStatus(c, e.target.value as ContactStatus)} className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 text-gray-600">
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button disabled={busyId === c.id || !drafts[c.id]?.trim()} onClick={() => send(c)} title="Envoyer"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-30">
                        <Send className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => markRead([c.id])} title="Marquer comme lu (le sort de la to-do)"
                        className="inline-flex items-center text-xs px-2 py-1.5 border border-gray-200 text-gray-400 rounded-lg hover:bg-gray-100 hover:text-gray-600">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && rows.length === 0 && (
            <div className="text-center py-16">
              <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-gray-600 font-medium">{filter === 'unread' ? 'Rien à répondre 🎉' : 'Aucune conversation ici.'}</p>
            </div>
          )}
          {loading && rows.length === 0 && <div className="text-center text-sm text-gray-400 py-10">Chargement…</div>}
        </div>
      </div>
    </>
  )
}
