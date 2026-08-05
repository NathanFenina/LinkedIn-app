'use client'

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import { Contact, ContactStatus, STATUS_LABELS, STATUS_OPTIONS } from '@/types'
import { MessageSquare, Sparkles, Send, RefreshCw, Loader2, CheckCircle2, AlertCircle, X, Check, Star, Mail, History, ChevronDown } from 'lucide-react'
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
  // "Lu/Traité" = map { contactId → last_message_at au moment où on l'a marqué }.
  // Si un message plus récent arrive, la conv redevient non-lue automatiquement.
  const [readMap, setReadMap] = useState<Record<string, string>>({})
  const [syncing, setSyncing] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [historyById, setHistoryById] = useState<Record<string, Array<{ text: string; is_sender: boolean; timestamp: string }>>>({})
  const [historyLoading, setHistoryLoading] = useState<string | null>(null)

  // "Traité" persistant côté navigateur (local, aucune action LinkedIn).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(READ_KEY)
      if (raw) setReadMap(JSON.parse(raw))
    } catch {}
  }, [])
  const persistRead = (m: Record<string, string>) => {
    try { localStorage.setItem(READ_KEY, JSON.stringify(m)) } catch {}
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

  // Rafraîchir = RESYNCHRONISER depuis LinkedIn (pour refléter ce que tu as
  // traité directement sur LinkedIn), puis recharger.
  const refresh = async () => {
    setSyncing(true); setMsg('Synchronisation depuis LinkedIn…')
    try {
      await fetch('/api/sync/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageSize: 40 }),
      })
    } catch {}
    await fetchData()
    setSyncing(false); setMsg('')
  }

  // Lu = marqué traité ET aucun message plus récent depuis. Comparaison par
  // timestamp epoch (robuste aux différences de format de date renvoyées par la
  // sync — sinon un même message pouvait "remonter" après resync).
  const isRead = (c: Contact) => {
    const marked = readMap[c.id]
    if (!marked) return false
    if (!c.last_message_at) return true
    return new Date(c.last_message_at).getTime() <= new Date(marked).getTime() + 1000
  }
  const isUnread = (c: Contact) => !c.is_sender_last && !isRead(c)
  const isImportant = (c: Contact) => (c.score || 0) >= 7

  const rows = useMemo(() => {
    let list = contacts
    if (filter === 'unread') list = contacts.filter(isUnread)
    else if (filter === 'important') list = contacts.filter((c) => isImportant(c) && !isRead(c))
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, filter, readMap])

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
    setReadMap((prev) => {
      const n = { ...prev }
      const now = new Date().toISOString()
      ids.forEach((i) => { const c = contacts.find((x) => x.id === i); n[i] = c?.last_message_at || now })
      persistRead(n)
      return n
    })
    setSelected((prev) => { const n = new Set(prev); ids.forEach((i) => n.delete(i)); return n })
  }

  const toggleHistory = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!historyById[id]) {
      setHistoryLoading(id)
      const data = await fetch(`/api/contacts/${id}/thread`).then((r) => r.json()).catch(() => [])
      setHistoryById((p) => ({ ...p, [id]: Array.isArray(data) ? data : [] }))
      setHistoryLoading(null)
    }
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
          <button onClick={refresh} disabled={loading || syncing} title="Resynchronise depuis LinkedIn puis recharge"
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading || syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Sync…' : 'Rafraîchir'}
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
              {rows.map((c) => {
                const text = drafts[c.id] ?? ''
                return (
                <Fragment key={c.id}>
                <tr className="border-b border-gray-50 hover:bg-gray-50/50 align-top">
                  <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {c.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-gray-100" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-[11px] font-semibold shrink-0">
                          {(c.name || '?').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 flex items-center gap-1 text-[13px]">{c.name}{isImportant(c) && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}</div>
                        {c.job_title && <div className="text-[10px] text-gray-400 line-clamp-1">{c.job_title}</div>}
                        <div className="text-[10px] text-gray-300">{c.last_message_at ? formatDistanceToNow(c.last_message_at) : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-[13px] text-gray-600">
                    <div className="line-clamp-3">{c.last_message || <span className="text-gray-300">—</span>}</div>
                    <button onClick={() => toggleHistory(c.id)} className="mt-1 inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline">
                      <History className="w-3 h-3" /> historique <ChevronDown className={`w-3 h-3 transition ${expandedId === c.id ? 'rotate-180' : ''}`} />
                    </button>
                  </td>
                  <td className="p-3">
                    <textarea
                      value={text}
                      onChange={(e) => setDrafts((p) => ({ ...p, [c.id]: e.target.value }))}
                      rows={3}
                      placeholder="écris ta réponse, ou clique « IA » pour la générer…"
                      className="w-full text-[13px] text-gray-900 border border-gray-200 rounded-lg p-2 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                    />
                    <button disabled={busyId === c.id} onClick={() => prepareOne(c.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                      {busyId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {text ? 'Régénérer IA' : 'IA'}
                    </button>
                  </td>
                  <td className="p-3">
                    <select value={c.status} onChange={(e) => setStatus(c, e.target.value as ContactStatus)} className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 text-gray-600">
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col items-end gap-1.5">
                      <button disabled={busyId === c.id || !text.trim()} onClick={() => send(c)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-30 w-full justify-center">
                        <Send className="w-3.5 h-3.5" /> Envoyer
                      </button>
                      <button onClick={() => markRead([c.id])} title="Traité — le sort des non lus"
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 border border-gray-200 text-gray-500 rounded-lg hover:bg-green-50 hover:text-green-700 hover:border-green-200 w-full justify-center">
                        <Check className="w-3.5 h-3.5" /> Traité
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedId === c.id && (
                  <tr className="bg-gray-50/70">
                    <td></td>
                    <td colSpan={5} className="p-3">
                      <div className="text-[10px] font-bold uppercase text-gray-400 mb-1.5">Historique de la conversation</div>
                      {historyLoading === c.id ? (
                        <div className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> chargement…</div>
                      ) : (historyById[c.id] || []).length === 0 ? (
                        <div className="text-xs text-gray-400">Aucun message récupéré.</div>
                      ) : (
                        <div className="space-y-1.5 max-w-2xl">
                          {(historyById[c.id] || []).map((m, i) => (
                            <div key={i} className={`flex ${m.is_sender ? 'justify-end' : 'justify-start'}`}>
                              <div className={`text-[13px] rounded-2xl px-3 py-1.5 max-w-[80%] ${m.is_sender ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                                {m.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
                )
              })}
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
