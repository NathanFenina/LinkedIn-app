'use client'

import { useEffect, useState, useCallback } from 'react'
import { CommentCampaign, CommentSend } from '@/types'
import { Plus, Play, Trash2, Sparkles, Power, Users, MessageCircle, ExternalLink, X, Pencil, CheckCircle2, Zap, FileText, AlertCircle, Loader2, Radio } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

function startOfTodayISO() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export default function CommentsPage() {
  const [campaigns, setCampaigns] = useState<CommentCampaign[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [draftsByCampaign, setDraftsByCampaign] = useState<Record<string, CommentSend[]>>({})
  const [sentByCampaign, setSentByCampaign] = useState<Record<string, CommentSend[]>>({})
  const [showForm, setShowForm] = useState(false)

  // create form
  const [name, setName] = useState('')
  const [membersInput, setMembersInput] = useState('')
  const [dailyCap, setDailyCap] = useState('20')
  const [minDelay, setMinDelay] = useState('180')
  const [maxDelay, setMaxDelay] = useState('240')
  const [alsoLike, setAlsoLike] = useState(true)
  const [allowSelfPromo, setAllowSelfPromo] = useState(false)
  const [autoGenerate, setAutoGenerate] = useState(false)
  const [instructions, setInstructions] = useState('')

  // edit members list
  const [editMembersId, setEditMembersId] = useState<string | null>(null)
  const [editMembersText, setEditMembersText] = useState('')

  const fetchCampaigns = useCallback(async () => {
    const data = await fetch('/api/comment-campaigns').then((r) => r.json())
    if (Array.isArray(data)) setCampaigns(data)
  }, [])

  const loadDrafts = useCallback(async (id: string) => {
    const data = await fetch(`/api/comment-campaigns/${id}`).then((r) => r.json())
    const sends: CommentSend[] = data.sends || []
    setDraftsByCampaign((prev) => ({ ...prev, [id]: sends.filter((s) => s.status === 'draft') }))
    setSentByCampaign((prev) => ({ ...prev, [id]: sends.filter((s) => s.status === 'sent') }))
  }, [])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  useEffect(() => {
    campaigns.forEach((c) => loadDrafts(c.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns.length])

  // Auto-refresh: la session GitHub poste en arrière-plan → on rafraîchit le
  // suivi (brouillons + postés) toutes les 20s tant que la page est ouverte.
  useEffect(() => {
    const t = setInterval(() => {
      campaigns.forEach((c) => loadDrafts(c.id))
    }, 20000)
    return () => clearInterval(t)
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
        auto_generate: autoGenerate,
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
      const data = await res.json().catch(() => ({}))
      const e = data.error
      setMsg(`Erreur: ${typeof e === 'string' ? e : JSON.stringify(e) || res.statusText}`)
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

  const saveMembers = async (id: string) => {
    const ids = Array.from(new Set(editMembersText.match(/ACoAA[A-Za-z0-9_-]+/g) || []))
    const urls = Array.from(new Set(
      (editMembersText.match(/https?:\/\/(?:[\w.-]*\.)?linkedin\.com\/(?:posts|feed\/update)\/[^\s"'<>]+/gi) || [])
        .map((u) => u.replace(/[).,]+$/, ''))
    ))
    if (ids.length === 0 && urls.length === 0) {
      setMsg('Rien de détecté (attendu : URL de recherche, ids ACoAA… ou URLs de posts).')
      return
    }
    await update(id, { member_ids: ids, post_urls: urls })
    setEditMembersId(null)
    setEditMembersText('')
    setMsg(`Feed mis à jour : ${ids.length} membre(s) + ${urls.length} post(s) précis.`)
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

  const isError = msg.toLowerCase().startsWith('erreur')
  const inputCls =
    'mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition'

  return (
    <>
      <header className="bg-white/90 backdrop-blur border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 text-base leading-tight">Commentaires auto</h1>
              <p className="text-xs text-gray-500">
                Génère → revois / édite → l&apos;app poste, espacé dans le temps.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition"
          >
            <Plus className="w-4 h-4" /> Nouvelle campagne
          </button>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-4">
        {msg && (
          <div
            className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 border ${
              isError
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {isError ? <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />}
            <span className="flex-1 leading-relaxed">{msg}</span>
            <button onClick={() => setMsg('')} className="opacity-50 hover:opacity-100 shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {showForm && (
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 shadow-sm">
            <h2 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-blue-600" /> Nouvelle campagne
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600 md:col-span-2">
                Nom
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Réseau SEO/IA" className={inputCls} />
              </label>
              <label className="text-xs font-medium text-gray-600 md:col-span-2">
                Le feed — colle en vrac : URL(s) de recherche (fromMember), ids ACoAA…, ET/OU des URLs de posts précis.
                <textarea value={membersInput} onChange={(e) => setMembersInput(e.target.value)} rows={4}
                  placeholder={'https://www.linkedin.com/search/results/content/?...&fromMember=["ACoAA..."]\nhttps://www.linkedin.com/posts/...'}
                  className={`${inputCls} font-mono text-xs`} />
                <span className="inline-flex gap-2 mt-1">
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">{memberPreviewCount} membres</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-medium">
                    {(membersInput.match(/https?:\/\/(?:[\w.-]*\.)?linkedin\.com\/(?:posts|feed\/update)\/[^\s"'<>]+/gi) || []).length} posts
                  </span>
                </span>
              </label>
              <label className="text-xs font-medium text-gray-600">
                Plafond / jour
                <input type="number" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-medium text-gray-600">
                  Délai min (s)
                  <input type="number" value={minDelay} onChange={(e) => setMinDelay(e.target.value)} className={inputCls} />
                </label>
                <label className="text-xs font-medium text-gray-600">
                  Délai max (s)
                  <input type="number" value={maxDelay} onChange={(e) => setMaxDelay(e.target.value)} className={inputCls} />
                </label>
              </div>
              <label className="text-xs font-medium text-gray-600 md:col-span-2">
                Consignes IA (optionnel)
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2}
                  placeholder="Ex: reste factuel, tutoiement, pas de superlatifs." className={inputCls} />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-2 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={alsoLike} onChange={(e) => setAlsoLike(e.target.checked)} />
                Liker le post aussi
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-2 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={allowSelfPromo} onChange={(e) => setAllowSelfPromo(e.target.checked)} />
                Autoriser ~20% d&apos;auto-promo Decupler
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-700 md:col-span-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 cursor-pointer">
                <input type="checkbox" checked={autoGenerate} onChange={(e) => setAutoGenerate(e.target.checked)} />
                <span><b>Full auto</b> — la session du matin génère ET poste sans revue. Décoché = tu prépares/valides les brouillons toi-même.</span>
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={create} className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition">Créer la campagne</button>
              <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Annuler</button>
            </div>
          </section>
        )}

        {campaigns.length === 0 && !showForm && (
          <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-white">
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <MessageCircle className="w-6 h-6 text-blue-500" />
            </div>
            <p className="text-sm text-gray-600 font-medium">Aucune campagne pour l&apos;instant</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">Crée-en une et colle ton feed de membres LinkedIn.</p>
            <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Nouvelle campagne
            </button>
          </div>
        )}

        {campaigns.map((c) => {
          const drafts = draftsByCampaign[c.id] || []
          const sent = sentByCampaign[c.id] || []
          const sentCount = sent.length
          const todayStart = startOfTodayISO()
          const sentToday = sent.filter((s) => new Date(s.created_at).getTime() >= todayStart).length
          const capPct = Math.min(100, Math.round((sentToday / Math.max(1, c.daily_cap)) * 100))
          const busy = busyId === c.id
          return (
            <section key={c.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 p-5 pb-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                    <MessageCircle className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold text-gray-900 text-sm">{c.name}</h2>
                      {c.auto_generate ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                          <Zap className="w-2.5 h-2.5" /> Full auto
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Revue manuelle</span>
                      )}
                      {drafts.length > 0 && c.active && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                          <Radio className="w-2.5 h-2.5 animate-pulse" /> en file
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => { setEditMembersId(editMembersId === c.id ? null : c.id); setEditMembersText('') }}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-600 transition"
                      title="Modifier le feed"
                    >
                      <Users className="w-3 h-3" /> {c.member_ids?.length || 0} membres
                      {(c.post_urls?.length || 0) > 0 && <> + {c.post_urls.length} posts</>}
                      <Pencil className="w-2.5 h-2.5 ml-0.5" />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => update(c.id, { active: !c.active })}
                  className={`text-[11px] px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1 shrink-0 transition ${c.active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  title="Activer / désactiver la session auto"
                >
                  <Power className="w-3 h-3" /> {c.active ? 'Actif' : 'En pause'}
                </button>
              </div>

              {/* Stat tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-100 border-y border-gray-100">
                <div className="bg-white px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Posté aujourd&apos;hui</div>
                  <div className="text-lg font-semibold text-gray-900 leading-tight">{sentToday}<span className="text-xs text-gray-400 font-normal"> / {c.daily_cap}</span></div>
                  <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${capPct}%` }} />
                  </div>
                </div>
                <div className="bg-white px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Brouillons</div>
                  <div className="text-lg font-semibold text-amber-600 leading-tight">{drafts.length}</div>
                  <div className="text-[10px] text-gray-400">en attente</div>
                </div>
                <div className="bg-white px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Postés (total)</div>
                  <div className="text-lg font-semibold text-green-600 leading-tight">{sentCount}</div>
                  <div className="text-[10px] text-gray-400">{c.last_run_at ? `dernier ${formatDistanceToNow(c.last_run_at)}` : '—'}</div>
                </div>
                <div className="bg-white px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Cadence</div>
                  <div className="text-sm font-semibold text-gray-900 leading-tight mt-0.5">{c.min_delay_sec}-{c.max_delay_sec}s</div>
                  <div className="text-[10px] text-gray-400">{c.also_like ? 'entre 2, + like' : 'entre 2 posts'}</div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 p-5 pt-4">
                <button disabled={busy} onClick={() => generate(c.id)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-sm transition">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Générer les brouillons
                </button>
                <button disabled={busy || drafts.length === 0} onClick={() => postOne(c.id)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition">
                  <Play className="w-3.5 h-3.5" /> Poster 1 maintenant
                </button>
                <button onClick={() => update(c.id, { auto_generate: !c.auto_generate })}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                  <Zap className="w-3.5 h-3.5" /> {c.auto_generate ? 'Passer en revue manuelle' : 'Passer en full auto'}
                </button>
                <button onClick={() => remove(c.id)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 ml-auto transition">
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer
                </button>
              </div>

              {editMembersId === c.id && (
                <div className="px-5 pb-5">
                  <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                    <div className="text-[11px] text-gray-600 mb-1.5">
                      Colle en vrac : URL(s) de recherche LinkedIn, ids ACoAA…, ET/OU des URLs de posts précis.
                      L&apos;app détecte membres + posts automatiquement. Ça <b>remplace</b> le feed actuel.
                    </div>
                    <textarea
                      value={editMembersText}
                      onChange={(e) => setEditMembersText(e.target.value)}
                      rows={3}
                      placeholder='https://www.linkedin.com/search/results/content/?...&fromMember=["ACoAA...","ACoAA..."]'
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:border-blue-400 focus:outline-none"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="inline-flex gap-2">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{(editMembersText.match(/ACoAA[A-Za-z0-9_-]+/g) || []).length} membres</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">{(editMembersText.match(/https?:\/\/(?:[\w.-]*\.)?linkedin\.com\/(?:posts|feed\/update)\/[^\s"'<>]+/gi) || []).length} posts</span>
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => setEditMembersId(null)} className="text-xs px-2.5 py-1 border border-gray-300 rounded-lg hover:bg-white transition">Annuler</button>
                        <button onClick={() => saveMembers(c.id)} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">Enregistrer</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {drafts.length > 0 && (
                <div className="px-5 pb-5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">
                    <FileText className="w-3 h-3" /> Brouillons — édite ou passe. Rien n&apos;est posté tant que tu ne cliques pas.
                  </div>
                  {drafts.map((d) => (
                    <DraftRow key={d.id} draft={d}
                      onSave={(text) => saveDraft(c.id, d.id, text)}
                      onSkip={() => skipDraft(c.id, d.id)} />
                  ))}
                </div>
              )}

              {sent.length > 0 && (
                <div className="px-5 pb-5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-green-600">
                    <CheckCircle2 className="w-3 h-3" /> Postés ({sent.length}) — suivi en direct
                  </div>
                  {sent.map((s) => (
                    <div key={s.id} className="border border-green-100 bg-green-50/40 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-700 truncate">{s.author_name}</span>
                        <span className="text-[10px] text-gray-400 flex items-center gap-2 shrink-0">
                          {formatDistanceToNow(s.created_at)}
                          {s.liked && <span className="inline-flex items-center gap-0.5 text-blue-500">♥ like</span>}
                          {s.post_url && (
                            <a href={s.post_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 inline-flex items-center gap-0.5 hover:underline">
                              post <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </span>
                      </div>
                      <p className="text-[13px] text-gray-800 mt-1 leading-relaxed">{s.comment_text}</p>
                    </div>
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
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/70 hover:border-gray-300 transition">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700 truncate">{draft.author_name}</span>
        <div className="flex items-center gap-3 shrink-0">
          {draft.post_url && (
            <a href={draft.post_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 inline-flex items-center gap-1 hover:underline">
              voir le post <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          <button onClick={onSkip} className="text-[11px] text-gray-400 hover:text-red-600 inline-flex items-center gap-0.5 transition" title="Ne pas poster celui-ci">
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
        className="mt-2 w-full text-sm text-gray-900 bg-white border border-gray-200 rounded-lg p-2.5 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition"
      />
      <div className="flex items-center gap-1 text-[10px] mt-1 h-3">
        {saved ? (
          <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3 h-3" /> enregistré</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-600"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> modifié — clique ailleurs pour enregistrer</span>
        )}
      </div>
    </div>
  )
}
