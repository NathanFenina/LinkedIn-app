'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { SignalKeyword, SignalPost, SignalPostStatus } from '@/types'
import { ExternalLink, Plus, Trash2, Sparkles, Search, Send, Eye, EyeOff, X } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

const STATUS_LABELS: Record<SignalPostStatus, string> = {
  new: 'Nouveau',
  qualified: 'Qualifié',
  commented: 'Commenté',
  dmed: 'DM envoyé',
  ignored: 'Ignoré',
}

const STATUS_COLORS: Record<SignalPostStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  qualified: 'bg-green-100 text-green-700',
  commented: 'bg-purple-100 text-purple-700',
  dmed: 'bg-orange-100 text-orange-700',
  ignored: 'bg-gray-100 text-gray-500',
}

export default function SignalsPage() {
  const [keywords, setKeywords] = useState<SignalKeyword[]>([])
  const [posts, setPosts] = useState<SignalPost[]>([])
  const [newKw, setNewKw] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState<'all' | 'qualified' | 'unqualified' | 'real'>('all')

  const fetchAll = useCallback(async () => {
    const [kw, ps] = await Promise.all([
      fetch('/api/signals/keywords').then((r) => r.json()),
      fetch('/api/signals/posts').then((r) => r.json()),
    ])
    if (Array.isArray(kw)) setKeywords(kw)
    if (Array.isArray(ps)) setPosts(ps)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const addKeyword = async () => {
    if (!newKw.trim()) return
    const res = await fetch('/api/signals/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: newKw.trim() }),
    })
    if (res.ok) {
      setNewKw('')
      fetchAll()
    }
  }

  const removeKeyword = async (id: string) => {
    if (!confirm('Supprimer ce mot-clé ?')) return
    await fetch(`/api/signals/keywords/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  const toggleKeyword = async (id: string, active: boolean) => {
    await fetch(`/api/signals/keywords/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    fetchAll()
  }

  const runSearch = async () => {
    if (keywords.filter((k) => k.active).length === 0) {
      alert('Active au moins un mot-clé')
      return
    }
    setBusy('search')
    setMsg('Recherche LinkedIn en cours…')
    try {
      const res = await fetch('/api/signals/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_posted: 'past_week' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const errSuffix = data.errors?.length ? ` ⚠️ ${data.errors.length} erreurs (voir console)` : ''
      if (data.errors?.length) console.error('Signals search errors:', data.errors, 'sample:', data.sample)
      setMsg(`${data.found}/${data.returned} stockés (sur ${data.keywords} mots-clés)${errSuffix}`)
      await fetchAll()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const qualifyAll = async () => {
    setBusy('qualify')
    setMsg('Qualification IA en cours…')
    try {
      const res = await fetch('/api/signals/qualify-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50 }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMsg(`${data.qualified} qualifiés · ${data.real_signals} vrais signaux`)
      await fetchAll()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const updatePost = async (id: string, body: Partial<SignalPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...body } : p)))
    await fetch(`/api/signals/posts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const removePost = async (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id))
    await fetch(`/api/signals/posts/${id}`, { method: 'DELETE' })
  }

  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      if (filter === 'qualified') return p.is_real_signal !== null
      if (filter === 'unqualified') return p.is_real_signal === null
      if (filter === 'real') return p.is_real_signal === true
      return true
    })
  }, [posts, filter])

  const realCount = posts.filter((p) => p.is_real_signal === true).length
  const unqualifiedCount = posts.filter((p) => p.is_real_signal === null).length

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3">
          <h1 className="font-semibold text-gray-900 text-base leading-tight">Signaux d&apos;intention</h1>
          <p className="text-xs text-gray-500">
            {posts.length} posts · {realCount} vrais signaux · {unqualifiedCount} à qualifier
          </p>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        {/* Keywords */}
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-gray-900">Mots-clés à surveiller</h2>
            <span className="text-[11px] text-gray-400">{keywords.filter((k) => k.active).length} actifs</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {keywords.map((k) => (
              <div
                key={k.id}
                className={`inline-flex items-center gap-1 text-xs rounded-full pl-2 pr-1 py-0.5 border ${
                  k.active ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'
                }`}
              >
                <span
                  onClick={() => toggleKeyword(k.id, k.active)}
                  className="cursor-pointer select-none"
                  title={k.active ? 'Désactiver' : 'Activer'}
                >
                  {k.keyword}
                </span>
                <button
                  onClick={() => removeKeyword(k.id)}
                  className="hover:text-red-600 p-0.5 rounded"
                  aria-label="Supprimer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Ex: cherche consultant SEO"
              value={newKw}
              onChange={(e) => setNewKw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs"
            />
            <button
              onClick={addKeyword}
              className="text-xs px-2.5 py-1 bg-gray-800 text-white rounded inline-flex items-center gap-1 hover:bg-gray-900"
            >
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          </div>
        </div>

        {/* Action toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runSearch}
            disabled={busy !== null}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Search className={`w-3.5 h-3.5 ${busy === 'search' ? 'animate-spin' : ''}`} />
            Rechercher maintenant
          </button>
          <button
            onClick={qualifyAll}
            disabled={busy !== null || unqualifiedCount === 0}
            className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <Sparkles className={`w-3.5 h-3.5 ${busy === 'qualify' ? 'animate-pulse' : ''}`} />
            Qualifier IA ({unqualifiedCount})
          </button>
          <div className="flex gap-1 ml-2">
            {(['all', 'real', 'unqualified', 'qualified'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[11px] px-2 py-1 rounded-full border ${
                  filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {f === 'all' && `Tous (${posts.length})`}
                {f === 'real' && `🎯 Vrais signaux (${realCount})`}
                {f === 'unqualified' && `À qualifier (${unqualifiedCount})`}
                {f === 'qualified' && `Qualifiés (${posts.length - unqualifiedCount})`}
              </button>
            ))}
          </div>
          {msg && <span className="text-xs text-gray-500 ml-auto">{msg}</span>}
        </div>

        {/* Posts list */}
        <div className="space-y-2">
          {filteredPosts.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
              Aucun post. Ajoute des mots-clés et lance une recherche.
            </div>
          ) : (
            filteredPosts.map((p) => (
              <div
                key={p.id}
                className={`bg-white border rounded-lg p-3 ${
                  p.is_real_signal === true ? 'border-green-300' : p.is_real_signal === false ? 'border-gray-200 opacity-60' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900">{p.author_name || 'Anonyme'}</span>
                      {p.author_profile_url && (
                        <a
                          href={p.author_profile_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          Profil <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                      {p.matched_keyword && (
                        <span className="text-[10px] text-gray-500 italic">via &quot;{p.matched_keyword}&quot;</span>
                      )}
                      {p.posted_at && (
                        <span className="text-[10px] text-gray-400">{formatDistanceToNow(p.posted_at)}</span>
                      )}
                    </div>
                    {p.author_headline && (
                      <p className="text-xs text-gray-500 mt-0.5">{p.author_headline}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {p.post_url && (
                      <a
                        href={p.post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Post
                      </a>
                    )}
                    <button
                      onClick={() => updatePost(p.id, { status: 'commented' })}
                      className="text-[11px] px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 inline-flex items-center gap-1"
                      title="Marquer commenté"
                    >
                      <Send className="w-3 h-3" /> Commenté
                    </button>
                    <button
                      onClick={() => updatePost(p.id, { status: 'dmed' })}
                      className="text-[11px] px-2 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 inline-flex items-center gap-1"
                      title="Marquer DM envoyé"
                    >
                      <Send className="w-3 h-3" /> DM
                    </button>
                    {p.is_real_signal !== false && (
                      <button
                        onClick={() => updatePost(p.id, { status: 'ignored', is_real_signal: false })}
                        className="text-[11px] px-1.5 py-1 text-gray-500 hover:text-gray-800"
                        title="Ignorer"
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    )}
                    {p.is_real_signal === false && (
                      <button
                        onClick={() => updatePost(p.id, { status: 'qualified', is_real_signal: true })}
                        className="text-[11px] px-1.5 py-1 text-gray-500 hover:text-green-700"
                        title="Réhabiliter"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => removePost(p.id)}
                      className="text-[11px] px-1.5 py-1 text-gray-400 hover:text-red-600"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-4">{p.content}</p>
                {p.qualification_reason && (
                  <p
                    className={`text-[11px] mt-1.5 italic ${
                      p.is_real_signal ? 'text-green-700' : 'text-gray-400'
                    }`}
                  >
                    ✨ {p.qualification_reason}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
