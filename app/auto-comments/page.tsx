'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { AutoCommentJob, AutoCommentPost, LinkedInAccount } from '@/types'
import { Plus, Play, Trash2, Eye, Power, ExternalLink, Save, MessageCircle, Square } from 'lucide-react'
import { HelpButton } from '@/components/HelpButton'
import { formatDistanceToNow } from '@/lib/utils'

interface PreviewRow {
  post_url: string | null
  author: string | null
  strategy: string
  comment: string
}

// Pause "humaine" entre deux commentaires, ~3 min avec un peu d'aléatoire.
const WAIT_MIN_S = 150
const WAIT_MAX_S = 210

export default function AutoCommentsPage() {
  const [jobs, setJobs] = useState<AutoCommentJob[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [previewByJob, setPreviewByJob] = useState<Record<string, PreviewRow[]>>({})
  const [postsByJob, setPostsByJob] = useState<Record<string, AutoCommentPost[]>>({})
  const [logByJob, setLogByJob] = useState<Record<string, string[]>>({})

  const appendLog = (id: string, line: string) => {
    const stamp = new Date().toLocaleTimeString('fr-FR')
    setLogByJob((prev) => ({ ...prev, [id]: [...(prev[id] || []), `${stamp}  ${line}`] }))
  }
  const resetLog = (id: string) => setLogByJob((prev) => ({ ...prev, [id]: [] }))

  // run-loop state
  const [runningJobId, setRunningJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [countdown, setCountdown] = useState(0)
  const stopRef = useRef(false)

  // active account persona
  const [account, setAccount] = useState<LinkedInAccount | null>(null)
  const [personaName, setPersonaName] = useState('')
  const [personaIdentity, setPersonaIdentity] = useState('')
  const [personaBrand, setPersonaBrand] = useState('')
  const [personaMsg, setPersonaMsg] = useState('')

  // create form
  const [label, setLabel] = useState('')
  const [searchUrl, setSearchUrl] = useState('')
  const [maxPosts, setMaxPosts] = useState('5')
  const [likePost, setLikePost] = useState(true)
  const [autoRun, setAutoRun] = useState(false)

  const fetchJobs = useCallback(async () => {
    const data = await fetch('/api/auto-comments').then((r) => r.json())
    if (Array.isArray(data)) setJobs(data)
  }, [])

  const fetchAccount = useCallback(async () => {
    const active = await fetch('/api/accounts/active').then((r) => r.json())
    if (!active?.id) return
    const all: LinkedInAccount[] = await fetch('/api/accounts').then((r) => r.json())
    const row = Array.isArray(all) ? all.find((a) => a.id === active.id) : null
    if (row) {
      setAccount(row)
      setPersonaName(row.persona_name || '')
      setPersonaIdentity(row.persona_identity || '')
      setPersonaBrand(row.persona_brand || 'Decupler')
    }
  }, [])

  useEffect(() => {
    fetchJobs()
    fetchAccount()
  }, [fetchJobs, fetchAccount])

  const savePersona = async () => {
    if (!account) return
    setPersonaMsg('Enregistrement…')
    const res = await fetch(`/api/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona_name: personaName,
        persona_identity: personaIdentity,
        persona_brand: personaBrand,
      }),
    })
    setPersonaMsg(res.ok ? 'Persona enregistrée ✓' : 'Erreur enregistrement')
    setTimeout(() => setPersonaMsg(''), 2500)
  }

  const create = async () => {
    if (!searchUrl.trim()) return
    const res = await fetch('/api/auto-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: label.trim() || null,
        search_url: searchUrl.trim(),
        max_posts: Number(maxPosts) || 5,
        like_post: likePost,
        auto_run: autoRun,
      }),
    })
    if (res.ok) {
      setLabel('')
      setSearchUrl('')
      setMaxPosts('5')
      setLikePost(true)
      setAutoRun(false)
      fetchJobs()
    } else {
      const data = await res.json()
      setMsg(`Erreur: ${data.error}`)
    }
  }

  const update = async (id: string, body: Partial<AutoCommentJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...body } : j)))
    await fetch(`/api/auto-comments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const remove = async (id: string) => {
    if (!confirm('Supprimer ce job ?')) return
    setJobs((prev) => prev.filter((j) => j.id !== id))
    await fetch(`/api/auto-comments/${id}`, { method: 'DELETE' })
  }

  const simulate = async (id: string) => {
    setBusyId(id)
    setMsg('Simulation en cours… (génération sans publication)')
    resetLog(id)
    setPreviewByJob((prev) => ({ ...prev, [id]: [] }))
    appendLog(id, 'Démarrage de la simulation…')
    try {
      const res = await fetch(`/api/auto-comments/${id}/preview`, { method: 'POST' })
      if (!res.body) {
        // fallback non-stream
        const data = await res.json().catch(() => ({}))
        if (data.error) throw new Error(data.error)
        setPreviewByJob((prev) => ({ ...prev, [id]: data.preview || [] }))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      const items: PreviewRow[] = []
      // read the NDJSON stream line by line
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          let ev: Record<string, unknown>
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.type === 'log') {
            appendLog(id, String(ev.message))
          } else if (ev.type === 'error') {
            appendLog(id, `❌ ${String(ev.message)}`)
            setMsg(`Erreur: ${String(ev.message)}`)
          } else if (ev.type === 'item') {
            const row: PreviewRow = {
              post_url: (ev.post_url as string) || null,
              author: (ev.author as string) || null,
              strategy: (ev.strategy as string) || '',
              comment: (ev.comment as string) || '',
            }
            items.push(row)
            appendLog(id, `✅ ${row.author || 'auteur'} → ${row.comment}`)
            setPreviewByJob((prev) => ({ ...prev, [id]: [...items] }))
          } else if (ev.type === 'done') {
            appendLog(
              id,
              `Terminé : ${ev.count} commentaires générés (${ev.posts_found} trouvés, ${ev.already_commented} déjà faits).`
            )
            setMsg(`Aperçu : ${ev.count} commentaires générés`)
          }
        }
      }
    } catch (err) {
      appendLog(id, `❌ ${String(err)}`)
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusyId(null)
    }
  }

  // cancellable ~3 min wait with a live countdown; resolves early if stopped.
  const waitWithCountdown = (seconds: number) =>
    new Promise<void>((resolve) => {
      let remaining = seconds
      setCountdown(remaining)
      const t = setInterval(() => {
        remaining -= 1
        if (stopRef.current || remaining <= 0) {
          clearInterval(t)
          setCountdown(0)
          resolve()
        } else {
          setCountdown(remaining)
        }
      }, 1000)
    })

  const launch = async (id: string) => {
    stopRef.current = false
    setRunningJobId(id)
    setProgress(null)
    resetLog(id)
    setMsg('Construction de la file…')
    appendLog(id, 'Construction de la file (recherche + dédup)…')
    try {
      const q = await fetch(`/api/auto-comments/${id}/queue`, { method: 'POST' }).then((r) => r.json())
      if (q.error) throw new Error(q.error)
      const queue: { id: string }[] = q.queue || []
      appendLog(id, `${q.posts_found} trouvés · ${q.already_commented} déjà faits · ${queue.length} en file`)
      if (!queue.length) {
        setMsg(`Rien à commenter (${q.posts_found} trouvés, ${q.already_commented} déjà faits).`)
        appendLog(id, 'Rien à commenter.')
        setRunningJobId(null)
        return
      }
      setProgress({ done: 0, total: queue.length })

      let posted = 0
      for (let i = 0; i < queue.length; i++) {
        if (stopRef.current) {
          setMsg(`Arrêté. ${posted} postés, ${queue.length - i} restants en file (reprenables).`)
          appendLog(id, `⏹ Arrêt. ${posted} postés, ${queue.length - i} restants en file.`)
          break
        }
        setMsg(`Commentaire ${i + 1}/${queue.length} en cours…`)
        appendLog(id, `Commentaire ${i + 1}/${queue.length} en cours…`)
        try {
          const res = await fetch(`/api/auto-comments/${id}/step`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_id: queue[i].id }),
          }).then((r) => r.json())
          if (res.status === 'posted' && !res.skipped) {
            posted++
            appendLog(id, `✅ ${res.author || 'auteur'} → ${res.comment || ''}`)
          } else if (res.status === 'retry') {
            appendLog(id, `⏳ rate-limit (429) — gardé en file, réessai au prochain run`)
          } else if (res.status === 'rejected') {
            appendLog(id, `❌ rejeté : ${res.error || 'erreur inconnue'}`)
          } else if (res.skipped) {
            appendLog(id, `↪︎ déjà posté, ignoré`)
          }
        } catch (err) {
          appendLog(id, `❌ erreur réseau : ${String(err)}`)
        }
        setProgress({ done: i + 1, total: queue.length })
        await loadPosts(id, true)

        if (i < queue.length - 1 && !stopRef.current) {
          const wait = WAIT_MIN_S + Math.floor(Math.random() * (WAIT_MAX_S - WAIT_MIN_S))
          appendLog(id, `⏳ Pause ${fmtCountdown(wait)} avant le prochain…`)
          await waitWithCountdown(wait)
        }
      }
      if (!stopRef.current) {
        setMsg(`Terminé : ${posted} commentaires postés.`)
        appendLog(id, `🏁 Terminé : ${posted} commentaires postés.`)
      }
    } catch (err) {
      appendLog(id, `❌ ${String(err)}`)
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setRunningJobId(null)
      setProgress(null)
      setCountdown(0)
      fetchJobs()
    }
  }

  const stop = () => {
    stopRef.current = true
    setMsg('Arrêt demandé… (le commentaire en cours se termine, puis ça stoppe)')
  }

  const clearQueue = async (id: string) => {
    if (!confirm('Réinitialiser : efface la file en attente et les échecs (garde les posts publiés) ?'))
      return
    await fetch(`/api/auto-comments/${id}/step`, { method: 'DELETE' })
    loadPosts(id, true)
  }

  const loadPosts = async (id: string, force = false) => {
    if (postsByJob[id] && !force) {
      setPostsByJob((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }
    const data = await fetch(`/api/auto-comments/${id}/posts`).then((r) => r.json())
    if (Array.isArray(data)) setPostsByJob((prev) => ({ ...prev, [id]: data }))
  }

  const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight flex items-center gap-1.5">
              <MessageCircle className="w-4 h-4 text-blue-600" /> Auto-comment IA
            </h1>
            <p className="text-xs text-gray-500">
              Donne une URL de feed/recherche LinkedIn : l&apos;app récupère les posts, déduplique
              ceux déjà commentés sur ce compte, et poste un commentaire dans ta persona.
            </p>
          </div>
          <HelpButton sectionId="auto-comments" />
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        {/* Persona du compte actif */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <h2 className="text-sm font-medium text-gray-900">
            Persona du compte actif{account ? ` — ${account.label}` : ''}
          </h2>
          {!account ? (
            <p className="text-xs text-gray-500">
              Aucun compte LinkedIn actif. Ajoute/sélectionne un compte dans la barre latérale.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Nom de la persona (ex: Lucas Besson)"
                  value={personaName}
                  onChange={(e) => setPersonaName(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1.5 text-sm"
                />
                <input
                  type="text"
                  placeholder="Marque à ne pas sur-promouvoir (ex: Decupler)"
                  value={personaBrand}
                  onChange={(e) => setPersonaBrand(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <textarea
                rows={4}
                placeholder="Identité / expertise (le champ 'role' du workflow n8n). Laisse VIDE pour reproduire exactement le n8n actuel."
                value={personaIdentity}
                onChange={(e) => setPersonaIdentity(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-2 text-sm resize-none"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={savePersona}
                  className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded hover:bg-gray-900 inline-flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" /> Enregistrer la persona
                </button>
                {personaMsg && <span className="text-xs text-gray-500">{personaMsg}</span>}
              </div>
            </>
          )}
        </div>

        {/* Create form */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
          <h2 className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouveau job (URL de feed / recherche)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Nom du job (optionnel)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
            <input
              type="text"
              placeholder="URL LinkedIn (feed / search/results/content/…)"
              value={searchUrl}
              onChange={(e) => setSearchUrl(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-gray-700 flex items-center gap-1.5">
              Max posts / run :
              <input
                type="number"
                min={1}
                max={50}
                value={maxPosts}
                onChange={(e) => setMaxPosts(e.target.value)}
                className="w-20 border border-gray-200 rounded px-2 py-1 text-xs"
              />
            </label>
            <label className="text-xs text-gray-700 flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={likePost} onChange={(e) => setLikePost(e.target.checked)} />
              Liker le post avant de commenter
            </label>
            <label className="text-xs text-gray-700 flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
              Auto-run (cron quotidien)
            </label>
            <button
              onClick={create}
              disabled={!searchUrl.trim()}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 ml-auto"
            >
              Créer
            </button>
          </div>
          {msg && <span className="text-xs text-gray-600 ml-1">{msg}</span>}
        </div>

        {/* Jobs list */}
        <div className="space-y-2">
          {jobs.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
              Aucun job. Crée-en un ci-dessus avec une URL de feed/recherche LinkedIn.
            </div>
          ) : (
            jobs.map((j) => {
              const preview = previewByJob[j.id]
              const posts = postsByJob[j.id]
              const isRunning = runningJobId === j.id
              return (
                <div
                  key={j.id}
                  className={`bg-white border rounded-lg p-3 ${j.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900">
                          {j.label || 'Job sans nom'}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            j.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {j.active ? 'Actif' : 'Pausé'}
                        </span>
                        {j.auto_run && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            auto-run
                          </span>
                        )}
                        <a
                          href={j.search_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          URL <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <span className="text-[10px] text-gray-400">max {j.max_posts}/run</span>
                        {j.last_run_at && (
                          <span className="text-[10px] text-gray-400">
                            dernier run {formatDistanceToNow(j.last_run_at)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1 truncate">{j.search_url}</p>
                      {isRunning && progress && (
                        <p className="text-[11px] text-blue-700 mt-1 font-medium">
                          {progress.done}/{progress.total} traités
                          {countdown > 0 && ` · prochain dans ${fmtCountdown(countdown)}`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 flex-wrap">
                      {isRunning ? (
                        <button
                          onClick={stop}
                          className="text-[11px] px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 inline-flex items-center gap-1"
                        >
                          <Square className="w-3 h-3" /> Stop
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => simulate(j.id)}
                            disabled={busyId !== null || runningJobId !== null}
                            className="text-[11px] px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 inline-flex items-center gap-1"
                            title="Génère les commentaires sans rien poster"
                          >
                            <Eye className="w-3 h-3" /> Simuler
                          </button>
                          <button
                            onClick={() => launch(j.id)}
                            disabled={busyId !== null || runningJobId !== null || !j.active}
                            className="text-[11px] px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            <Play className="w-3 h-3" /> Lancer
                          </button>
                          <button
                            onClick={() => update(j.id, { like_post: !j.like_post })}
                            className={`text-[11px] px-2 py-1 border rounded hover:bg-gray-50 ${
                              j.like_post ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-gray-200 text-gray-500'
                            }`}
                            title="Liker le post avant de commenter"
                          >
                            Like {j.like_post ? 'ON' : 'OFF'}
                          </button>
                          <button
                            onClick={() => update(j.id, { active: !j.active })}
                            className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 inline-flex items-center gap-1"
                            title={j.active ? 'Pause' : 'Activer'}
                          >
                            <Power className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => loadPosts(j.id)}
                            className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                          >
                            Historique
                          </button>
                          <button
                            onClick={() => clearQueue(j.id)}
                            className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                            title="Efface la file en attente + les échecs (garde les posts publiés)"
                          >
                            Réinitialiser
                          </button>
                          <button
                            onClick={() => remove(j.id)}
                            className="text-[11px] px-1.5 py-1 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {logByJob[j.id] && logByJob[j.id].length > 0 && (
                    <div className="mt-2 bg-gray-900 rounded p-2">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[11px] font-medium text-gray-300">Logs en direct</p>
                        <button
                          onClick={() => resetLog(j.id)}
                          className="text-[10px] text-gray-400 hover:text-gray-200"
                        >
                          effacer
                        </button>
                      </div>
                      <div className="font-mono text-[10.5px] leading-relaxed text-gray-100 max-h-[220px] overflow-y-auto whitespace-pre-wrap">
                        {logByJob[j.id].map((l, i) => (
                          <div key={i} className={l.includes('❌') ? 'text-red-300' : l.includes('✅') ? 'text-green-300' : ''}>
                            {l}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview && preview.length > 0 && (
                    <div className="mt-2 bg-gray-50 rounded p-2">
                      <p className="text-[11px] font-medium text-gray-700 mb-1">
                        Aperçu — {preview.length} commentaires générés (non postés)
                      </p>
                      <ul className="space-y-1.5">
                        {preview.map((p, i) => (
                          <li key={i} className="text-[11px] text-gray-700 border-l-2 border-gray-200 pl-2">
                            <span className="text-gray-400">{p.author || 'Auteur'} · {p.strategy}</span>
                            <br />
                            {p.comment}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {posts && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <p className="text-[11px] font-medium text-gray-700 mb-1">
                        {posts.length} posts dans l&apos;historique
                      </p>
                      <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                        {posts.map((p) => (
                          <div key={p.id} className="text-[11px] text-gray-700 flex flex-col gap-0.5 border-l-2 border-gray-200 pl-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{p.post_author || 'Auteur'}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                  p.status === 'posted'
                                    ? 'bg-green-100 text-green-700'
                                    : p.status === 'rejected'
                                      ? 'bg-red-100 text-red-700'
                                      : p.status === 'review'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {p.status === 'review' ? 'en file' : p.status}
                              </span>
                              {p.post_url && (
                                <a
                                  href={p.post_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  post
                                </a>
                              )}
                              {p.commented_at && (
                                <span className="text-gray-400">{formatDistanceToNow(p.commented_at)}</span>
                              )}
                            </div>
                            {p.comment && <span className="text-gray-600">{p.comment}</span>}
                            {p.error && <span className="text-red-500">{p.error}</span>}
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
