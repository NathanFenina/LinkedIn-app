'use client'

import { useEffect, useState, useCallback } from 'react'
import { LeadMagnetCampaign } from '@/types'
import { Plus, Play, Trash2, Eye, Square, ExternalLink } from 'lucide-react'
import { HelpButton } from '@/components/HelpButton'
import { formatDistanceToNow } from '@/lib/utils'

interface SendRow {
  id: string
  commenter_name: string | null
  commenter_profile_url: string | null
  comment_text: string | null
  message_sent: string | null
  sent_at: string
}

export default function LeadMagnetsPage() {
  const [campaigns, setCampaigns] = useState<LeadMagnetCampaign[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [previewByCampaign, setPreviewByCampaign] = useState<Record<string, { name: string | null; comment: string | null }[]>>({})
  const [sendsByCampaign, setSendsByCampaign] = useState<Record<string, SendRow[]>>({})

  // create form
  const [name, setName] = useState('')
  const [postUrl, setPostUrl] = useState('')
  const [trigger, setTrigger] = useState('')
  const [template, setTemplate] = useState('')
  const [magnetUrl, setMagnetUrl] = useState('')
  const [minComments, setMinComments] = useState('')
  const [autoRun, setAutoRun] = useState(false)

  const fetchCampaigns = useCallback(async () => {
    const data = await fetch('/api/lead-magnets').then((r) => r.json())
    if (Array.isArray(data)) setCampaigns(data)
  }, [])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  const create = async () => {
    if (!name.trim() || !postUrl.trim() || !template.trim()) return
    const res = await fetch('/api/lead-magnets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        post_url: postUrl.trim(),
        trigger_keyword: trigger.trim() || null,
        message_template: template.trim(),
        magnet_url: magnetUrl.trim() || null,
        min_comments: Number(minComments) || 0,
        auto_run: autoRun,
      }),
    })
    if (res.ok) {
      setName('')
      setPostUrl('')
      setTrigger('')
      setTemplate('')
      setMagnetUrl('')
      setMinComments('')
      setAutoRun(false)
      fetchCampaigns()
    } else {
      const data = await res.json()
      setMsg(`Erreur: ${data.error}`)
    }
  }

  const update = async (id: string, body: Partial<LeadMagnetCampaign>) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...body } : c)))
    await fetch(`/api/lead-magnets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const remove = async (id: string) => {
    if (!confirm('Supprimer cette campagne ?')) return
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
    await fetch(`/api/lead-magnets/${id}`, { method: 'DELETE' })
  }

  const run = async (id: string, dryRun: boolean) => {
    setBusyId(id)
    setMsg(dryRun ? 'Simulation en cours…' : 'Envoi en cours…')
    try {
      const res = await fetch(`/api/lead-magnets/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (dryRun) {
        setPreviewByCampaign((prev) => ({ ...prev, [id]: data.preview || [] }))
        setMsg(`Aperçu : ${data.matches} commentateurs cibles sur ${data.comments_scanned} commentaires`)
      } else {
        setMsg(`${data.messages_sent} DM envoyés sur ${data.matches} cibles (${data.comments_scanned} commentaires scannés)`)
      }
      fetchCampaigns()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusyId(null)
    }
  }

  // Lance la session d'envoi ESPACÉE (2-3 min entre chaque DM) via GitHub
  // Actions. Réactive la campagne au passage.
  const publish = async (id: string) => {
    setBusyId(id)
    setMsg('Lancement de la session d’envoi espacée…')
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, active: true } : c)))
    try {
      const res = await fetch(`/api/lead-magnets/${id}/publish`, { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMsg(data.message || 'Session lancée.')
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusyId(null)
    }
  }

  // Coupe l'envoi : met la campagne en pause. La boucle GitHub Actions s'arrête
  // au tour suivant (dans les 2-3 min).
  const stop = async (id: string) => {
    await update(id, { active: false })
    setMsg('Envoi coupé. La session s’arrête d’ici 2-3 min (fin du délai en cours).')
  }

  const loadSends = async (id: string) => {
    if (sendsByCampaign[id]) {
      setSendsByCampaign((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }
    const data = await fetch(`/api/lead-magnets/${id}/sends`).then((r) => r.json())
    if (Array.isArray(data)) setSendsByCampaign((prev) => ({ ...prev, [id]: data }))
  }

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Lead magnets sur commentaires</h1>
            <p className="text-xs text-gray-500">
              Envoie automatiquement un DM aux commentateurs d&apos;un de tes posts qui matchent un mot-clé.
            </p>
          </div>
          <HelpButton sectionId="lead-magnets" />
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        {/* Create form */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <h2 className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouvelle campagne
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Nom (ex: Audit SEO offert)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
            <input
              type="text"
              placeholder="URL du post LinkedIn cible"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
            <input
              type="text"
              placeholder="Mot-clé déclencheur (optionnel, ex: 'oui')"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
            <input
              type="text"
              placeholder="URL du lead magnet (optionnel, dispo via {magnet_url})"
              value={magnetUrl}
              onChange={(e) => setMagnetUrl(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <textarea
            rows={4}
            placeholder="Template du DM. Variables: {prenom} (nettoyé par IA), {name}, {magnet_url}"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-2 text-sm resize-none"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-gray-700 flex items-center gap-1.5">
              Seuil min commentaires :
              <input
                type="number"
                min={0}
                value={minComments}
                onChange={(e) => setMinComments(e.target.value)}
                className="w-20 border border-gray-200 rounded px-2 py-1 text-xs"
                placeholder="0"
                title="La campagne ne se déclenche que si le post a au moins N commentaires."
              />
            </label>
            <label className="text-xs text-gray-700 flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => setAutoRun(e.target.checked)}
              />
              Auto-run (le cron envoie aux nouveaux commentateurs)
            </label>
            <button
              onClick={create}
              disabled={!name.trim() || !postUrl.trim() || !template.trim()}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 ml-auto"
            >
              Créer
            </button>
          </div>
          {msg && <span className="text-xs text-gray-500 ml-2">{msg}</span>}
        </div>

        {/* Campaign list */}
        <div className="space-y-2">
          {campaigns.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
              Aucune campagne. Crée-en une ci-dessus.
            </div>
          ) : (
            campaigns.map((c) => {
              const preview = previewByCampaign[c.id]
              const sends = sendsByCampaign[c.id]
              return (
                <div
                  key={c.id}
                  className={`bg-white border rounded-lg p-3 ${c.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900">{c.name}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {c.active ? 'Active' : 'Pausée'}
                        </span>
                        <a
                          href={c.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          Post <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        {c.trigger_keyword && (
                          <span className="text-[10px] text-gray-500 italic">trigger: &quot;{c.trigger_keyword}&quot;</span>
                        )}
                        {c.last_run_at && (
                          <span className="text-[10px] text-gray-400">dernier run {formatDistanceToNow(c.last_run_at)}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap line-clamp-3">{c.message_template}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 flex-wrap">
                      <button
                        onClick={() => run(c.id, true)}
                        disabled={busyId !== null}
                        className="text-[11px] px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 inline-flex items-center gap-1"
                        title="Aperçu sans envoi"
                      >
                        <Eye className="w-3 h-3" /> Simuler
                      </button>
                      <button
                        onClick={() => publish(c.id)}
                        disabled={busyId !== null}
                        className="text-[11px] px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
                        title="Envoie les DM un par un, espacés 2-3 min (via GitHub Actions)"
                      >
                        <Play className={`w-3 h-3 ${busyId === c.id ? 'animate-pulse' : ''}`} /> Lancer l&apos;envoi
                      </button>
                      <button
                        onClick={() => stop(c.id)}
                        disabled={!c.active}
                        className="text-[11px] px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-40 inline-flex items-center gap-1"
                        title="Coupe l'envoi en cours (pause la campagne)"
                      >
                        <Square className="w-3 h-3" /> Arrêter
                      </button>
                      <button
                        onClick={() => loadSends(c.id)}
                        className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                      >
                        Historique
                      </button>
                      <button
                        onClick={() => remove(c.id)}
                        className="text-[11px] px-1.5 py-1 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {preview && preview.length > 0 && (
                    <div className="mt-2 bg-gray-50 rounded p-2">
                      <p className="text-[11px] font-medium text-gray-700 mb-1">Aperçu — {preview.length} cibles trouvées</p>
                      <ul className="space-y-1">
                        {preview.map((p, i) => (
                          <li key={i} className="text-[11px] text-gray-600">
                            <span className="font-medium">{p.name || 'Anonyme'}</span> : {p.comment}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {sends && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <p className="text-[11px] font-medium text-gray-700 mb-1">{sends.length} DM envoyés</p>
                      <div className="space-y-1 max-h-[200px] overflow-y-auto">
                        {sends.map((s) => (
                          <div key={s.id} className="text-[11px] text-gray-600 flex items-center gap-2">
                            <span className="font-medium">{s.commenter_name || 'Anonyme'}</span>
                            {s.commenter_profile_url && (
                              <a
                                href={s.commenter_profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                profil
                              </a>
                            )}
                            <span className="text-gray-400">{formatDistanceToNow(s.sent_at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
