'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { CompetitorTarget, CompetitorLead, CompetitorLeadStatus } from '@/types'
import { Plus, Trash2, Download, Sparkles, Send, ExternalLink } from 'lucide-react'
import { HelpButton } from '@/components/HelpButton'
import { formatDistanceToNow } from '@/lib/utils'

const STATUS_LABELS: Record<CompetitorLeadStatus, string> = {
  new: 'Nouveau',
  qualified: 'Qualifié',
  invited: 'Invité',
  connected: 'Connecté',
  ignored: 'Ignoré',
}

const STATUS_COLORS: Record<CompetitorLeadStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  qualified: 'bg-green-100 text-green-700',
  invited: 'bg-orange-100 text-orange-700',
  connected: 'bg-purple-100 text-purple-700',
  ignored: 'bg-gray-100 text-gray-500',
}

export default function CompetitorPage() {
  const [targets, setTargets] = useState<CompetitorTarget[]>([])
  const [leads, setLeads] = useState<CompetitorLead[]>([])
  const [activeTarget, setActiveTarget] = useState<string | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState<'all' | 'qualified' | 'top' | 'new'>('all')

  const [label, setLabel] = useState('')
  const [postUrl, setPostUrl] = useState('')
  const [jobKeywords, setJobKeywords] = useState('')
  const [createError, setCreateError] = useState('')
  const [search, setSearch] = useState('')
  const [savedToCrm, setSavedToCrm] = useState<Set<string>>(new Set())
  const [draftById, setDraftById] = useState<Record<string, string>>({})

  const fetchAll = useCallback(async () => {
    const t = await fetch('/api/competitor/targets').then((r) => r.json())
    if (Array.isArray(t)) setTargets(t)
    const params = activeTarget === 'all' ? '' : `?target_id=${activeTarget}`
    const l = await fetch(`/api/competitor/leads${params}`).then((r) => r.json())
    if (Array.isArray(l)) setLeads(l)
  }, [activeTarget])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const createTarget = async () => {
    setCreateError('')
    if (!postUrl.trim()) {
      setCreateError("Renseigne d'abord l'URL du post LinkedIn.")
      return
    }
    try {
      const res = await fetch('/api/competitor/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || null,
          post_url: postUrl.trim(),
          job_title_keywords: jobKeywords,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(`Erreur ${res.status}: ${data.error || res.statusText}`)
        return
      }
      setLabel('')
      setPostUrl('')
      setJobKeywords('')
      fetchAll()
    } catch (err) {
      setCreateError(`Erreur réseau: ${String(err)}`)
    }
  }

  const removeTarget = async (id: string) => {
    if (!confirm('Supprimer ce post cible et tous ses leads ?')) return
    await fetch(`/api/competitor/targets/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  const fetchComments = async (targetId: string) => {
    setBusy(`fetch-${targetId}`)
    setMsg('Récupération des commentaires…')
    try {
      const res = await fetch(`/api/competitor/targets/${targetId}/fetch`, { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      let msgText = `${data.stored} nouveaux leads · ${data.scanned} commentaires scannés`
      if (data.stored === 0 && data.scanned > 0) {
        msgText += ` · ${data.skipped_no_id || 0} skipped (pas d'ID)`
        if (data.sample) {
          console.warn('Sample raw comment from Unipile (0 stored):', data.sample)
          msgText += ' — voir console pour le format brut'
        }
      }
      setMsg(msgText)
      fetchAll()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const qualifyAll = async () => {
    setBusy('qualify')
    setMsg('Scoring IA en cours…')
    try {
      const body: { target_id?: string; limit: number } = { limit: 50 }
      if (activeTarget !== 'all') body.target_id = activeTarget
      const res = await fetch('/api/competitor/leads/qualify-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMsg(`${data.scored} scorés · ${data.high_value} ≥ 7/10`)
      fetchAll()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const updateLead = async (id: string, body: Partial<CompetitorLead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...body } : l)))
    await fetch(`/api/competitor/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const removeLead = async (id: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== id))
    await fetch(`/api/competitor/leads/${id}`, { method: 'DELETE' })
  }

  // Étape 1 : générer le message SANS envoyer (preview), pour le relire/éditer.
  const prepareInvite = async (id: string) => {
    setBusy(`invite-${id}`)
    try {
      const res = await fetch(`/api/competitor/leads/${id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true, generate_ai: true }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setDraftById((p) => ({ ...p, [id]: data.preview_message || '' }))
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  // Étape 2 : envoyer l'invitation avec le message (édité) validé à la main.
  const sendInvite = async (id: string) => {
    setBusy(`invite-${id}`)
    try {
      const res = await fetch(`/api/competitor/leads/${id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: (draftById[id] || '').trim() || undefined, generate_ai: !draftById[id] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(`${data.error}${data.limited ? ' (garde-fou LinkedIn)' : ''}`)
      updateLead(id, { status: 'invited', invitation_message: data.invitation_message, invited_at: data.invited_at })
      setDraftById((p) => { const n = { ...p }; delete n[id]; return n })
      setMsg(`Invitation envoyée à ${data.commenter_name || ''} ✅`)
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads
      .filter((l) => {
        if (filter === 'top') return l.score >= 7
        if (filter === 'qualified') return l.status === 'qualified'
        if (filter === 'new') return l.status === 'new'
        return true
      })
      .filter((l) => {
        if (!q) return true
        return (
          (l.commenter_name || '').toLowerCase().includes(q) ||
          (l.commenter_headline || '').toLowerCase().includes(q) ||
          (l.comment_text || '').toLowerCase().includes(q)
        )
      })
  }, [leads, filter, search])

  const saveToCrm = async (leadId: string) => {
    setBusy(`save-${leadId}`)
    try {
      const res = await fetch(`/api/competitor/leads/${leadId}/save-to-crm`, { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSavedToCrm((prev) => new Set(prev).add(leadId))
      setMsg(`Ajouté au CRM : ${data.contact?.name || 'OK'}`)
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const counts = useMemo(() => ({
    total: leads.length,
    top: leads.filter((l) => l.score >= 7).length,
    qualified: leads.filter((l) => l.status === 'qualified').length,
    invited: leads.filter((l) => l.status === 'invited').length,
    new: leads.filter((l) => l.status === 'new').length,
  }), [leads])

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Outreach concurrent</h1>
            <p className="text-xs text-gray-500">
              Récupère les commentateurs des posts de tes concurrents → IA score → invitation LinkedIn ciblée.
            </p>
          </div>
          <HelpButton sectionId="competitor" />
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        {/* Create target */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <h2 className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouveau post cible
          </h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Label (ex: Post Concurrent X)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm w-64"
            />
            <input
              type="text"
              placeholder="URL du post LinkedIn"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[300px]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Mots-clés cible (optionnel — CEO, Founder, CMO… séparés par virgule)"
              value={jobKeywords}
              onChange={(e) => setJobKeywords(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[260px]"
              title="+1 point par mot-clé matchant le headline du commentateur (max 3). Laisse vide pour scoring IA pur."
            />
            <button
              onClick={createTarget}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Ajouter
            </button>
          </div>
          {createError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {createError}
            </div>
          )}
        </div>

        {/* Targets list */}
        <div className="space-y-2">
          {targets.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
              Aucun post cible. Ajoute-en un ci-dessus.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setActiveTarget('all')}
                  className={`text-[11px] px-2.5 py-1 rounded-full border ${
                    activeTarget === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  Tous les posts ({counts.total})
                </button>
                {targets.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTarget(t.id)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border inline-flex items-center gap-1 ${
                      activeTarget === t.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                    }`}
                    title={t.post_url}
                  >
                    {t.label || t.post_url.slice(-30)}
                  </button>
                ))}
              </div>

              {targets.map((t) => (
                <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900">{t.label || 'Sans label'}</span>
                        <a
                          href={t.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          Post <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        {t.last_run_at && (
                          <span className="text-[10px] text-gray-400">scan {formatDistanceToNow(t.last_run_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => fetchComments(t.id)}
                        disabled={busy !== null}
                        className="text-[11px] px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Download className={`w-3 h-3 ${busy === `fetch-${t.id}` ? 'animate-pulse' : ''}`} />
                        Récup commentaires
                      </button>
                      <button
                        onClick={() => removeTarget(t.id)}
                        className="text-[11px] px-1.5 py-1 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Action toolbar + filters */}
        {targets.length > 0 && (
          <>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <button
                onClick={qualifyAll}
                disabled={busy !== null || counts.total === 0}
                className="px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5 font-medium"
              >
                <Sparkles className={`w-3.5 h-3.5 ${busy === 'qualify' ? 'animate-pulse' : ''}`} />
                Scorer IA en masse
              </button>
              {(['all', 'top', 'qualified', 'new'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[11px] px-2 py-1 rounded-full border ${
                    filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {f === 'all' && `Tous (${counts.total})`}
                  {f === 'top' && `🔥 Top score (${counts.top})`}
                  {f === 'qualified' && `Qualifiés (${counts.qualified})`}
                  {f === 'new' && `Nouveaux (${counts.new})`}
                </button>
              ))}
              <input
                type="text"
                placeholder="Filtrer (job title, nom, commentaire…)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs w-64"
              />
              {search && (
                <span className="text-[11px] text-gray-500">{filteredLeads.length} résultats</span>
              )}
              {msg && <span className="text-gray-500 ml-auto">{msg}</span>}
            </div>

            {/* Leads list */}
            <div className="space-y-2">
              {filteredLeads.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
                  Aucun lead. Récupère les commentaires d&apos;un post.
                </div>
              ) : (
                filteredLeads.map((l) => {
                  const scoreColor =
                    l.score >= 8
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : l.score >= 5
                        ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                        : 'bg-red-100 text-red-600 border-red-200'
                  return (
                    <div key={l.id} className={`bg-white border rounded-lg p-3 ${l.score >= 7 ? 'border-green-200' : 'border-gray-200'}`}>
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-gray-900">{l.commenter_name || 'Anonyme'}</span>
                            {l.commenter_profile_url && (
                              <a
                                href={l.commenter_profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-0.5"
                              >
                                Profil <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                            {l.score > 0 && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${scoreColor} font-semibold`}>
                                {l.score}/10
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[l.status]}`}>
                              {STATUS_LABELS[l.status]}
                            </span>
                          </div>
                          {l.commenter_headline && (
                            <p className="text-xs text-gray-500 mt-0.5">{l.commenter_headline}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => saveToCrm(l.id)}
                            disabled={busy !== null || savedToCrm.has(l.id)}
                            className={`text-[11px] px-2 py-1 rounded inline-flex items-center gap-1 disabled:opacity-60 ${
                              savedToCrm.has(l.id)
                                ? 'bg-green-100 text-green-700 cursor-default'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                            title="Ajouter ce lead à ta table Contacts (CRM)"
                          >
                            {savedToCrm.has(l.id) ? '✓ Dans le CRM' : '→ CRM'}
                          </button>
                          {(l.status === 'new' || l.status === 'qualified') && draftById[l.id] === undefined ? (
                            <button
                              onClick={() => prepareInvite(l.id)}
                              disabled={busy !== null}
                              className="text-[11px] px-2 py-1 border border-orange-300 text-orange-700 rounded hover:bg-orange-50 disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              <Sparkles className={`w-3 h-3 ${busy === `invite-${l.id}` ? 'animate-pulse' : ''}`} />
                              Préparer le message
                            </button>
                          ) : null}
                          <select
                            value={l.status}
                            onChange={(e) => updateLead(l.id, { status: e.target.value as CompetitorLeadStatus })}
                            className={`text-[11px] rounded-full px-2 py-0.5 border-0 cursor-pointer ${STATUS_COLORS[l.status]}`}
                          >
                            {(Object.keys(STATUS_LABELS) as CompetitorLeadStatus[]).map((s) => (
                              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeLead(l.id)}
                            className="text-[11px] px-1.5 py-1 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {l.comment_text && (
                        <p className="text-xs text-gray-700 italic bg-gray-50 rounded px-2 py-1.5 line-clamp-3">
                          « {l.comment_text} »
                        </p>
                      )}
                      {l.score_reason && (
                        <p className={`text-[11px] mt-1 italic ${l.score >= 7 ? 'text-green-700' : 'text-gray-400'}`}>
                          ✨ {l.score_reason}
                        </p>
                      )}
                      {draftById[l.id] !== undefined && (
                        <div className="mt-2 border border-orange-200 rounded-lg p-2 bg-orange-50/50">
                          <div className="text-[10px] font-bold uppercase text-orange-600 mb-1">Message d&apos;invitation — édite, puis envoie</div>
                          <textarea
                            value={draftById[l.id]}
                            onChange={(e) => setDraftById((p) => ({ ...p, [l.id]: e.target.value }))}
                            rows={3} maxLength={300}
                            className="w-full text-[13px] text-gray-900 border border-gray-200 rounded p-2 focus:border-orange-400 focus:outline-none"
                          />
                          <div className="flex items-center gap-2 mt-1">
                            <button onClick={() => sendInvite(l.id)} disabled={busy !== null}
                              className="text-[11px] px-2.5 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 inline-flex items-center gap-1">
                              <Send className="w-3 h-3" /> Envoyer l&apos;invitation
                            </button>
                            <button onClick={() => setDraftById((p) => { const n = { ...p }; delete n[l.id]; return n })}
                              className="text-[11px] px-2.5 py-1 border border-gray-300 rounded hover:bg-white">Annuler</button>
                            <span className="text-[10px] text-gray-400 ml-auto">{(draftById[l.id] || '').length}/300</span>
                          </div>
                        </div>
                      )}
                      {l.invitation_message && (
                        <p className="text-[11px] text-orange-700 mt-1 bg-orange-50 rounded px-2 py-1">
                          → {l.invitation_message}
                        </p>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
