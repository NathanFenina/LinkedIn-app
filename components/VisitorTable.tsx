'use client'

import { useState, useMemo } from 'react'
import { ProfileVisitor } from '@/types'
import { formatDistanceToNow } from '@/lib/utils'
import { ExternalLink, Check, ArrowUpDown } from 'lucide-react'

interface Props {
  visitors: ProfileVisitor[]
  onUpdate: (id: string, updates: Partial<ProfileVisitor>) => void
}

type SortKey = 'name' | 'job_title' | 'visited_at'
type SortDir = 'asc' | 'desc'

export function VisitorTable({ visitors, onUpdate }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'visited_at', dir: 'desc' })

  const sorted = useMemo(() => {
    const arr = [...visitors]
    arr.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      const av = a[sort.key] ?? ''
      const bv = b[sort.key] ?? ''
      if (sort.key === 'visited_at') {
        return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * dir
      }
      return String(av).localeCompare(String(bv)) * dir
    })
    return arr
  }, [visitors, sort])

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const markContacted = async (id: string, contacted: boolean) => {
    setLoadingId(id)
    try {
      await fetch('/api/visitors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, contacted }),
      })
      onUpdate(id, { contacted })
    } finally {
      setLoadingId(null)
    }
  }

  const renderSortHeader = (k: SortKey, label: string, className = '') => (
    <th
      key={k}
      onClick={() => toggleSort(k)}
      className={`text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${sort.key === k ? 'text-blue-500' : 'text-gray-300'}`} />
      </span>
    </th>
  )

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {renderSortHeader('name', 'Nom', 'px-3 py-2 w-[220px]')}
              {renderSortHeader('job_title', 'Poste', 'px-3 py-2')}
              {renderSortHeader('visited_at', 'Visité', 'px-3 py-2 w-[140px]')}
              <th className="px-3 py-2 w-[160px] text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((v) => (
              <tr key={v.id} className={`hover:bg-gray-50/70 ${v.contacted ? 'opacity-60' : ''}`}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {v.avatar_url ? (
                      <img src={v.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {v.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate max-w-[170px]" title={v.name}>{v.name}</div>
                      {v.profile_url && (
                        <a
                          href={v.profile_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          LinkedIn <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-700 truncate max-w-[280px]" title={v.job_title || ''}>
                  {v.job_title || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-500">{formatDistanceToNow(v.visited_at)}</td>
                <td className="px-3 py-2">
                  {v.contacted ? (
                    <button
                      onClick={() => markContacted(v.id, false)}
                      disabled={loadingId === v.id}
                      className="text-[11px] px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 inline-flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Contacté
                    </button>
                  ) : (
                    <button
                      onClick={() => markContacted(v.id, true)}
                      disabled={loadingId === v.id}
                      className="text-[11px] px-2 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
                    >
                      {loadingId === v.id ? '…' : 'Marquer contacté'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
