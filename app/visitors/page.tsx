'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { ProfileVisitor } from '@/types'
import { VisitorTable } from '@/components/VisitorTable'
import { PageHeader } from '@/components/PageHeader'
import { Search } from 'lucide-react'

export default function VisitorsPage() {
  const [visitors, setVisitors] = useState<ProfileVisitor[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'not_contacted' | 'contacted'>('all')
  const [search, setSearch] = useState('')

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
        return true
      })
      .filter(
        (v) =>
          !search ||
          v.name.toLowerCase().includes(search.toLowerCase()) ||
          v.job_title?.toLowerCase().includes(search.toLowerCase())
      )
  }, [visitors, filter, search])

  const toContact = visitors.filter((v) => !v.contacted).length

  return (
    <>
      <PageHeader
        title="Visiteurs de profil"
        subtitle={`${visitors.length} visiteurs · ${toContact} à contacter`}
        onSynced={fetchData}
        helpSectionId="visitors"
      />

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-3">
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
          <div className="flex gap-1">
            {([
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
