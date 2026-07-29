'use client'

import { useEffect, useState, useCallback } from 'react'
import { CommentCampaign, CommentSend } from '@/types'
import { Plus, Play, Trash2, Sparkles, Power, Users, MessageCircle, ExternalLink, X } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

export default function CommentsPage() {
  const [campaigns, setCampaigns] = useState<CommentCampaign[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [draftsByCampaign, setDraftsByCampaign] = useState<Record<string, CommentSend[]>>({})
  const [sentCountByCampaign, setSentCountByCampaign] = useState<Record<string, number>>({})
  const [showForm, setShowForm] = useState(false)

  // create form
  const [name, setName] = useState('')
  const [membersInput, setMembersInput] = useState('')
  const [dailyCap, setDailyCap] = useState('15')
  const [minDelay, setMinDelay] = useState('180')
  const [maxDelay, setMaxDelay] = useState('240')
  const [alsoLike, setAlsoLike] = useState(true)
  const [allowSelfPromo, setAllowSelfPromo] = useState(false)
  const [instructions, setInstructions] = useState('')

  const fetchCampaigns = useCallback(async () => {
    const data = await fetch('/api/comment-campaigns').then((r) => r.json())
    if (Array.isArray(data)) setCampaigns(data)
  }, [])

  const loadDrafts = useCallback(async (id: string) => {
    const data = await fetch(`/api/comment-campaigns/${id}`).then((r) => r.json())
    const sends: CommentSend[] = data.sends || []
    setDraftsByCampaign((prev) => ({ ...prev, [id]: sends.filter((s) => s.status === 'draft') }))
    setSentCountByCampaign((prev) => ({ ...prev, [id]: sends.filter((s) => s.status === 'sent').length }))
  }, [])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  useEffect(() => {
    campaigns.forEach((c) => loadDrafts(c.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns.length])

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
        min_delay_sec: Number(minDelay) || 180,
        max_delay_sec: Number(maxDelay) || 240,
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

  const generate = async (id: string) => {
    setBusyId(id)
    setMsg('Génération des brouillons (aucun commentaire posté)…')
    const res = await fetch(`/api/comment-campaigns/${id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    setBusyId(null)
    if (data.error) {
      setMsg(`Erreur: ${data.error}`)
    } else {
      setMsg(`${data.generated || 0} brouillon(s) généré(s) sur ${data.posts_found || 0} posts trouvés. Revois-les ci-dessous.`)
      loadDrafts(id)
    }
  }

  const postOne = async (id: string) => {
    if (!confirm('Poster le prochain commentaire pour de vrai maintenant ?')) return
    setBusyId(id)
    setMsg('Envoi en cours…')
    const res = await fetch(`/api/comment-campaigns/${id}/run`, { method: 'POST' })
    const data = await res.json()
    setBusyId(null)
    if (data.error) setMsg(`Erreur: ${data.error}`)
    else if (data.posted) setMsg(`Commentaire posté ✅. Reste ${data.pending} en attente.`)
    else setMsg(data.skipped_reason || 'Rien à poster.')
    loadDrafts(id)
    fetchCampaigns()
  }

  const saveDraft = async (campaignId: string, sendId: string, text: string) => {
    await fetch(`/api/comment-sends/${sendId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_text: text }),
    })
  }

  const skipDraft = async (campaignId: string, sendId: string) => {
    setDraftsByCampaign((prev) => ({
      ...prev,
      [campaignId]: (prev[campaignId] || []).filter((d) => d.id !== sendId),
    }))
    await fetch(`/api/comment-sends/${sendId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped' }),
    })
  }

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Commentaires auto</h1>
            <p className="text-xs text-gray-500">
              1) Génère les brouillons · 2) Revois / édite / passe · 3) L&apos;app les poste espacés dans le temps.
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
          <div className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">{msg}</div>
        )}

        {showForm && (
          <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
            <h2 className="font-semibold text-sm text-gray-900">Nouvelle campagne</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-gray-600 md:col-span-2">
                Nom
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Réseau SEO/IA"
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-gray-600 md:col-span-2">
                Membres à suivre — colle ton URL de recherche LinkedIn (fromMember) OU les ids ACoAA…
                <textarea value={membersInput} onChange={(e) => setMembersInput(e.target.value)} rows={3}
                  placeholder='https://www.linkedin.com/search/results/content/?...&fromMember=["ACoAA...","ACoAA..."]'
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono" />
                <span className="text-[11px] text-gray-400">{memberPreviewCount} membre(s) détecté(s)</span>
              </label>
              <label className="text-xs text-gray-600">
                Plafond / jour
                <input type="number" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-gray-600">
                  Délai min (s)
                  <input type="number" value={minDelay} onChange={(e) => setMinDelay(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                </label>
                <label className="text-xs text-gray-600">
                  Délai max (s)
                  <input type="number" value={maxDelay} onChange={(e) => setMaxDelay(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                </label>
              </div>
              <label className="text-xs text-gray-600 md:col-span-2">
                Consignes IA (optionnel)
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2}
                  placeholder="Ex: reste factuel, tutoiement, pas de superlatifs."
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={alsoLike} onChange={(e) => setAlsoLike(e.target.checked)} />
                Liker le post aussi
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={allowSelfPromo} onChange={(e) => setAllowSelfPromo(e.target.checked)} />
                Autoriser ~20% d&apos;auto-promo Decupler
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={create} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Créer</button>
              <button onClick={() => setShowForm(false)} className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">Annuler</button>
            </div>
          </section>
        )}

        {campaigns.length === 0 && !showForm && (
          <div className="text-center text-sm text-gray-400 py-10">Aucune campagne. Clique sur « Nouvelle campagne ».</div>
        )}

        {campaigns.map((c) => {
          const drafts = draftsByCampaign[c.id] || []
          const sentCount = sentCountByCampaign[c.id] || 0
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
                      <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {c.member_ids?.length || 0} membres</span>
                      <span>Plafond {c.daily_cap}/j</span>
                      <span>délai {c.min_delay_sec}-{c.max_delay_sec}s</span>
                      {c.also_like && <span>+ like</span>}
                      <span className="text-amber-600">{drafts.length} brouillon(s)</span>
                      <span className="text-green-600">{sentCount} posté(s)</span>
                      {c.last_run_at && <span>Dernier {formatDistanceToNow(c.last_run_at)}</span>}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => update(c.id, { active: !c.active })}
                  className={`text-[10px] px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 shrink-0 ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                  title="Activer / désactiver la session auto"
                >
                  <Power className="w-3 h-3" /> {c.active ? 'Actif' : 'En pause'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 mt-3 pl-11">
                <button disabled={busyId === c.id} onClick={() => generate(c.id)}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                  <Sparkles className="w-3.5 h-3.5" /> Générer les brouillons
                </button>
                <button disabled={busyId === c.id || drafts.length === 0} onClick={() => postOne(c.id)}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">
                  <Play className="w-3.5 h-3.5" /> Poster 1 maintenant (test)
                </button>
                <button onClick={() => remove(c.id)}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer
                </button>
              </div>

              {drafts.length > 0 && (
                <div className="mt-3 pl-11 space-y-2">
                  <div className="text-[10px] font-bold uppercase text-gray-400">
                    Brouillons — édite le texte, ou passe. Rien n&apos;est posté tant que tu ne cliques pas.
                  </div>
                  {drafts.map((d) => (
                    <DraftRow key={d.id} draft={d}
                      onSave={(text) => saveDraft(c.id, d.id, text)}
                      onSkip={() => skipDraft(c.id, d.id)} />
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

function DraftRow({ draft, onSave, onSkip }: { draft: CommentSend; onSave: (t: string) => void; onSkip: () => void }) {
  const [text, setText] = useState(draft.comment_text || '')
  const [saved, setSaved] = useState(true)
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">{draft.author_name}</span>
        <div className="flex items-center gap-2">
          {draft.post_url && (
            <a href={draft.post_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 inline-flex items-center gap-1">
              voir le post <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          <button onClick={onSkip} className="text-[11px] text-gray-400 hover:text-red-600 inline-flex items-center gap-0.5" title="Ne pas poster celui-ci">
            <X className="w-3 h-3" /> passer
          </button>
        </div>
      </div>
      {draft.post_excerpt && <p className="text-[11px] text-gray-400 italic mt-1 line-clamp-2">“{draft.post_excerpt}…”</p>}
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setSaved(false) }}
        onBlur={() => { if (!saved) { onSave(text); setSaved(true) } }}
        rows={3}
        className="mt-2 w-full text-sm text-gray-900 bg-white border border-gray-200 rounded p-2 focus:border-blue-400 focus:outline-none"
      />
      <div className="text-[10px] text-gray-400 mt-0.5 h-3">{saved ? 'enregistré' : 'modifié — clique ailleurs pour enregistrer'}</div>
    </div>
  )
}
