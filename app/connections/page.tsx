'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Contact, ContactStatus, STATUS_LABELS } from '@/types'
import { ConnectionTable } from '@/components/ConnectionTable'
import { PageHeader } from '@/components/PageHeader'
import { Search, Download, Sparkles } from 'lucide-react'

const STATUS_FILTERS: { value: ContactStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'not_contacted', label: STATUS_LABELS.not_contacted },
  { value: 'to_contact', label: STATUS_LABELS.to_contact },
  { value: 'do_not_contact', label: STATUS_LABELS.do_not_contact },
]

export default function ConnectionsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<ContactStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [view, setView] = useState<'all' | 'top'>('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/contacts?tab=connections')
      const data = await res.json()
      setContacts(Array.isArray(data) ? data : [])
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

  const filtered = useMemo(() => {
    return contacts
      .filter((c) => filter === 'all' || c.status === filter)
      .filter(
        (c) =>
          !search ||
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.job_title?.toLowerCase().includes(search.toLowerCase())
      )
      .filter((c) => (view === 'top' ? c.score >= 7 : true))
      .sort((a, b) => b.score - a.score)
  }, [contacts, filter, search, view])

  const unscoredCount = contacts.filter((c) => !c.score).length
  const topCount = contacts.filter((c) => c.score >= 7).length

  const syncFromLinkedIn = async () => {
    setBusy('sync')
    let cursor: string | undefined = undefined
    let totalSynced = 0
    let totalSkipped = 0
    let batches = 0
    try {
      while (true) {
        setMsg(`Batch ${batches + 1} · ${totalSynced} ajoutés / ${totalSkipped} déjà connus`)
        const resp: Response = await fetch('/api/sync/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageSize: 100, cursor }),
        })
        const data: { synced?: number; skipped?: number; nextCursor?: string | null; done?: boolean; errors?: string[]; error?: string } = await resp.json()
        if (data.error) throw new Error(data.error)
        if (data.errors?.length) console.error('Connection sync errors:', data.errors)
        totalSynced += data.synced || 0
        totalSkipped += data.skipped || 0
        batches++
        await fetchData()
        if (data.done || !data.nextCursor) break
        cursor = data.nextCursor ?? undefined
        if (batches >= 30) break // safety
      }
      setMsg(`Sync terminée · ${totalSynced} nouvelles · ${totalSkipped} déjà en DB (${batches} lots)`)
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const scoreAll = async () => {
    if (unscoredCount === 0) {
      alert('Aucune connexion non scorée.')
      return
    }
    if (!confirm(`Scorer ${Math.min(unscoredCount, 100)} connexions par IA (basé sur leur intitulé de poste) ?`)) return
    setBusy('score')
    setMsg('Scoring IA en cours…')
    try {
      const res = await fetch('/api/contacts/score-profile-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100, onlyUnscored: true }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMsg(`${data.scored} scorés · ${data.high_value} ≥ 7/10 (à contacter en priorité)`)
      await fetchData()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Connexions"
        subtitle={`${contacts.length} jamais contactées · ${topCount} ≥ 7/10 · ${unscoredCount} non scorées`}
        onSynced={fetchData}
        helpSectionId="connections"
      />

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-3">
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
          <button
            onClick={syncFromLinkedIn}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            <Download className={`w-3.5 h-3.5 ${busy === 'sync' ? 'animate-pulse' : ''}`} />
            Charger depuis LinkedIn (toutes les connexions)
          </button>
          <button
            onClick={scoreAll}
            disabled={busy !== null || unscoredCount === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 font-medium"
          >
            <Sparkles className={`w-3.5 h-3.5 ${busy === 'score' ? 'animate-pulse' : ''}`} />
            Scorer profil IA ({unscoredCount})
          </button>
          {msg && <span className="text-gray-500 ml-auto">{msg}</span>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setView('all')}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              view === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            Tous ({contacts.length})
          </button>
          <button
            onClick={() => setView('top')}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              view === 'top' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            🔥 Top score ({topCount})
          </button>
        </div>

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

        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
            {contacts.length === 0
              ? "Aucune connexion. Clique « Charger depuis LinkedIn » pour les récupérer."
              : "Aucun résultat avec ces filtres."}
          </div>
        ) : (
          <ConnectionTable contacts={filtered} onUpdate={handleUpdate} />
        )}
      </div>
    </>
  )
}
