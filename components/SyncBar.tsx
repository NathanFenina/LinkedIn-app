'use client'

import { useState } from 'react'
import { RefreshCw, ChevronDown } from 'lucide-react'

interface SyncBarProps {
  onSynced: () => void
}

type SyncType = 'conversations' | 'connections' | 'visitors'

const DEPTH_OPTIONS = [
  { value: 15, label: '15 msgs / conv (rapide)' },
  { value: 50, label: '50 msgs / conv' },
  { value: 150, label: '150 msgs / conv' },
  { value: 500, label: '500 msgs / conv (long)' },
]

const CHAT_LIMIT_OPTIONS = [
  { value: 200, label: '200 conversations' },
  { value: 500, label: '500 conversations' },
  { value: 1000, label: '1000 conversations' },
  { value: 3000, label: '3000 conversations (très long)' },
]

export function SyncBar({ onSynced }: SyncBarProps) {
  const [loading, setLoading] = useState<SyncType | 'all' | null>(null)
  const [result, setResult] = useState<string>('')
  const [messagesPerChat, setMessagesPerChat] = useState<number>(15)
  const [chatLimit, setChatLimit] = useState<number>(200)
  const [deepen, setDeepen] = useState<boolean>(false)
  const [open, setOpen] = useState(false)

  const sync = async (type: SyncType) => {
    setLoading(type)
    try {
      if (type === 'conversations') {
        let cursor: string | undefined = undefined
        let totalSynced = 0
        let batches = 0
        while (totalSynced < chatLimit) {
          const pageSize = Math.min(50, chatLimit - totalSynced)
          setResult(`conversations: batch ${batches + 1} · ${totalSynced}/${chatLimit}…`)
          const resp: Response = await fetch('/api/sync/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageSize, messagesPerChat, deepen, cursor }),
          })
          const data: { error?: string; synced?: number; done?: boolean; nextCursor?: string | null } = await resp.json()
          if (data.error) throw new Error(data.error)
          totalSynced += data.synced || 0
          batches++
          onSynced()
          if (data.done || !data.nextCursor) break
          cursor = data.nextCursor ?? undefined
        }
        setResult(`conversations: ${totalSynced} synchronisé(s) (${batches} lots)`)
      } else {
        const res = await fetch(`/api/sync/${type}`, { method: 'POST' })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        if (data.errors?.length) console.error(`Sync ${type} errors:`, data.errors)
        const errSuffix = data.errors?.length ? ` ⚠️ ${data.errors.length} err.` : ''
        setResult(`${type}: ${data.synced}/${data.total ?? '?'} synchronisé(s)${errSuffix}`)
      }
      onSynced()
    } catch (err) {
      setResult(`Erreur ${type}: ${String(err)}`)
    } finally {
      setLoading(null)
    }
  }

  const syncAll = async () => {
    setLoading('all')
    try {
      for (const type of ['conversations', 'connections', 'visitors'] as SyncType[]) {
        await sync(type)
      }
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap relative">
      <button
        onClick={syncAll}
        disabled={loading !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        Tout synchroniser
      </button>

      <button
        onClick={() => sync('conversations')}
        disabled={loading !== null}
        className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
      >
        {loading === 'conversations' ? '…' : 'Conversations'}
      </button>
      <button
        onClick={() => sync('connections')}
        disabled={loading !== null}
        className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
      >
        {loading === 'connections' ? '…' : 'Connexions'}
      </button>
      <button
        onClick={() => sync('visitors')}
        disabled={loading !== null}
        className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
      >
        {loading === 'visitors' ? '…' : 'Visiteurs'}
      </button>

      <button
        onClick={() => setOpen(!open)}
        className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1"
      >
        Options
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-20 w-72">
          <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1">
            Nombre de conversations
          </label>
          <select
            value={chatLimit}
            onChange={(e) => setChatLimit(Number(e.target.value))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs mb-3"
          >
            {CHAT_LIMIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1">
            Profondeur (messages/conv.)
          </label>
          <select
            value={messagesPerChat}
            onChange={(e) => setMessagesPerChat(Number(e.target.value))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs mb-2"
          >
            {DEPTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={deepen}
              onChange={(e) => setDeepen(e.target.checked)}
            />
            Remonter plus loin (cumule avec la sync précédente)
          </label>
        </div>
      )}

      {result && <span className="text-xs text-gray-500">{result}</span>}
    </div>
  )
}
