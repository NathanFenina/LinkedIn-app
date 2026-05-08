'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Contact, MessageTemplate } from '@/types'
import { Sparkles, Send } from 'lucide-react'

interface MessageDialogProps {
  contact: Contact | null
  open: boolean
  mode?: 'new' | 'followup'
  onClose: () => void
  onSent: () => void
}

const GOAL_PRESETS: Record<'new' | 'followup', { label: string; value: string }[]> = {
  new: [
    { label: 'Ice-breaker', value: 'Ouvrir la conversation, créer du lien, sans pitch commercial.' },
    { label: 'Proposer un échange', value: 'Proposer un échange de 15 min pour explorer un besoin potentiel.' },
    { label: 'Question ciblée', value: 'Poser une question précise liée à son poste pour amorcer un échange.' },
  ],
  followup: [
    { label: 'Relance douce', value: 'Relancer gentiment sans forcer, rappeler le dernier échange.' },
    { label: 'Apporter de la valeur', value: 'Apporter un insight/valeur avant de relancer vers un RDV.' },
    { label: 'Push RDV', value: 'Proposer clairement un créneau pour un appel.' },
  ],
}

export function MessageDialog({
  contact,
  open,
  mode = 'new',
  onClose,
  onSent,
}: MessageDialogProps) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [templateId, setTemplateId] = useState<string>('')
  const [goal, setGoal] = useState(GOAL_PRESETS[mode][0].value)

  useEffect(() => {
    if (!open) return
    setText('')
    setError('')
    setTemplateId('')
    setGoal(GOAL_PRESETS[mode][0].value)
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setTemplates(data))
      .catch(() => {})
  }, [open, mode])

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    const tpl = templates.find((t) => t.id === id)
    if (tpl) setText(tpl.content.replace(/\{name\}/gi, contact?.name.split(' ')[0] || ''))
  }

  const handleGenerate = async () => {
    if (!contact) return
    setGenerating(true)
    setError('')
    try {
      const res = await fetch(`/api/contacts/${contact.id}/generate-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, template_id: templateId || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setText(data.text)
    } catch (err) {
      setError(String(err))
    } finally {
      setGenerating(false)
    }
  }

  const handleSend = async () => {
    if (!contact || !text.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          chat_id: contact.chat_id,
          linkedin_id: contact.linkedin_id,
          text: text.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setText('')
      onSent()
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === 'followup' ? 'Relancer' : 'Envoyer un message à'} {contact?.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-gray-500 uppercase tracking-wide">Template</label>
              <select
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
              >
                <option value="">— Aucun —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 uppercase tracking-wide">Intention IA</label>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
              >
                {GOAL_PRESETS[mode].map((g) => (
                  <option key={g.label} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full text-xs px-3 py-2 rounded bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 font-medium"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {generating ? 'Génération…' : 'Générer avec IA'}
          </button>

          <textarea
            className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={6}
            placeholder="Votre message… (ou génère-le avec l'IA ci-dessus)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleSend} disabled={loading || !text.trim()}>
            <Send className="w-3.5 h-3.5 mr-1" />
            {loading ? 'Envoi…' : 'Envoyer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
