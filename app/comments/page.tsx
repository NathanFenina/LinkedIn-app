'use client'

import { useEffect, useState, useCallback } from 'react'
import { CommentCampaign } from '@/types'
import { Plus, Play, Trash2, Eye, Power, Users, MessageCircle, ExternalLink } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface PreviewRow {
  author: string
  excerpt: string
  comment: string
  url: string
}

interface RunResult {
  dry_run: boolean
  posts_found?: number
  comments_posted?: number
  remaining_today?: number
  skipped_reason?: string
  preview?: PreviewRow[]
  errors?: string[]
  error?: string
}

export default function CommentsPage() {
  const [campaigns, setCampaigns] = useState<CommentCampaign[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [resultByCampaign, setResultByCampaign] = useState<Record<string, RunResult>>({})
  const [showForm, setShowForm] = useState(false)

  // create form
  const [name, setName] = useState('')
  const [membersInput, setMembersInput] = useState('')
  const [dailyCap, setDailyCap] = useState('15')
  const [maxPerRun, setMaxPerRun] = useState('1')
  const [minDelay, setMinDelay] = useState('180')
  const [maxDelay, setMaxDelay] = useState('240')
  const [alsoLike, setAlsoLike] = useState(true)
  const [allowSelfPromo, setAllowSelfPromo] = useState(false)
  const [instructions, setInstructions] = useState('')

  const fetchCampaigns = useCallback(async () => {
    const data = await fetch('/api/comment-campaigns').then((r) => r.json())
    if (Array.isArray(data)) setCampaigns(data)
  }, [])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  const memberPreviewCount = (membersInput.match(/ACoAA[A-Za-z0-9_-]+/g) || []).length

  const create = async () => {
    if (!name.trim() || !membersInput.trim()) return
    setMsg('')
    const res = await fetch('/api/comment-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        members_input: membersInput.trim(),
        daily_cap: Number(dailyCap) || 15,
        max_per_run: Number(maxPerRun) || 3,
        min_delay_sec: Number(minDelay) || 60,
        max_delay_sec: Number(maxDelay) || 110,
        also_like: alsoLike,
        allow_self_promo: allowSelfPromo,
        instructions: instructions.trim() || null,
      }),
    })
    if (res.ok) {
      setName('')
      setMembersInput('')
      setInstructions('')
      setShowForm(false)
      fetchCampaigns()
    } else {
      const data = await res.json()
      setMsg(`Erreur: ${data.error}`)
    }
  }

  const update = async (id: string, body: Partial<CommentCampaign>) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...body } : c)))
    await fetch(`/api/comment-campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const remove = async (id: string) => {
    if (!confirm('Supprimer cette campagne ?')) return
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
    await fetch(`/api/comment-campaigns/${id}`, { method: 'DELETE' })
  }

  const run = async (id: string, dryRun: boolean) => {
    if (!dryRun && !confirm('Poster de vrais commentaires maintenant ?')) return
    setBusyId(id)
    setMsg(dryRun ? 'Simulation en cours (aucun commentaire posté)…' : 'Envoi en cours…')
    const res = await fetch(`/api/comment-campaigns/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: dryRun }),
    })
    const data: RunResult = await res.json()
    setResultByCampaign((prev) => ({ ...prev, [id]: data }))
    setBusyId(null)
    if (data.error) {
      setMsg(`Erreur: ${data.error}`)
    } else if (dryRun) {
      setMsg(`Simulation: ${data.preview?.length || 0} commentaires générés sur ${data.posts_found || 0} posts trouvés.`)
    } else {
      setMsg(`${data.comments_posted || 0} commentaire(s) posté(s). ${data.skipped_reason || ''}`)
    }
    if (!dryRun) fetchCampaigns()
  }

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">
              Commentaires auto
            </h1>
            <p className="text-xs text-gray-500">
              Commente les posts &lt;24h d&apos;une liste de membres, via IA. Teste toujours en{' '}
              <b>simulation</b> avant d&apos;activer.
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Nouvelle campagne
          </button>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-4">
        {msg && (
          <div className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">
            {msg}
          </div>
        )}

        {showForm && (
          <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
            <h2 className="font-semibold text-sm text-gray-900">Nouvelle campagne</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-gray-600 md:col-span-2">
                Nom
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Réseau SEO/IA — 30 membres"
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-gray-600 md:col-span-2">
                Membres à suivre — colle ton URL de recherche LinkedIn (fromMember) OU les ids ACoAA…
                <textarea
                  value={membersInput}
                  onChange={(e) => setMembersInput(e.target.value)}
                  rows={4}
                  placeholder='https://www.linkedin.com/search/results/content/?datePosted="past-24h"&fromMember=["ACoAA...","ACoAA..."]'
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono"
                />
                <span className="text-[11px] text-gray-400">
                  {memberPreviewCount} membre(s) détecté(s)
                </span>
              </label>

              <label className="text-xs text-gray-600">
                Plafond / jour
                <input
                  type="number"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-gray-600">
                Max par passage (cron horaire)
                <input
                  type="number"
                  value={maxPerRun}
                  onChange={(e) => setMaxPerRun(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-gray-600">
                Délai min entre commentaires (s)
                <input
                  type="number"
                  value={minDelay}
                  onChange={(e) => setMinDelay(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-gray-600">
                Délai max (s)
                <input
                  type="number"
                  value={maxDelay}
                  onChange={(e) => setMaxDelay(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-gray-600 md:col-span-2">
                Consignes IA (optionnel — ton, sujets à éviter, longueur…)
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={2}
                  placeholder="Ex: reste factuel, pas de superlatifs, tutoiement."
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={alsoLike} onChange={(e) => setAlsoLike(e.target.checked)} />
                Liker le post aussi
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={allowSelfPromo}
                  onChange={(e) => setAllowSelfPromo(e.target.checked)}
                />
                Autoriser ~20% d&apos;auto-promo Decupler
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={create}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Créer
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Annuler
              </button>
            </div>
          </section>
        )}

        {campaigns.length === 0 && !showForm && (
          <div className="text-center text-sm text-gray-400 py-10">
            Aucune campagne. Clique sur « Nouvelle campagne » pour commencer.
          </div>
        )}

        {campaigns.map((c) => {
          const result = resultByCampaign[c.id]
          return (
            <section key={c.id} className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                    <MessageCircle className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900 text-sm">{c.name}</h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 mt-1">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3 h-3" /> {c.member_ids?.length || 0} membres
                      </span>
                      <span>Plafond {c.daily_cap}/j</span>
                      <span>{c.max_per_run}/passage</span>
                      <span>délai {c.min_delay_sec}-{c.max_delay_sec}s</span>
                      {c.also_like && <span>+ like</span>}
                      {c.last_run_at && <span>Dernier run {formatDistanceToNow(c.last_run_at)}</span>}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => update(c.id, { active: !c.active })}
                  className={`text-[10px] px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 shrink-0 ${
                    c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                  title="Activer / désactiver le cron"
                >
                  <Power className="w-3 h-3" /> {c.active ? 'Actif' : 'En pause'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 mt-3 pl-11">
                <button
                  disabled={busyId === c.id}
                  onClick={() => run(c.id, true)}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  <Eye className="w-3.5 h-3.5" /> Test (simulation)
                </button>
                <button
                  disabled={busyId === c.id}
                  onClick={() => run(c.id, false)}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" /> Lancer maintenant
                </button>
                <button
                  onClick={() => remove(c.id)}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer
                </button>
              </div>

              {result?.preview && result.preview.length > 0 && (
                <div className="mt-3 pl-11 space-y-2">
                  <div className="text-[10px] font-bold uppercase text-gray-400">
                    Simulation — commentaires que l&apos;IA posterait (rien n&apos;est envoyé)
                  </div>
                  {result.preview.map((p, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700">{p.author}</span>
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-600 inline-flex items-center gap-1"
                          >
                            voir le post <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                      {p.excerpt && (
                        <p className="text-[11px] text-gray-400 italic mt-1 line-clamp-2">“{p.excerpt}…”</p>
                      )}
                      <p className="text-sm text-gray-900 mt-2 bg-white border border-gray-200 rounded p-2">
                        {p.comment}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {result?.errors && result.errors.length > 0 && (
                <div className="mt-2 pl-11 text-[11px] text-red-600">
                  {result.errors.map((e, i) => (
                    <div key={i}>⚠️ {e}</div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}
