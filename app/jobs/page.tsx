'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { JobPosting, JobPostingStatus } from '@/types'
import { ExternalLink, Search, Trash2, Users, Send } from 'lucide-react'
import { HelpButton } from '@/components/HelpButton'
import { formatDistanceToNow } from '@/lib/utils'

const STATUS_LABELS: Record<JobPostingStatus, string> = {
  new: 'Nouveau',
  shortlisted: 'Shortlisté',
  contacted: 'Contacté',
  ignored: 'Ignoré',
}

const STATUS_COLORS: Record<JobPostingStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  shortlisted: 'bg-purple-100 text-purple-700',
  contacted: 'bg-green-100 text-green-700',
  ignored: 'bg-gray-100 text-gray-500',
}

interface FoundContact {
  provider_id: string | null
  name: string | null
  headline: string | null
  profile_url: string | null
  avatar_url: string | null
  location: string | null
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [keyword, setKeyword] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState<JobPostingStatus | 'all'>('all')
  const [contactsByJob, setContactsByJob] = useState<Record<string, FoundContact[]>>({})
  const [roleByJob, setRoleByJob] = useState<Record<string, string>>({})
  // Brouillons de message d'approche, clé = `${jobId}:${providerId}`.
  const [contactDraft, setContactDraft] = useState<Record<string, string>>({})
  const [contactSent, setContactSent] = useState<Set<string>>(new Set())

  const fetchJobs = useCallback(async () => {
    const data = await fetch('/api/jobs').then((r) => r.json())
    if (Array.isArray(data)) setJobs(data)
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  const runSearch = async () => {
    if (!keyword.trim()) {
      alert('Mot-clé requis')
      return
    }
    setBusy('search')
    setMsg('Recherche d\'offres en cours…')
    try {
      const res = await fetch('/api/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), location: location.trim() || undefined }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.errors?.length) console.error('Jobs upsert errors:', data.errors, 'sample:', data.sample)
      const errSuffix = data.errors?.length ? ` ⚠️ ${data.errors.length} erreurs (console)` : ''
      setMsg(`${data.stored} ajoutées · ${data.total} trouvées${errSuffix}`)
      await fetchJobs()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const updateJob = async (id: string, body: Partial<JobPosting>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...body } : j)))
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const removeJob = async (id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id))
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
  }

  const prepareContact = async (jobId: string, c: FoundContact) => {
    const key = `${jobId}:${c.provider_id}`
    setBusy(`prep-${key}`)
    try {
      const res = await fetch(`/api/jobs/${jobId}/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: c.name, headline: c.headline }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setContactDraft((p) => ({ ...p, [key]: data.text || '' }))
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const sendContact = async (jobId: string, c: FoundContact) => {
    const key = `${jobId}:${c.provider_id}`
    if (!c.provider_id) { setMsg('Erreur: pas de provider_id pour ce contact.'); return }
    if (!confirm(`Envoyer l'invitation à ${c.name} ?`)) return
    setBusy(`send-${key}`)
    try {
      const res = await fetch('/api/jobs/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: c.provider_id, message: (contactDraft[key] || '').trim() || undefined }),
      })
      const data = await res.json()
      if (data.error) throw new Error(`${data.error}${data.limited ? ' (garde-fou LinkedIn)' : ''}`)
      setContactSent((prev) => new Set(prev).add(key))
      updateJob(jobId, { status: 'contacted' })
      setMsg(`Invitation envoyée à ${c.name} ✅`)
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const findContacts = async (jobId: string) => {
    const role = roleByJob[jobId] || 'CEO OR Founder OR Marketing OR CMO'
    setBusy(`contacts-${jobId}`)
    try {
      const res = await fetch(`/api/jobs/${jobId}/find-contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, limit: 10 }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setContactsByJob((prev) => ({ ...prev, [jobId]: data.contacts || [] }))
      const ok = data.company_id_used ? `✓ filtré sur ${data.company_matched}` : '⚠️ pas de filtre boîte (résultats imprécis)'
      setMsg(`${(data.contacts || []).length} contacts · ${ok}`)
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return jobs
    return jobs.filter((j) => j.status === filter)
  }, [jobs, filter])

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Offres d&apos;emploi LinkedIn</h1>
            <p className="text-xs text-gray-500">{jobs.length} offres · contacte directement les décideurs</p>
          </div>
          <HelpButton sectionId="jobs" />
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        {/* Search form */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] text-gray-500 uppercase mb-1">Mot-clé</label>
            <input
              type="text"
              placeholder="Ex: SEO Manager"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="w-40">
            <label className="block text-[11px] text-gray-500 uppercase mb-1">Lieu (optionnel)</label>
            <input
              type="text"
              placeholder="Paris"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={runSearch}
            disabled={busy !== null}
            className="text-xs px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Search className={`w-3.5 h-3.5 ${busy === 'search' ? 'animate-spin' : ''}`} />
            Rechercher
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 flex-wrap">
          {(['all', 'new', 'shortlisted', 'contacted', 'ignored'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] px-2.5 py-1 rounded-full border ${
                filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {f === 'all'
                ? `Tous (${jobs.length})`
                : `${STATUS_LABELS[f]} (${jobs.filter((j) => j.status === f).length})`}
            </button>
          ))}
          {msg && <span className="text-xs text-gray-500 ml-auto">{msg}</span>}
        </div>

        {/* Jobs list */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
              Aucune offre. Lance une recherche.
            </div>
          ) : (
            filtered.map((j) => {
              const foundContacts = contactsByJob[j.id]
              return (
                <div key={j.id} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900">{j.title || 'Sans titre'}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[j.status]}`}>
                          {STATUS_LABELS[j.status]}
                        </span>
                        {j.posted_at && <span className="text-[10px] text-gray-400">{formatDistanceToNow(j.posted_at)}</span>}
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {j.company && <span className="font-medium">{j.company}</span>}
                        {j.location && <span className="text-gray-500"> · {j.location}</span>}
                        {j.matched_keyword && <span className="text-gray-400 italic"> · via &quot;{j.matched_keyword}&quot;</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {j.job_url && (
                        <a
                          href={j.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 inline-flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> Offre
                        </a>
                      )}
                      <select
                        value={j.status}
                        onChange={(e) => updateJob(j.id, { status: e.target.value as JobPostingStatus })}
                        className={`text-[11px] rounded-full px-2 py-0.5 border-0 cursor-pointer ${STATUS_COLORS[j.status]}`}
                      >
                        {(Object.keys(STATUS_LABELS) as JobPostingStatus[]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeJob(j.id)}
                        className="text-[11px] px-1.5 py-1 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Find contacts section */}
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        placeholder="Rôles à chercher (ex: CMO OR Founder)"
                        value={roleByJob[j.id] ?? ''}
                        onChange={(e) => setRoleByJob((prev) => ({ ...prev, [j.id]: e.target.value }))}
                        className="flex-1 min-w-[200px] border border-gray-200 rounded px-2 py-1 text-xs"
                      />
                      <button
                        onClick={() => findContacts(j.id)}
                        disabled={busy !== null}
                        className="text-[11px] px-2.5 py-1 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Users className="w-3 h-3" />
                        {busy === `contacts-${j.id}` ? 'Recherche…' : 'Trouver les décideurs'}
                      </button>
                    </div>

                    {foundContacts && foundContacts.length === 0 && (
                      <p className="text-[11px] text-gray-400 italic mt-2">Aucun contact trouvé.</p>
                    )}
                    {foundContacts && foundContacts.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {foundContacts.map((c, i) => {
                          const key = `${j.id}:${c.provider_id}`
                          const draft = contactDraft[key]
                          const sent = contactSent.has(key)
                          return (
                            <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1.5">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{c.name || 'Anonyme'}</span>
                                {c.headline && <span className="text-gray-500 truncate">{c.headline}</span>}
                                {c.profile_url && (
                                  <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5 ml-auto">
                                    Profil <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                )}
                                {sent ? (
                                  <span className="text-green-600 inline-flex items-center gap-0.5"><Send className="w-3 h-3" /> envoyé</span>
                                ) : draft === undefined ? (
                                  <button onClick={() => prepareContact(j.id, c)} disabled={busy !== null || !c.provider_id}
                                    className="text-[11px] px-2 py-0.5 border border-violet-300 text-violet-700 rounded hover:bg-violet-50 disabled:opacity-40 inline-flex items-center gap-1">
                                    {busy === `prep-${key}` ? 'Génère…' : 'Préparer le message'}
                                  </button>
                                ) : null}
                              </div>
                              {draft !== undefined && !sent && (
                                <div className="mt-1.5">
                                  <textarea value={draft} onChange={(e) => setContactDraft((p) => ({ ...p, [key]: e.target.value }))}
                                    rows={3} maxLength={300}
                                    className="w-full text-[13px] text-gray-900 border border-gray-200 rounded p-2 focus:border-violet-400 focus:outline-none" />
                                  <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => sendContact(j.id, c)} disabled={busy !== null}
                                      className="text-[11px] px-2.5 py-1 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1">
                                      <Send className="w-3 h-3" /> Envoyer l&apos;invitation
                                    </button>
                                    <button onClick={() => setContactDraft((p) => { const n = { ...p }; delete n[key]; return n })}
                                      className="text-[11px] px-2.5 py-1 border border-gray-300 rounded hover:bg-white">Annuler</button>
                                    <span className="text-[10px] text-gray-400 ml-auto">{(draft || '').length}/300</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
