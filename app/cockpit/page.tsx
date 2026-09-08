'use client'

import { useEffect, useState, useCallback } from 'react'
import { Flame, RefreshCw, ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface HotItem { source: 'outreach' | 'lead-magnet'; name: string | null; campaign: string | null; link: string | null; when: string | null }
interface Stats { dm: number; comment: number; invite: number; accept: number; profile_view: number; replies: number }
interface Data {
  hot: { count: number; items: HotItem[] }
  stats: { week: Stats; prev: Stats }
  campaigns: {
    comments: { name: string; active: boolean; auto: boolean; drafts: number; posted_total: number; posted_24h: number }[]
    outreach: { name: string; active: boolean; en_file: number; en_sequence: number; replied: number; done: number }[]
    leadmagnets: { name: string; active: boolean; auto: boolean; sent: number; replied: number }[]
    autoAccept: { enabled: boolean; accepted_7j: number }
  }
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const d = now - prev
  if (d === 0) return <span className="text-gray-400 inline-flex items-center gap-0.5 text-[11px]"><Minus className="w-3 h-3" />0</span>
  const up = d > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{up ? '+' : ''}{d}
    </span>
  )
}

function Tile({ label, week, prev }: { label: string; week: number; prev: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</div>
      <div className="flex items-end gap-2 mt-1">
        <div className="text-2xl font-semibold text-gray-900">{week}</div>
        <div className="mb-1"><Delta now={week} prev={prev} /></div>
      </div>
      <div className="text-[10px] text-gray-400">7 derniers jours</div>
    </div>
  )
}

export default function CockpitPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetch('/api/cockpit').then((r) => r.json())
      if (d.error) setErr(String(d.error))
      else { setData(d); setErr('') }
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const s = data?.stats
  const rate = s && s.week.dm > 0 ? Math.round((s.week.replies / s.week.dm) * 100) : null

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">Cockpit</h1>
            <p className="text-xs text-gray-500">Ce qui est chaud, ce que tu envoies/reçois, et ce qui tourne — en un coup d&apos;œil.</p>
          </div>
          <button onClick={load} disabled={loading} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
          </button>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-5 space-y-6">
        {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">Erreur : {err}</div>}

        {/* Stats semaine */}
        <section>
          <h2 className="text-sm font-medium text-gray-900 mb-2">Cette semaine</h2>
          {s ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              <Tile label="DM envoyés" week={s.week.dm} prev={s.prev.dm} />
              <Tile label="Réponses reçues" week={s.week.replies} prev={s.prev.replies} />
              <Tile label="Commentaires" week={s.week.comment} prev={s.prev.comment} />
              <Tile label="Invitations" week={s.week.invite} prev={s.prev.invite} />
              <Tile label="Connexions acceptées" week={s.week.accept} prev={s.prev.accept} />
              <Tile label="Vues de profil" week={s.week.profile_view} prev={s.prev.profile_view} />
            </div>
          ) : (
            <div className="text-xs text-gray-400">Chargement…</div>
          )}
          {rate != null && (
            <p className="text-[11px] text-gray-500 mt-2">Taux de réponse (7j) : <strong>{rate}%</strong> ({s?.week.replies} réponses / {s?.week.dm} DM). <span className="text-gray-400">Les réponses sont comptées quand l&apos;app les détecte (au moment d&apos;une relance).</span></p>
          )}
        </section>

        {/* Leads chauds */}
        <section>
          <h2 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-orange-500" /> À traiter — ont répondu {data && <span className="text-[11px] font-normal text-gray-500">({data.hot.count})</span>}
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {!data || data.hot.items.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">Personne en attente de réponse pour l&apos;instant. 👌</div>
            ) : (
              data.hot.items.map((h, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm flex-wrap">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${h.source === 'outreach' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                    {h.source === 'outreach' ? 'Outreach' : 'Lead-magnet'}
                  </span>
                  <span className="font-medium text-gray-900">{h.name || 'Anonyme'}</span>
                  {h.campaign && <span className="text-[11px] text-gray-400">· {h.campaign}</span>}
                  {h.when && <span className="text-[11px] text-gray-400">· a répondu {formatDistanceToNow(h.when)}</span>}
                  <span className="flex-1" />
                  {h.link ? (
                    <a href={h.link} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5">profil <ExternalLink className="w-2.5 h-2.5" /></a>
                  ) : (
                    <a href="/messagerie" className="text-[11px] text-blue-600 hover:underline">ouvrir la messagerie</a>
                  )}
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Réponds à ces personnes en priorité — ce sont tes leads les plus chauds.</p>
        </section>

        {/* Campagnes en cours */}
        <section>
          <h2 className="text-sm font-medium text-gray-900 mb-2">Campagnes en cours</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Commentaires */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">Commentaires auto</div>
              {data?.campaigns.comments.length ? data.campaigns.comments.map((c, i) => (
                <div key={i} className="text-[11px] text-gray-600 mb-1.5">
                  <span className="font-medium text-gray-800">{c.name}</span> {c.active ? <span className="text-green-600">● actif</span> : <span className="text-gray-400">pause</span>}{c.auto && <span className="text-amber-600"> · full auto</span>}
                  <div className="text-gray-500">{c.posted_24h} postés (24h) · {c.posted_total} au total · {c.drafts} brouillons</div>
                </div>
              )) : <div className="text-[11px] text-gray-400">Aucune</div>}
            </div>
            {/* Outreach */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">Séquenceur outreach</div>
              {data?.campaigns.outreach.length ? data.campaigns.outreach.map((c, i) => (
                <div key={i} className="text-[11px] text-gray-600 mb-1.5">
                  <span className="font-medium text-gray-800">{c.name}</span> {c.active ? <span className="text-green-600">● actif</span> : <span className="text-gray-400">pause</span>}
                  <div className="text-gray-500">{c.en_file} en file · {c.en_sequence} en séquence · {c.replied} répondu · {c.done} terminés</div>
                </div>
              )) : <div className="text-[11px] text-gray-400">Aucune</div>}
            </div>
            {/* Lead magnets + auto-accept */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">Lead magnets</div>
              {data?.campaigns.leadmagnets.length ? data.campaigns.leadmagnets.map((c, i) => (
                <div key={i} className="text-[11px] text-gray-600 mb-1.5">
                  <span className="font-medium text-gray-800">{c.name}</span> {c.active ? <span className="text-green-600">● actif</span> : <span className="text-gray-400">terminé</span>}{c.auto && <span className="text-amber-600"> · auto</span>}
                  <div className="text-gray-500">{c.sent} envoyés · {c.replied} répondu</div>
                </div>
              )) : <div className="text-[11px] text-gray-400">Aucune</div>}
              {data && (
                <div className="text-[11px] text-gray-600 mt-2 pt-2 border-t border-gray-100">
                  <span className="font-medium text-gray-800">Auto-accept invitations</span> {data.campaigns.autoAccept.enabled ? <span className="text-green-600">● actif</span> : <span className="text-gray-400">off</span>}
                  <div className="text-gray-500">{data.campaigns.autoAccept.accepted_7j} acceptées (7j)</div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
