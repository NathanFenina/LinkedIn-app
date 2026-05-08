'use client'

import { useState, useMemo } from 'react'
import { Contact, ContactStatus, STATUS_LABELS, STATUS_COLORS } from '@/types'
import { MessageDialog } from './MessageDialog'
import { MessageHistoryDialog } from './MessageHistoryDialog'
import { formatDistanceToNow } from '@/lib/utils'
import { ExternalLink, Sparkles, Send, RotateCcw, ArrowUpDown, History } from 'lucide-react'

interface Props {
  contacts: Contact[]
  onUpdate: (id: string, updates: Partial<Contact>) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: (ids: string[]) => void
}

type SortKey = 'name' | 'job_title' | 'score' | 'status' | 'last_message_at'
type SortDir = 'asc' | 'desc'

const ALL_STATUSES: ContactStatus[] = [
  'not_contacted',
  'to_contact',
  'in_progress',
  'treated',
  'do_not_contact',
  'prospect',
  'client',
]

function ScoreChip({ score }: { score: number }) {
  if (!score) return <span className="text-gray-300 text-xs">—</span>
  const color =
    score >= 8
      ? 'bg-green-100 text-green-700 border-green-200'
      : score >= 5
        ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
        : 'bg-red-100 text-red-600 border-red-200'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold ${color}`}>
      {score}/10
    </span>
  )
}

export function ConversationTable({ contacts, onUpdate, selectedIds, onToggleSelect, onToggleSelectAll }: Props) {
  const [msgContact, setMsgContact] = useState<Contact | null>(null)
  const [msgMode, setMsgMode] = useState<'new' | 'followup'>('new')
  const [historyContact, setHistoryContact] = useState<Contact | null>(null)
  const [scoringId, setScoringId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'last_message_at',
    dir: 'desc',
  })

  const sorted = useMemo(() => {
    const arr = [...contacts]
    arr.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      const av = a[sort.key] ?? ''
      const bv = b[sort.key] ?? ''
      if (sort.key === 'score') return (Number(av) - Number(bv)) * dir
      if (sort.key === 'last_message_at') {
        return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * dir
      }
      return String(av).localeCompare(String(bv)) * dir
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

  const handleScore = async (contact: Contact) => {
    setScoringId(contact.id)
    try {
      const res = await fetch(`/api/contacts/${contact.id}/score`, { method: 'POST' })
      const data = await res.json()
      if (data.score !== undefined) {
        onUpdate(contact.id, {
          score: data.score,
          score_reason: data.score_reason,
          conversation_summary: data.conversation_summary,
          suggested_status: data.suggested_status,
        })
      }
    } finally {
      setScoringId(null)
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
    <>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-2 py-2 w-[30px]">
                  <input
                    type="checkbox"
                    checked={contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id))}
                    onChange={() => onToggleSelectAll(contacts.map((c) => c.id))}
                    className="cursor-pointer"
                    aria-label="Tout sélectionner"
                  />
                </th>
                {renderSortHeader('name', 'Nom', 'px-3 py-2 w-[180px]')}
                {renderSortHeader('job_title', 'Poste', 'px-3 py-2 w-[180px]')}
                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">Résumé IA</th>
                {renderSortHeader('score', 'Score', 'px-3 py-2 w-[70px]')}
                {renderSortHeader('status', 'Statut', 'px-3 py-2 w-[150px]')}
                {renderSortHeader('last_message_at', 'Dernière conv.', 'px-3 py-2 w-[110px]')}
                <th className="px-3 py-2 w-[200px] text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((c) => {
                const waitingReply = !c.is_sender_last
                return (
                  <tr key={c.id} className={`hover:bg-gray-50/70 ${selectedIds.has(c.id) ? 'bg-blue-50/60' : ''}`}>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => onToggleSelect(c.id)}
                        className="cursor-pointer"
                        aria-label={`Sélectionner ${c.name}`}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-2 min-w-0">
                        {c.avatar_url ? (
                          <img src={c.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                            {c.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-gray-900 truncate max-w-[120px]" title={c.name}>
                              {c.name}
                            </span>
                            {waitingReply && (
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Attend ta réponse" />
                            )}
                          </div>
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
                    <td className="px-3 py-2 align-top text-gray-700 truncate max-w-[180px]" title={c.job_title || ''}>
                      {c.job_title || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-gray-600">
                      {c.conversation_summary ? (
                        <span className="line-clamp-2" title={c.conversation_summary}>
                          {c.conversation_summary}
                        </span>
                      ) : c.last_message ? (
                        <span className="text-gray-400 line-clamp-2 italic">
                          {c.is_sender_last ? '→ ' : '← '}{c.last_message}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top" title={c.score_reason || ''}>
                      <ScoreChip score={c.score} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <select
                        value={c.status}
                        onChange={(e) => handleStatus(c.id, e.target.value as ContactStatus)}
                        className={`text-[11px] rounded-full px-2 py-0.5 border-0 focus:ring-1 focus:ring-blue-400 cursor-pointer ${STATUS_COLORS[c.status]}`}
                      >
                        {ALL_STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                      {c.suggested_status && c.suggested_status !== c.status && (
                        <button
                          onClick={() => handleStatus(c.id, c.suggested_status as ContactStatus)}
                          className="block mt-1 text-[10px] text-violet-600 hover:underline"
                          title="Appliquer la suggestion IA"
                        >
                          ✨ IA: {STATUS_LABELS[c.suggested_status as ContactStatus]}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-gray-500">
                      {c.last_message_at ? formatDistanceToNow(c.last_message_at) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setMsgContact(c)
                            setMsgMode(waitingReply ? 'new' : 'followup')
                          }}
                          className={`text-[11px] px-2 py-1 rounded inline-flex items-center gap-1 text-white ${
                            waitingReply ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-500 hover:bg-orange-600'
                          }`}
                          title={waitingReply ? 'Répondre' : 'Relancer'}
                        >
                          {waitingReply ? <Send className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
                          {waitingReply ? 'Répondre' : 'Relancer'}
                        </button>
                        <button
                          onClick={() => handleScore(c)}
                          disabled={scoringId === c.id}
                          className="text-[11px] px-2 py-1 rounded bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 inline-flex items-center gap-1"
                          title="Scorer avec IA"
                        >
                          <Sparkles className="w-3 h-3" />
                          {scoringId === c.id ? '…' : 'IA'}
                        </button>
                        <button
                          onClick={() => setHistoryContact(c)}
                          className="text-[11px] px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 inline-flex items-center gap-1"
                          title="Historique complet"
                        >
                          <History className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <MessageDialog
        contact={msgContact}
        open={!!msgContact}
        mode={msgMode}
        onClose={() => setMsgContact(null)}
        onSent={() => {
          if (msgContact) {
            onUpdate(msgContact.id, {
              last_message: 'Message envoyé',
              last_message_at: new Date().toISOString(),
              is_sender_last: true,
            })
          }
          setMsgContact(null)
        }}
      />

      <MessageHistoryDialog
        contact={historyContact}
        open={!!historyContact}
        onClose={() => setHistoryContact(null)}
      />
    </>
  )
}
