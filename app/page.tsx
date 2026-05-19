'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Contact, ContactStatus, STATUS_LABELS } from '@/types'
import { ConversationTable } from '@/components/ConversationTable'
import { ConversationPipeline } from '@/components/ConversationPipeline'
import { PageHeader } from '@/components/PageHeader'
import { Search, Sparkles, Download, RefreshCw } from 'lucide-react'

const STATUS_FILTERS: { value: ContactStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'to_contact', label: STATUS_LABELS.to_contact },
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'prospect', label: STATUS_LABELS.prospect },
  { value: 'client', label: STATUS_LABELS.client },
  { value: 'treated', label: STATUS_LABELS.treated },
  { value: 'do_not_contact', label: STATUS_LABELS.do_not_contact },
]

export default function ConversationsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<ContactStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'all' | 'waiting' | 'followup' | 'priority' | 'pipeline'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/contacts?tab=conversations')
      setContacts(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleUpdate = (id: string, updates: Partial<Contact>) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)))
  }

  const PRIORITY_MIN_SCORE = 6
  const PRIORITY_FRESHNESS_DAYS = 14
  const STALE_STATUSES = new Set<ContactStatus>(['treated', 'do_not_contact', 'client'])

  const isPriority = (c: Contact): boolean => {
    if (c.score < PRIORITY_MIN_SCORE) return false
    if (STALE_STATUSES.has(c.status)) return false
    if (!c.last_message_at) return false
    const ageMs = Date.now() - new Date(c.last_message_at).getTime()
    return ageMs <= PRIORITY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000
  }

  const filtered = useMemo(() => {
    return contacts
      .filter((c) => filter === 'all' || c.status === filter)
      .filter(
        (c) =>
          !search ||
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.job_title?.toLowerCase().includes(search.toLowerCase())
      )
      .filter((c) => {
        if (view === 'waiting') return !c.is_sender_last
        if (view === 'followup') return c.is_sender_last
        if (view === 'priority') return isPriority(c)
        // pipeline view shows ALL (grouped client-side by status)
        return true
      })
      .sort((a, b) => {
        if (view === 'priority') {
          // Top score first, then freshest
          if (b.score !== a.score) return b.score - a.score
          const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
          const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
          return tb - ta
        }
        return 0
      })
  }, [contacts, filter, search, view])

  const waitingCount = contacts.filter((c) => !c.is_sender_last).length
  const followupCount = contacts.filter((c) => c.is_sender_last).length
  const unscoredCount = contacts.filter((c) => !c.score).length
  const priorityCount = contacts.filter(isPriority).length

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (ids: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id))
      const next = new Set(prev)
      if (allSelected) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const scoreBatch = async () => {
    const ids = Array.from(selectedIds)
    const hasSelection = ids.length > 0
    const label = hasSelection
      ? `Scorer les ${ids.length} conversations sélectionnées ?`
      : `Scorer les ${unscoredCount} conversations non scorées ? (peut prendre plusieurs minutes)`
    if (!confirm(label)) return

    setBusy('score')
    setActionMsg('Scoring IA en cours…')
    try {
      const res = await fetch('/api/contacts/score-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hasSelection ? { ids } : { onlyUnscored: true }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setActionMsg(`${data.scored}/${data.total} scorés · ${data.failed} échecs`)
      await fetchData()
    } catch (err) {
      setActionMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const quickSync = async () => {
    setBusy('quick')
    setActionMsg('Sync rapide : 50 derniers chats…')
    try {
      const resp = await fetch('/api/sync/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageSize: 50, messagesPerChat: 15 }),
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setActionMsg(`${data.synced} chats sync · scoring auto en cours…`)
      await fetchData()
      // Auto-score the unscored ones we just synced.
      const scoreRes = await fetch('/api/contacts/score-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyUnscored: true }),
      })
      const scoreData = await scoreRes.json()
      setActionMsg(
        `Sync rapide OK · ${data.synced} chats · ${scoreData.scored || 0} scorés`
      )
      await fetchData()
    } catch (err) {
      setActionMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const loadMoreChats = async () => {
    const want = 500
    if (!confirm(`Charger ${want} conversations de plus ? (peut prendre plusieurs minutes, reste sur la page)`)) return

    setBusy('load')
    let cursor: string | undefined = undefined
    let totalSynced = 0
    let batches = 0

    try {
      while (totalSynced < want) {
        const pageSize = Math.min(50, want - totalSynced)
        setActionMsg(`Batch ${batches + 1} · ${totalSynced}/${want} synchronisés…`)
        const resp: Response = await fetch('/api/sync/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageSize, messagesPerChat: 15, cursor }),
        })
        const data: { error?: string; synced?: number; total?: number; done?: boolean; nextCursor?: string | null; errors?: string[] } = await resp.json()
        if (data.errors && data.errors.length > 0) {
          console.error('Sync batch errors:', data.errors)
        }
        if (data.error) throw new Error(data.error)
        totalSynced += data.synced || 0
        batches++
        await fetchData()
        // stuck detection: 3 batches sans rien de nouveau + erreurs = abort
        if ((data.synced || 0) === 0 && (data.errors?.length || 0) > 0) {
          throw new Error(`Lot ${batches} bloqué: ${data.errors![0]}`)
        }
        if (data.done || !data.nextCursor) break
        cursor = data.nextCursor ?? undefined
      }
      setActionMsg(`Terminé · ${totalSynced} conversations synchronisées (${batches} lots)`)
      await fetchData()
    } catch (err) {
      setActionMsg(`Erreur après ${totalSynced} synchronisés: ${String(err)}`)
      await fetchData()
    } finally {
      setBusy(null)
    }
  }

  const refreshSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    setBusy('refresh')
    setActionMsg(`Rafraîchissement de ${ids.length} conversations…`)
    try {
      const res = await fetch('/api/sync/conversations/selective', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: ids }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setActionMsg(`${data.synced}/${data.total} rafraîchis`)
      await fetchData()
    } catch (err) {
      setActionMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Conversations"
        subtitle={`${contacts.length} au total · ${waitingCount} en attente de ta réponse · ${followupCount} à relancer · ${unscoredCount} non scorées`}
        onSynced={fetchData}
        helpSectionId="conversations"
      />

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-3">
        {/* Bulk toolbar */}
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
          <button
            onClick={scoreBatch}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 font-medium"
            title={selectedIds.size > 0 ? `Scorer les ${selectedIds.size} sélectionnées` : `Scorer les ${unscoredCount} non scorées`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${busy === 'score' ? 'animate-pulse' : ''}`} />
            {selectedIds.size > 0 ? `Scorer sélection (${selectedIds.size})` : `Scorer non scorées (${unscoredCount})`}
          </button>

          <button
            onClick={quickSync}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 font-medium"
            title="Sync les 50 derniers chats et scorer auto les nouveaux"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy === 'quick' ? 'animate-spin' : ''}`} />
            Sync rapide (derniers chats)
          </button>

          <button
            onClick={loadMoreChats}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            <Download className={`w-3.5 h-3.5 ${busy === 'load' ? 'animate-pulse' : ''}`} />
            Charger +500 conversations
          </button>

          <button
            onClick={refreshSelected}
            disabled={busy !== null || selectedIds.size === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-40 font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
            Rafraîchir sélection ({selectedIds.size})
          </button>

          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="text-gray-500 hover:text-gray-800 underline"
            >
              Désélectionner
            </button>
          )}

          {actionMsg && <span className="text-gray-500 ml-auto">{actionMsg}</span>}
        </div>

        {/* View toggles */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setView('pipeline')}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
              view === 'pipeline' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-700 border-indigo-300'
            }`}
            title="Vue Kanban groupée par statut (À contacter / En cours / Prospect / Client)"
          >
            📊 Pipeline
          </button>
          <button
            onClick={() => setView('priority')}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
              view === 'priority' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-300'
            }`}
            title="Score ≥ 6 · message des 14 derniers jours · pas encore traité"
          >
            📥 Boîte priorisée ({priorityCount})
          </button>
          <button
            onClick={() => setView('all')}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              view === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            Tous ({contacts.length})
          </button>
          <button
            onClick={() => setView('waiting')}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              view === 'waiting' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            🔵 À répondre ({waitingCount})
          </button>
          <button
            onClick={() => setView('followup')}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              view === 'followup' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            🔄 À relancer ({followupCount})
          </button>
        </div>

        {/* Search + status filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  filter === f.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table OR Pipeline */}
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
            Aucune conversation. Synchronise d&apos;abord.
          </div>
        ) : view === 'pipeline' ? (
          <ConversationPipeline contacts={filtered} onUpdate={handleUpdate} />
        ) : (
          <ConversationTable
            contacts={filtered}
            onUpdate={handleUpdate}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
          />
        )}
      </div>
    </>
  )
}
