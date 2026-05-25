'use client'

import { useState, useMemo } from 'react'
import { Contact, ContactStatus, STATUS_LABELS, STATUS_COLORS, STATUS_OPTIONS, displayStatus } from '@/types'
import { MessageDialog } from './MessageDialog'
import { ExternalLink, Send, ArrowUpDown } from 'lucide-react'

interface Props {
  contacts: Contact[]
  onUpdate: (id: string, updates: Partial<Contact>) => void
}

type SortKey = 'name' | 'job_title' | 'status' | 'score'
type SortDir = 'asc' | 'desc'

export function ConnectionTable({ contacts, onUpdate }: Props) {
  const [msgContact, setMsgContact] = useState<Contact | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' })

  const sorted = useMemo(() => {
    const arr = [...contacts]
    arr.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      if (sort.key === 'score') return (Number(a.score) - Number(b.score)) * dir
      return String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? '')) * dir
    })
    return arr
  }, [contacts, sort])

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const handleStatus = async (id: string, status: ContactStatus) => {
    onUpdate(id, { status })
    await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
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
    <>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {renderSortHeader('name', 'Nom', 'px-3 py-2 w-[220px]')}
                {renderSortHeader('job_title', 'Poste', 'px-3 py-2')}
                {renderSortHeader('score', 'Score', 'px-3 py-2 w-[80px]')}
                {renderSortHeader('status', 'Statut', 'px-3 py-2 w-[150px]')}
                <th className="px-3 py-2 w-[170px] text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/70">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.avatar_url ? (
                        <img src={c.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gray-400 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {c.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate max-w-[170px]" title={c.name}>{c.name}</div>
                        {c.profile_url && (
                          <a
                            href={c.profile_url}
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
                  <td className="px-3 py-2 text-gray-700 truncate max-w-[280px]" title={c.job_title || ''}>
                    {c.job_title || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2" title={c.score_reason || ''}>
                    {c.score ? (
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold ${
                          c.score >= 8
                            ? 'bg-green-100 text-green-700 border-green-200'
                            : c.score >= 5
                              ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                              : 'bg-red-100 text-red-600 border-red-200'
                        }`}
                      >
                        {c.score}/10
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={displayStatus(c.status)}
                      onChange={(e) => handleStatus(c.id, e.target.value as ContactStatus)}
                      className={`text-[11px] rounded-full px-2 py-0.5 border-0 focus:ring-1 focus:ring-blue-400 cursor-pointer ${STATUS_COLORS[c.status]}`}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setMsgContact(c)}
                      className="text-[11px] px-2 py-1 rounded inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Send className="w-3 h-3" />
                      Envoyer message
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <MessageDialog
        contact={msgContact}
        open={!!msgContact}
        mode="new"
        onClose={() => setMsgContact(null)}
        onSent={() => {
          if (msgContact) {
            onUpdate(msgContact.id, {
              last_message: 'Message envoyé',
              last_message_at: new Date().toISOString(),
              is_sender_last: true,
              status: 'in_progress',
            })
          }
          setMsgContact(null)
        }}
      />
    </>
  )
}
