'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { ProfileVisitor } from '@/types'
import { VisitorTable } from '@/components/VisitorTable'
import { PageHeader } from '@/components/PageHeader'
import { Search, Sparkles, Send } from 'lucide-react'

export default function VisitorsPage() {
  const [visitors, setVisitors] = useState<ProfileVisitor[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'not_contacted' | 'contacted' | 'top'>('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/visitors')
      setVisitors(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleUpdate = (id: string, updates: Partial<ProfileVisitor>) => {
    setVisitors((prev) => prev.map((v) => (v.id === id ? { ...v, ...updates } : v)))
  }

  const filtered = useMemo(() => {
    return visitors
      .filter((v) => {
        if (filter === 'contacted') return v.contacted
        if (filter === 'not_contacted') return !v.contacted
        if (filter === 'top') return v.score >= 7 && !v.invited_at
        return true
      })
      .filter(
        (v) =>
          !search ||
          v.name.toLowerCase().includes(search.toLowerCase()) ||
          v.job_title?.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => {
        if (filter === 'top') return b.score - a.score
        return 0
      })
  }, [visitors, filter, search])

  const toContact = visitors.filter((v) => !v.contacted).length
  const topUninvited = visitors.filter((v) => v.score >= 7 && !v.invited_at).length
  const unscoredCount = visitors.filter((v) => !v.score).length

  const scoreBatch = async () => {
    if (!confirm(`Scorer les ${unscoredCount} visiteurs non scorés via IA ?`)) return
    setBusy('score')
    setMsg('Scoring IA en cours…')
    try {
      const res = await fetch('/api/visitors/score-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyUnscored: true, limit: 100 }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMsg(`${data.scored} scorés · ${data.high_value} ≥ 7/10`)
      await fetchData()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const autoInvite = async (dryRun: boolean) => {
    if (!dryRun && !confirm(`Inviter jusqu'à 10 visiteurs scorés ≥ 7/10 avec un message IA personnalisé ?\n(Limite hard: 10 par 24h pour rester safe LinkedIn)`)) return
    setBusy(dryRun ? 'preview' : 'invite')
    setMsg(dryRun ? 'Aperçu…' : 'Envoi des invitations…')
    try {
      const res = await fetch('/api/visitors/auto-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (dryRun) {
        const preview = (data.preview as Array<{ name: string; score: number; message: string }>) || []
        const lines = preview.slice(0, 3).map((p) => `• ${p.name} (${p.score}/10): ${p.message?.slice(0, 80)}…`).join('\n')
        setMsg(`Aperçu de ${preview.length} candidats — voir console pour le détail`)
        console.log('Auto-invite preview:', preview)
        if (lines) alert(`Aperçu (${preview.length} candidats) :\n\n${lines}`)
      } else {
        setMsg(
          data.skipped_reason
            ? data.skipped_reason
            : `${data.sent} invitations envoyées · ${data.remaining_quota} restantes aujourd'hui`
        )
        await fetchData()
      }
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Visiteurs de profil"
        subtitle={`${visitors.length} visiteurs · ${toContact} à contacter`}
        onSynced={fetchData}
        helpSectionId="visitors"
      />

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-3">
        {/* Bulk actions */}
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
          <button
            onClick={scoreBatch}
            disabled={busy !== null || unscoredCount === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 font-medium"
          >
            <Sparkles className={`w-3.5 h-3.5 ${busy === 'score' ? 'animate-pulse' : ''}`} />
            Scorer non scorés ({unscoredCount})
          </button>

          <button
            onClick={() => autoInvite(true)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 font-medium"
          >
            <Send className={`w-3.5 h-3.5 ${busy === 'preview' ? 'animate-pulse' : ''}`} />
            Aperçu invitations
          </button>

          <button
            onClick={() => autoInvite(false)}
            disabled={busy !== null || topUninvited === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 font-medium"
            title="Envoie jusqu'à 10 invitations IA aux visiteurs scorés ≥ 7/10. Quota 10/24h hardcodé."
          >
            <Send className={`w-3.5 h-3.5 ${busy === 'invite' ? 'animate-pulse' : ''}`} />
            🎯 Inviter top visiteurs (max 10/j)
          </button>

          {msg && <span className="text-gray-500 ml-auto">{msg}</span>}
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
            {([
              { value: 'top', label: `🔥 Top à inviter (${topUninvited})` },
              { value: 'all', label: `Tous (${visitors.length})` },
              { value: 'not_contacted', label: `À contacter (${toContact})` },
              { value: 'contacted', label: `Contactés (${visitors.length - toContact})` },
            ] as const).map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  filter === f.value
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300'
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
            Aucun visiteur. Synchronise d&apos;abord.
          </div>
        ) : (
          <VisitorTable visitors={filtered} onUpdate={handleUpdate} />
        )}
      </div>
    </>
  )
}
