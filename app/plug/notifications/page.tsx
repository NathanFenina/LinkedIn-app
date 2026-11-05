'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// PLUG — Notifications : nouvelles missions, posts à commenter, invitations
// acceptées, réponses à traiter, bilans KPI de la semaine et du mois.

interface Note { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }

const ICON: Record<string, string> = { action: '👉', info: 'ℹ️', result: '📊', alert: '⚠️' }

export default function PlugNotificationsPage() {
  const [unread, setUnread] = useState<Note[]>([])
  const [read, setRead] = useState<Note[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/api/cockpit/notes').then((x) => x.json()).then((r) => {
      if (!alive) return
      setUnread(r.unread || [])
      setRead(r.read || [])
    })
    return () => { alive = false }
  }, [tick])
  async function mark(op: string, id?: string) {
    await fetch('/api/cockpit/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id }) })
    setTick((t) => t + 1)
    window.dispatchEvent(new Event('plug-notes'))
  }
  const card = (n: Note, isUnread: boolean) => (
    <div key={n.id} className={`border rounded-xl p-3 ${isUnread ? 'bg-white border-blue-200' : 'bg-gray-50 border-gray-100 opacity-70'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm text-gray-900">{ICON[n.kind] || '•'} {n.title}</div>
        <span className="text-[11px] text-gray-400 shrink-0">{new Date(n.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      {n.body && <pre className="mt-1 text-xs text-gray-600 whitespace-pre-wrap font-sans">{n.body}</pre>}
      <div className="mt-2 flex gap-2">
        {n.link && <Link href={n.link} onClick={() => isUnread && mark('read', n.id)} className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs">Ouvrir</Link>}
        {isUnread && <button onClick={() => mark('read', n.id)} className="px-2.5 py-1 rounded-lg border text-xs">Marquer comme lu</button>}
      </div>
    </div>
  )
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
        {!!unread.length && <button onClick={() => mark('read_all')} className="text-xs text-blue-600">Tout marquer comme lu</button>}
      </div>
      {!unread.length && <div className="p-6 text-center text-sm text-gray-400 border border-dashed rounded-xl mb-4">Rien de nouveau.</div>}
      <div className="space-y-2 mb-6">{unread.map((n) => card(n, true))}</div>
      {!!read.length && <div className="text-xs font-bold text-gray-400 uppercase mb-2">Déjà lues</div>}
      <div className="space-y-2">{read.map((n) => card(n, false))}</div>
    </div>
  )
}
