'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Camera, ThumbsUp, ExternalLink, Sparkles, Copy, Check, X, Settings2 } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface Post {
  id: string
  linkedin_post_id: string
  share_url: string | null
  source_text: string
  source_images: string[]
  posted_at: string | null
  variants: { instagram?: string; facebook?: string }
  generated_at: string | null
  generation_note: string | null
  ig_status: string
  ig_post_id: string | null
  ig_error: string | null
  fb_status: string
}
interface UAccount { id: string; type: string; name?: string }
interface Data { posts: Post[]; settings: { instagram_account_id: string; linkedin_account_id: string; claude: boolean }; accounts: UAccount[] }

export default function CrossPostPage() {
  const [data, setData] = useState<Data | null>(null)
  const [view, setView] = useState<'pending' | 'done'>('pending')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState<Record<string, { instagram: string; facebook: string }>>({})
  const [showSettings, setShowSettings] = useState(false)

  const load = useCallback(async (v = view) => {
    setLoading(true)
    try {
      const d = await fetch(`/api/cross-post?view=${v}`).then((r) => r.json())
      if (d.error) { setErr(d.error); return }
      setData(d); setErr('')
      const e: Record<string, { instagram: string; facebook: string }> = {}
      for (const p of d.posts as Post[]) e[p.id] = { instagram: p.variants?.instagram ?? p.source_text, facebook: p.variants?.facebook ?? p.source_text }
      setEdit(e)
    } catch (e) { setErr(String(e)) } finally { setLoading(false) }
  }, [view])
  useEffect(() => { load(view) }, [load, view])

  const post = async (payload: Record<string, unknown>) => {
    const d = await fetch('/api/cross-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((r) => r.json())
    if (d.error) throw new Error(d.error)
    return d
  }

  const detect = async () => {
    setBusy('detect'); setMsg(''); setErr('')
    try {
      const d = await post({ op: 'detect' })
      if (d.error) setErr(d.error)
      else setMsg(`Détection : ${d.scanned} posts lus, ${d.added} nouveau(x).`)
      await load()
    } catch (e) { setErr(String(e)) } finally { setBusy(null) }
  }
  const saveSettings = async (patch: Record<string, string>) => {
    setBusy('settings')
    try { await post({ op: 'settings', ...patch }); await load(); setMsg('Réglages enregistrés.') } catch (e) { setErr(String(e)) } finally { setBusy(null) }
  }
  const regenerate = async (p: Post) => {
    setBusy(p.id + 'gen'); setErr('')
    try {
      const d = await post({ op: 'regenerate', id: p.id })
      setEdit((e) => ({ ...e, [p.id]: { instagram: d.variants.instagram, facebook: d.variants.facebook } }))
      if (d.note) setMsg(d.note)
    } catch (e) { setErr(String(e)) } finally { setBusy(null) }
  }
  const saveText = async (p: Post, platform: 'instagram' | 'facebook') => {
    try { await post({ op: 'update', id: p.id, platform, text: edit[p.id]?.[platform] || '' }) } catch { /* silencieux */ }
  }
  const publishIG = async (p: Post) => {
    const text = (edit[p.id]?.instagram || '').trim()
    if (!text) { setErr('Texte Instagram vide'); return }
    if (!confirm(`Publier sur Instagram maintenant ?\n\n${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`)) return
    setBusy(p.id + 'ig'); setErr(''); setMsg('')
    try {
      const d = await post({ op: 'publish', id: p.id, platform: 'instagram', text })
      setMsg(`Publié sur Instagram ✓${d.post_id ? ' (' + d.post_id + ')' : ''}`)
      await load()
    } catch (e) { setErr(String(e)); await load() } finally { setBusy(null) }
  }
  const copyFB = async (p: Post) => {
    const text = (edit[p.id]?.facebook || '').trim()
    try { await navigator.clipboard.writeText(text) } catch { setErr('Copie impossible : sélectionne le texte à la main'); return }
    setBusy(p.id + 'fb')
    try {
      await post({ op: 'update', id: p.id, platform: 'facebook', text })
      await post({ op: 'mark', id: p.id, platform: 'facebook', status: 'done' })
      setMsg('Texte copié — colle-le manuellement sur Facebook pour l’instant (API native en v2).')
      await load()
    } catch (e) { setErr(String(e)) } finally { setBusy(null) }
  }
  const mark = async (p: Post, platform: 'instagram' | 'facebook', status: 'skipped' | 'pending') => {
    setBusy(p.id + platform + status)
    try { await post({ op: 'mark', id: p.id, platform, status }); await load() } catch (e) { setErr(String(e)) } finally { setBusy(null) }
  }

  const s = data?.settings
  const igAccounts = (data?.accounts || []).filter((a) => /instagram/i.test(a.type))
  const otherAccounts = (data?.accounts || []).filter((a) => !/instagram/i.test(a.type))
  const igName = (data?.accounts || []).find((a) => a.id === s?.instagram_account_id)?.name

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Cross-post</h1>
            <p className="text-xs text-gray-500">Tes posts LinkedIn, republiés sur Instagram et Facebook — après ta validation, jamais tout seuls.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSettings((v) => !v)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5" /> Réglages</button>
            <button onClick={() => load()} disabled={loading} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir</button>
            <button onClick={detect} disabled={busy === 'detect'} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-flex items-center gap-1.5 disabled:opacity-50">{busy === 'detect' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : '🔎'} Détecter maintenant</button>
          </div>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-5 space-y-4">
        {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">Erreur : {err}</div>}
        {msg && <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</div>}

        {s && !s.instagram_account_id && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">Aucun compte Instagram choisi : ouvre « Réglages » et sélectionne-le pour pouvoir publier.</div>
        )}
        {s && !s.claude && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">Clé ANTHROPIC_API_KEY absente sur Vercel : les variantes sont le texte d’origine tel quel (tu peux les éditer). Ajoute la clé pour l’adaptation automatique.</div>
        )}

        {showSettings && s && (
          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-3 text-sm">
            <div>
              <label className="text-xs font-medium text-gray-600">Compte Instagram (Unipile) — cible des publications</label>
              <select value={s.instagram_account_id} onChange={(e) => saveSettings({ instagram_account_id: e.target.value })} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                <option value="">— choisir —</option>
                {igAccounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id} ({a.type})</option>)}
                {igAccounts.length === 0 && otherAccounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id} ({a.type})</option>)}
              </select>
              {igAccounts.length === 0 && <p className="text-[11px] text-gray-400 mt-1">Aucun compte de type Instagram trouvé dans Unipile — tous les comptes sont listés. Connecte Instagram dans le dashboard Unipile si besoin.</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Compte LinkedIn source — dont on surveille les posts</label>
              <select value={s.linkedin_account_id} onChange={(e) => saveSettings({ linkedin_account_id: e.target.value })} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                {(data?.accounts || []).filter((a) => /linkedin/i.test(a.type)).map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
              </select>
            </div>
            <p className="text-[11px] text-gray-400">Détection automatique toutes les 15 min (cron). Les posts publiés avant l’activation sont mémorisés mais pas proposés. Les reposts sont ignorés.</p>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs">
          {([['pending', 'À valider'], ['done', 'Traités']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-full border ${view === v ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{l}</button>
          ))}
          {igName && <span className="ml-auto text-gray-400">Instagram : {igName}</span>}
        </div>

        <div className="space-y-4">
          {!data || data.posts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg text-center py-10 text-gray-400 text-sm">
              {view === 'pending' ? 'Aucun post à valider. Publie sur LinkedIn : il apparaît ici dans les 15 min (ou clique « Détecter maintenant »).' : 'Rien de traité pour l’instant.'}
            </div>
          ) : data.posts.map((p) => {
            const e = edit[p.id] || { instagram: '', facebook: '' }
            const hasImg = (p.source_images || []).length > 0
            return (
              <div key={p.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {/* Source */}
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                  <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                    <span className="font-semibold text-gray-700">Post LinkedIn</span>
                    {p.posted_at && <span>· {formatDistanceToNow(p.posted_at)}</span>}
                    {p.share_url && <a href={p.share_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">ouvrir <ExternalLink className="w-2.5 h-2.5" /></a>}
                    <span className="flex-1" />
                    <button onClick={() => regenerate(p)} disabled={busy === p.id + 'gen'} className="px-2 py-1 border border-gray-200 rounded hover:bg-white inline-flex items-center gap-1 disabled:opacity-50" title="Régénère les variantes avec Claude (touche légère)">
                      {busy === p.id + 'gen' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Régénérer
                    </button>
                  </div>
                  <p className="text-[13px] text-gray-800 whitespace-pre-wrap mt-2 max-h-48 overflow-y-auto">{p.source_text}</p>
                  {hasImg && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {p.source_images.map((u, i) => <img key={i} src={u} alt="" className="h-20 w-20 object-cover rounded border border-gray-200" />)}
                    </div>
                  )}
                  {p.generation_note && <p className="text-[11px] text-amber-700 mt-1">{p.generation_note}</p>}
                </div>

                {/* Variantes */}
                <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900"><Camera className="w-4 h-4 text-pink-600" /> Instagram
                      <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${p.ig_status === 'published' ? 'bg-green-100 text-green-700' : p.ig_status === 'skipped' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{p.ig_status === 'published' ? 'publié' : p.ig_status === 'skipped' ? 'ignoré' : 'à valider'}</span>
                    </div>
                    <textarea value={e.instagram} onChange={(ev) => setEdit((x) => ({ ...x, [p.id]: { ...x[p.id], instagram: ev.target.value } }))} onBlur={() => saveText(p, 'instagram')} rows={8} maxLength={2200} disabled={p.ig_status === 'published'} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] disabled:bg-gray-50" />
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      <span className="text-gray-400">{e.instagram.length}/2200{!hasImg && ' · pas d’image : Instagram exige une image'}</span>
                      <span className="flex-1" />
                      {p.ig_status === 'pending' ? (
                        <>
                          <button onClick={() => publishIG(p)} disabled={busy === p.id + 'ig' || !hasImg || !s?.instagram_account_id} title={!hasImg ? 'Ce post n’a pas d’image' : !s?.instagram_account_id ? 'Choisis le compte Instagram dans Réglages' : ''} className="px-2.5 py-1 bg-pink-600 text-white rounded hover:bg-pink-700 disabled:opacity-40 inline-flex items-center gap-1">
                            {busy === p.id + 'ig' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />} Publier sur Instagram
                          </button>
                          <button onClick={() => mark(p, 'instagram', 'skipped')} className="px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50 inline-flex items-center gap-1"><X className="w-3 h-3" /> Ignorer</button>
                        </>
                      ) : p.ig_status === 'skipped' ? (
                        <button onClick={() => mark(p, 'instagram', 'pending')} className="px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50">Remettre à valider</button>
                      ) : <span className="text-green-700 inline-flex items-center gap-1"><Check className="w-3 h-3" /> publié{p.ig_post_id ? ` · ${p.ig_post_id}` : ''}</span>}
                    </div>
                    {p.ig_error && <p className="text-[11px] text-red-600">{p.ig_error}</p>}
                  </div>

                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900"><ThumbsUp className="w-4 h-4 text-blue-700" /> Facebook
                      <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${p.fb_status === 'copied' ? 'bg-green-100 text-green-700' : p.fb_status === 'skipped' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{p.fb_status === 'copied' ? 'copié' : p.fb_status === 'skipped' ? 'ignoré' : 'à valider'}</span>
                    </div>
                    <textarea value={e.facebook} onChange={(ev) => setEdit((x) => ({ ...x, [p.id]: { ...x[p.id], facebook: ev.target.value } }))} onBlur={() => saveText(p, 'facebook')} rows={8} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px]" />
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      <span className="text-gray-400">v1 : copier-coller manuel (API Meta en v2)</span>
                      <span className="flex-1" />
                      {p.fb_status === 'pending' ? (
                        <>
                          <button onClick={() => copyFB(p)} disabled={busy === p.id + 'fb'} className="px-2.5 py-1 bg-blue-700 text-white rounded hover:bg-blue-800 disabled:opacity-50 inline-flex items-center gap-1"><Copy className="w-3 h-3" /> Copier pour Facebook</button>
                          <button onClick={() => mark(p, 'facebook', 'skipped')} className="px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50 inline-flex items-center gap-1"><X className="w-3 h-3" /> Ignorer</button>
                        </>
                      ) : (
                        <button onClick={() => mark(p, 'facebook', 'pending')} className="px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50">Remettre à valider</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
