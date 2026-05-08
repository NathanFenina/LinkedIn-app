'use client'

import { useEffect, useState, useCallback } from 'react'
import { MessageTemplate } from '@/types'
import { Plus, Trash2, Save } from 'lucide-react'

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editing, setEditing] = useState<Record<string, { name: string; content: string }>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/templates')
      const data = await res.json()
      setTemplates(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const create = async () => {
    if (!newName.trim() || !newContent.trim()) return
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), content: newContent.trim() }),
    })
    if (res.ok) {
      setNewName('')
      setNewContent('')
      fetchData()
    }
  }

  const save = async (id: string) => {
    const e = editing[id]
    if (!e) return
    await fetch(`/api/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: e.name, content: e.content }),
    })
    setEditing((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    fetchData()
  }

  const remove = async (id: string) => {
    if (!confirm('Supprimer ce template ?')) return
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    fetchData()
  }

  const startEdit = (t: MessageTemplate) => {
    setEditing((prev) => ({ ...prev, [t.id]: { name: t.name, content: t.content } }))
  }

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3">
          <h1 className="font-semibold text-gray-900 text-base leading-tight">Templates de messages</h1>
          <p className="text-xs text-gray-500">Utilisés dans la fenêtre d&apos;envoi · variable disponible : <code className="bg-gray-100 px-1 rounded text-[10px]">{'{name}'}</code></p>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        {/* Create form */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
          <h2 className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouveau template
          </h2>
          <input
            type="text"
            placeholder="Nom (ex: Ice-breaker SaaS)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm"
          />
          <textarea
            placeholder="Contenu du message… utilise {name} pour le prénom"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={4}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm resize-none"
          />
          <button
            onClick={create}
            disabled={!newName.trim() || !newContent.trim()}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Créer
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Chargement…</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
            Aucun template. Crée-en un ci-dessus.
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => {
              const e = editing[t.id]
              return (
                <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                  {e ? (
                    <>
                      <input
                        value={e.name}
                        onChange={(ev) =>
                          setEditing((prev) => ({ ...prev, [t.id]: { ...e, name: ev.target.value } }))
                        }
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm font-medium"
                      />
                      <textarea
                        value={e.content}
                        onChange={(ev) =>
                          setEditing((prev) => ({ ...prev, [t.id]: { ...e, content: ev.target.value } }))
                        }
                        rows={4}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => save(t.id)}
                          className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded inline-flex items-center gap-1"
                        >
                          <Save className="w-3 h-3" /> Enregistrer
                        </button>
                        <button
                          onClick={() =>
                            setEditing((prev) => {
                              const next = { ...prev }
                              delete next[t.id]
                              return next
                            })
                          }
                          className="text-xs px-2.5 py-1 border border-gray-200 rounded"
                        >
                          Annuler
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between">
                        <h3 className="font-medium text-sm text-gray-900">{t.name}</h3>
                        <div className="flex gap-1">
                          <button
                            onClick={() => startEdit(t)}
                            className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                          >
                            Modifier
                          </button>
                          <button
                            onClick={() => remove(t.id)}
                            className="text-[11px] px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50 inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-600 whitespace-pre-wrap">{t.content}</p>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
