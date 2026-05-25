'use client'

import { useState } from 'react'
import { Contact, ContactStatus, STATUS_COLORS, STATUS_LABELS, STATUS_OPTIONS, displayStatus } from '@/types'
import { formatDistanceToNow } from '@/lib/utils'
import { MessageDialog } from './MessageDialog'

interface Props {
  contacts: Contact[]
  onUpdate: (id: string, updates: Partial<Contact>) => void
}

const COLUMNS: { status: ContactStatus; label: string; emoji: string; tint: string }[] = [
  { status: 'to_contact', label: 'À traiter', emoji: '📥', tint: 'bg-blue-50 border-blue-200' },
  { status: 'in_progress', label: 'En cours', emoji: '💬', tint: 'bg-yellow-50 border-yellow-200' },
  { status: 'prospect', label: 'Chaud', emoji: '🔥', tint: 'bg-purple-50 border-purple-200' },
]

const ARCHIVE: { status: ContactStatus; label: string; emoji: string }[] = [
  { status: 'client', label: 'Client', emoji: '✅' },
  { status: 'treated', label: 'Traité', emoji: '✔' },
  { status: 'do_not_contact', label: 'Ne pas contacter', emoji: '🚫' },
]

function ScoreBadge({ score }: { score: number }) {
  if (!score) return null
  const color =
    score >= 8
      ? 'bg-green-100 text-green-700 border-green-200'
      : score >= 5
        ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
        : 'bg-red-100 text-red-600 border-red-200'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${color}`}>
      {score}/10
    </span>
  )
}

function ContactCard({
  contact,
  onClick,
  onChangeStatus,
}: {
  contact: Contact
  onClick: () => void
  onChangeStatus: (status: ContactStatus) => void
}) {
  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-2.5 hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-xs text-gray-900 truncate">
              {contact.name}
            </span>
            {!contact.is_sender_last && (
              <span className="text-[9px] text-blue-600">●</span>
            )}
          </div>
          {contact.job_title && (
            <p className="text-[10px] text-gray-500 truncate mt-0.5">{contact.job_title}</p>
          )}
        </div>
        <ScoreBadge score={contact.score} />
      </div>

      {contact.last_message && (
        <p className="text-[10px] text-gray-600 line-clamp-2 italic mt-1">
          {contact.is_sender_last ? '→ ' : '← '}
          {contact.last_message}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-gray-100">
        <span className="text-[9px] text-gray-400">
          {contact.last_message_at ? formatDistanceToNow(contact.last_message_at) : '—'}
        </span>
        <select
          value={displayStatus(contact.status)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChangeStatus(e.target.value as ContactStatus)}
          className={`text-[9px] rounded px-1 py-0.5 border-0 cursor-pointer ${STATUS_COLORS[contact.status]}`}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function ConversationPipeline({ contacts, onUpdate }: Props) {
  const [openContact, setOpenContact] = useState<Contact | null>(null)

  const byStatus: Record<ContactStatus, Contact[]> = {
    not_contacted: [],
    to_contact: [],
    in_progress: [],
    treated: [],
    do_not_contact: [],
    prospect: [],
    client: [],
  }
  for (const c of contacts) {
    // 'not_contacted' (legacy) est affiché dans la colonne 'À traiter'.
    const key = displayStatus(c.status)
    if (byStatus[key]) byStatus[key].push(c)
  }
  // Sort within each column by score desc, then most recent first
  for (const key of Object.keys(byStatus) as ContactStatus[]) {
    byStatus[key].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return tb - ta
    })
  }

  const updateStatus = async (id: string, status: ContactStatus) => {
    onUpdate(id, { status })
    await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {COLUMNS.map(({ status, label, emoji, tint }) => {
          const items = byStatus[status]
          return (
            <div
              key={status}
              className={`rounded-lg border ${tint} p-2.5 min-h-[200px]`}
            >
              <div className="flex items-center justify-between mb-2.5 px-1">
                <div className="flex items-center gap-1.5">
                  <span>{emoji}</span>
                  <span className="font-semibold text-xs text-gray-800">{label}</span>
                </div>
                <span className="text-[10px] font-mono text-gray-500 bg-white rounded-full px-1.5 py-0.5">
                  {items.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {items.length === 0 ? (
                  <p className="text-[10px] text-gray-400 italic text-center py-4">
                    Vide
                  </p>
                ) : (
                  items.slice(0, 50).map((c) => (
                    <ContactCard
                      key={c.id}
                      contact={c}
                      onClick={() => setOpenContact(c)}
                      onChangeStatus={(s) => updateStatus(c.id, s)}
                    />
                  ))
                )}
                {items.length > 50 && (
                  <p className="text-[10px] text-gray-400 text-center pt-1">
                    + {items.length - 50} autres (filtre pour voir)
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Archive section */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ARCHIVE.map(({ status, label, emoji }) => {
          const items = byStatus[status]
          if (items.length === 0) return null
          return (
            <details key={status} className="bg-gray-50 border border-gray-200 rounded-lg">
              <summary className="cursor-pointer px-3 py-2 text-xs text-gray-600 flex items-center justify-between">
                <span>
                  {emoji} {label}
                </span>
                <span className="text-[10px] font-mono text-gray-500 bg-white rounded-full px-1.5 py-0.5">
                  {items.length}
                </span>
              </summary>
              <div className="px-2.5 pb-2.5 space-y-1.5">
                {items.slice(0, 30).map((c) => (
                  <ContactCard
                    key={c.id}
                    contact={c}
                    onClick={() => setOpenContact(c)}
                    onChangeStatus={(s) => updateStatus(c.id, s)}
                  />
                ))}
              </div>
            </details>
          )
        })}
      </div>

      {openContact && (
        <MessageDialog
          contact={openContact}
          open={true}
          mode={openContact.is_sender_last ? 'followup' : 'new'}
          onClose={() => setOpenContact(null)}
          onSent={() => {
            // Optimistic: mark as last sent by me
            onUpdate(openContact.id, { is_sender_last: true })
            setOpenContact(null)
          }}
        />
      )}
    </>
  )
}
