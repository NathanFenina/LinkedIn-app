'use client'

import { useCallback, useEffect, useState } from 'react'
import { Phone, RefreshCw, ExternalLink, Trash2, UserPlus2, CheckCircle2, XCircle, PlayCircle, Plus } from 'lucide-react'

interface Lead {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  metier: string | null
  zone: string | null
  post_text: string | null
  post_url: string | null
  group_title: string | null
  posted_at: string | null
  status: string
}
interface Group { id: string; url: string; title: string | null; active: boolean; last_scraped_at: string | null }
interface Data { leads: Lead[]; groups: Group[]; counts: { to_call: number; with_phone: number; called: number } }

export default function FacebookLeadsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [status, setStatus] = useState('to_call')
  const [onlyPhone, setOnlyPhone] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [showGroups, setShowGroups] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ status, ...(onlyPhone ? { phone: '1' } : {}) })
      const d = await fetch(`/api/facebook-leads?${p}`).then((r) => r.json())
      if (d.error) setErr(String(d.error)); else { setData(d); setErr('') }
    } catch (e) { setErr(String(e)) } finally { setLoading(false) }
  }, [status, onlyPhone])
  useEffect(() => { load() }, [load])

  const runScrape = async () => {
    setRunning(true); setMsg(''); setErr('')
    try {
      const d = await fetch('/api/facebook-leads/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ per_group: 20 }) }).then((r) => r.json())
      if (d.error) setErr(String(d.error))
      else {
        setMsg(`Scrape terminé : ${d.groups} groupes, ${d.scanned} posts analysés → ${d.artisans} artisans détectés, ${d.inserted} nouveaux (dont ${d.withPhone} avec numéro).${d.errors?.length ? ' ⚠️ ' + d.errors.length + ' groupe(s) en erreur.' : ''}`)
        load()
      }
    } catch (e) { setErr(String(e)) } finally { setRunning(false) }
  }

  const act = async (id: string, op: string) => {
    setBusy(id + op)
    try {
      const d = await fetch('/api/facebook-leads/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id }) }).then((r) => r.json())
      if (d.error) { setErr(d.error); return }
      setData((prev) => prev ? { ...prev, leads: prev.leads.filter((l) => l.id !== id) } : prev)
    } finally { setBusy(null) }
  }

  const groupOp = async (op: string, payload: Record<string, unknown>) => {
    const d = await fetch('/api/facebook-leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...payload }) }).then((r) => r.json())
    if (d.error) setErr(d.error); else { setErr(''); if (op === 'add_group') setNewGroup(''); load() }
  }

  const c = data?.counts

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Artisans à appeler</h1>
            <p className="text-xs text-gray-500">Artisans du BTP repérés dans tes groupes Facebook — à appeler pour leur vendre un site + du SEO.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => load()} disabled={loading} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
            </button>
            <button onClick={runScrape} disabled={running} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-flex items-center gap-1.5 disabled:opacity-50">
              <PlayCircle className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} /> {running ? 'Scrape en cours…' : 'Scraper maintenant'}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-5 space-y-4">
        {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">Erreur : {err}</div>}
        {msg && <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</div>}

        {/* Compteurs */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">À appeler</div>
            <div className="text-2xl font-semibold text-gray-900">{c?.to_call ?? '—'}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Avec numéro</div>
            <div className="text-2xl font-semibold text-green-700">{c?.with_phone ?? '—'}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Appelés</div>
            <div className="text-2xl font-semibold text-gray-900">{c?.called ?? '—'}</div>
          </div>
        </div>

        {/* Groupes sources */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <button onClick={() => setShowGroups((s) => !s)} className="w-full text-left px-3 py-2 text-sm font-medium text-gray-900 flex items-center justify-between">
            <span>Groupes Facebook surveillés ({data?.groups.length ?? 0})</span>
            <span className="text-xs text-gray-400">{showGroups ? 'masquer' : 'gérer'}</span>
          </button>
          {showGroups && (
            <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-2">
              <div className="flex gap-2">
                <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="https://www.facebook.com/groups/…" className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5" />
                <button onClick={() => newGroup && groupOp('add_group', { url: newGroup })} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded hover:bg-gray-50 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter</button>
              </div>
              {data?.groups.map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={g.active} onChange={() => groupOp('toggle_group', { id: g.id, active: !g.active })} />
                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-gray-600 hover:underline">{g.title || g.url}</a>
                  {g.last_scraped_at && <span className="text-[10px] text-gray-400">scrapé {new Date(g.last_scraped_at).toLocaleDateString('fr-FR')}</span>}
                  <button onClick={() => groupOp('delete_group', { id: g.id })} className="text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filtres */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {[['to_call', 'À appeler'], ['called', 'Appelés'], ['client', 'Clients'], ['not_interested', 'Pas intéressés'], ['all', 'Tous']].map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)} className={`px-2.5 py-1 rounded-full border ${status === v ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{l}</button>
          ))}
          <label className="ml-2 inline-flex items-center gap-1.5 text-gray-600"><input type="checkbox" checked={onlyPhone} onChange={(e) => setOnlyPhone(e.target.checked)} /> avec numéro uniquement</label>
        </div>

        {/* Liste */}
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {!data || data.leads.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">Aucun artisan ici. Clique « Scraper maintenant » pour aller chercher les leads du jour.</div>
          ) : data.leads.map((l) => (
            <div key={l.id} className="px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900">{l.name || 'Artisan'}</span>
                {l.metier && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">{l.metier}</span>}
                {l.zone && <span className="text-[11px] text-gray-500">· {l.zone}</span>}
                {l.group_title && <span className="text-[10px] text-gray-400 truncate max-w-[220px]">· {l.group_title}</span>}
                <span className="flex-1" />
                {l.phone ? (
                  <a href={`tel:${l.phone}`} className="text-sm font-semibold text-green-700 inline-flex items-center gap-1 hover:underline"><Phone className="w-3.5 h-3.5" /> {l.phone}</a>
                ) : (
                  <span className="text-[11px] text-gray-400">pas de num dans le post</span>
                )}
              </div>
              {l.post_text && <p className="text-[12px] text-gray-500 mt-1 line-clamp-2">{l.post_text.slice(0, 180)}</p>}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {l.post_url && <a href={l.post_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5">voir le post / profil <ExternalLink className="w-2.5 h-2.5" /></a>}
                <span className="flex-1" />
                {l.status !== 'called' && <button onClick={() => act(l.id, 'called')} disabled={busy === l.id + 'called'} className="text-[11px] px-2 py-1 border border-green-200 text-green-700 rounded hover:bg-green-50 inline-flex items-center gap-1 disabled:opacity-50"><CheckCircle2 className="w-3 h-3" /> Appelé</button>}
                <button onClick={() => act(l.id, 'not_interested')} disabled={busy === l.id + 'not_interested'} className="text-[11px] px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50"><XCircle className="w-3 h-3" /> Pas intéressé</button>
                <button onClick={() => act(l.id, 'crm')} disabled={busy === l.id + 'crm'} className="text-[11px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50"><UserPlus2 className="w-3 h-3" /> CRM</button>
                <button onClick={() => act(l.id, 'delete')} disabled={busy === l.id + 'delete'} className="text-gray-300 hover:text-red-500 px-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">Le scrape tourne aussi automatiquement chaque matin. Le numéro n&apos;est dans le post qu&apos;environ 1 fois sur 3 — sinon, clique « voir le post / profil » pour le récupérer.</p>
      </div>
    </>
  )
}
