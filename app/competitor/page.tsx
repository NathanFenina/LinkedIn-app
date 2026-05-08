'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { CompetitorTarget, CompetitorLead, CompetitorLeadStatus } from '@/types'
import { Plus, Trash2, Download, Sparkles, Send, ExternalLink } from 'lucide-react'
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
  const [sizeTags, setSizeTags] = useState('')

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
    if (!postUrl.trim()) return
    const res = await fetch('/api/competitor/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: label.trim() || null,
        post_url: postUrl.trim(),
        job_title_keywords: jobKeywords,
        company_size_tags: sizeTags,
      }),
    })
    if (res.ok) {
      setLabel('')
      setPostUrl('')
      setJobKeywords('')
      setSizeTags('')
      fetchAll()
    } else {
      const data = await res.json()
      setMsg(`Erreur: ${data.error}`)
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
      setMsg(`${data.stored} nouveaux leads · ${data.scanned} commentaires scannés`)
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

  const inviteLead = async (id: string) => {
    setBusy(`invite-${id}`)
    try {
      const res = await fetch(`/api/competitor/leads/${id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generate_ai: true }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      updateLead(id, { status: 'invited', invitation_message: data.invitation_message, invited_at: data.invited_at })
      setMsg(`Invitation envoyée à ${data.commenter_name || ''}`)
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (filter === 'top') return l.score >= 7
      if (filter === 'qualified') return l.status === 'qualified'
      if (filter === 'new') return l.status === 'new'
      return true
    })
  }, [leads, filter])

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
        <div className="max-w-[1400px] mx-auto px-6 py-3">
          <h1 className="font-semibold text-gray-900 text-base leading-tight">Outreach concurrent</h1>
          <p className="text-xs text-gray-500">
            Récupère les commentateurs des posts de tes concurrents → IA score → invitation LinkedIn ciblée.
          </p>
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
              placeholder="Mots-clés job title (CEO, Founder, CMO…) — séparés par virgule"
              value={jobKeywords}
              onChange={(e) => setJobKeywords(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[260px]"
              title="+1 point par mot-clé matchant le headline du commentateur (max 3)"
            />
            <input
              type="text"
              placeholder="Tags entreprise (SaaS, B2B, Agency, SMB…)"
              value={sizeTags}
              onChange={(e) => setSizeTags(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[260px]"
              title="+1 point par tag matchant (max 2)"
            />
            <button
              onClick={createTarget}
              disabled={!postUrl.trim()}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>
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
                          {l.status === 'new' || l.status === 'qualified' ? (
                            <button
                              onClick={() => inviteLead(l.id)}
                              disabled={busy !== null}
                              className="text-[11px] px-2 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              <Send className={`w-3 h-3 ${busy === `invite-${l.id}` ? 'animate-pulse' : ''}`} />
                              Inviter (IA)
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
