'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Contact, StoredMessage } from '@/types'
import { Download } from 'lucide-react'

interface Props {
  contact: Contact | null
  open: boolean
  onClose: () => void
}

export function MessageHistoryDialog({ contact, open, onClose }: Props) {
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')

  useEffect(() => {
    if (!open || !contact) return
    setLoading(true)
    setInfo('')
    fetch(`/api/contacts/${contact.id}/messages`)
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setMessages(data))
      .finally(() => setLoading(false))
  }, [open, contact])

  const loadHistory = async (max: number) => {
    if (!contact) return
    setBusy(true)
    setInfo(`Chargement de ${max} messages…`)
    try {
      const res = await fetch(`/api/contacts/${contact.id}/load-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max, batch: 100 }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setInfo(`${data.fetched} fetchés · ${data.newly_stored} nouveaux · ${data.total_in_db} en DB`)
      const refreshed = await fetch(`/api/contacts/${contact.id}/messages`).then((r) => r.json())
      if (Array.isArray(refreshed)) setMessages(refreshed)
    } catch (err) {
      setInfo(`Erreur: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Historique avec {contact?.name}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-gray-500">{messages.length} messages stockés</span>
          <button
            onClick={() => loadHistory(200)}
            disabled={busy}
            className="px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> Charger 200
          </button>
          <button
            onClick={() => loadHistory(1000)}
            disabled={busy}
            className="px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> Charger 1000
          </button>
          <button
            onClick={() => loadHistory(5000)}
            disabled={busy}
            className="px-2.5 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 inline-flex items-center gap-1"
            title="Charge tout l'historique (peut être long)"
          >
            <Download className="w-3 h-3" /> Tout charger
          </button>
          {info && <span className="text-gray-500 ml-auto">{info}</span>}
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 rounded p-3 space-y-2">
          {loading ? (
            <p className="text-center text-gray-400 text-xs py-12">Chargement…</p>
          ) : messages.length === 0 ? (
            <p className="text-center text-gray-400 text-xs py-12">
              Pas d&apos;historique stocké. Clique sur Charger pour récupérer depuis LinkedIn.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[80%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${
                  m.is_sender
                    ? 'ml-auto bg-blue-600 text-white'
                    : 'mr-auto bg-white border border-gray-200 text-gray-800'
                }`}
              >
                {m.text || <span className="italic opacity-60">[message vide]</span>}
                <div className={`text-[10px] mt-1 ${m.is_sender ? 'text-blue-100' : 'text-gray-400'}`}>
                  {m.sent_at ? new Date(m.sent_at).toLocaleString('fr-FR') : ''}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
