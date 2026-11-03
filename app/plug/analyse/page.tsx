'use client'

import { useEffect, useState } from 'react'

// PLUG — Analyse : KPI de la semaine ou du mois, comparés à la période précédente.

interface Sum { posts: number; reactions: number; comments: number; impressions: number; avg_engagement: number }
interface Pros { messages: number; replies: number; reply_rate: number; invitations: number; accepted: number; by_template: Record<string, { sent: number; replies: number }>; tags: Record<string, number> }
interface Data {
  period: string; start: string; end: string; insights: string | null
  content: { current: Sum; previous: Sum; top: Array<{ text: string; url: string; date: string; reactions: number; comments: number }>; flop: Array<{ text: string; url: string; reactions: number; comments: number }>; per_network: Record<string, number>; error: string | null }
  prospection: { current: Pros; previous: Pros }
}

function Kpi({ label, cur, prev, suffix = '' }: { label: string; cur: number; prev: number; suffix?: string }) {
  const diff = cur - prev
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{cur}{suffix}</div>
      <div className={`text-xs ${diff > 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>{diff > 0 ? '+' : ''}{diff}{suffix} vs période précédente</div>
    </div>
  )
}

export default function PlugAnalysePage() {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [insights, setInsights] = useState(false)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch(`/api/plug/analytics?period=${period}${insights ? '&insights=1' : ''}`).then((x) => x.json()).then((r) => {
      if (!alive) return
      setData(r.error ? null : r)
      setLoading(false)
    })
    return () => { alive = false }
  }, [period, insights])

  const c = data?.content, p = data?.prospection
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Analyse</h1>
          {data && <p className="text-xs text-gray-500">Du {new Date(data.start).toLocaleDateString('fr-FR')} au {new Date(data.end).toLocaleDateString('fr-FR')}</p>}
        </div>
        <div className="flex gap-1.5">
          {(['week', 'month'] as const).map((k) => (
            <button key={k} onClick={() => { setLoading(true); setPeriod(k) }} className={`px-3 py-1.5 rounded-full text-xs border ${period === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>{k === 'week' ? 'Semaine' : 'Mois'}</button>
          ))}
          <button onClick={() => { setLoading(true); setInsights(true) }} disabled={insights} className="px-3 py-1.5 rounded-full text-xs border bg-blue-600 text-white border-blue-600 disabled:opacity-50">✨ Ce qui a marché</button>
        </div>
      </div>
      {loading && <div className="text-sm text-gray-400 mb-3">Chargement…</div>}

      {c && (
        <>
          <h2 className="text-sm font-bold text-gray-700 mb-2">Contenu (LinkedIn)</h2>
          {c.error && <div className="mb-2 text-xs text-red-600">{c.error}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Kpi label="Posts" cur={c.current.posts} prev={c.previous.posts} />
            <Kpi label="Réactions" cur={c.current.reactions} prev={c.previous.reactions} />
            <Kpi label="Commentaires" cur={c.current.comments} prev={c.previous.comments} />
            <Kpi label="Engagement moyen / post" cur={c.current.avg_engagement} prev={c.previous.avg_engagement} />
          </div>
          <div className="text-xs text-gray-500 mb-3">Publications par réseau : {Object.entries(c.per_network).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
          {data?.insights && <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-100 text-sm whitespace-pre-wrap">{data.insights}</div>}
          <div className="bg-white border border-gray-200 rounded-xl p-3 mb-6">
            <div className="text-xs font-semibold text-gray-600 mb-2">🏆 Meilleurs posts</div>
            {!c.top.length && <div className="text-xs text-gray-400">Aucun post sur la période.</div>}
            {c.top.map((t, i) => (
              <a key={i} href={t.url} target="_blank" rel="noreferrer" className="block py-1.5 border-b last:border-0 border-gray-100 text-sm hover:bg-gray-50">
                <span className="text-xs text-gray-500 mr-2">{t.reactions} 👍 · {t.comments} 💬</span>{t.text.slice(0, 140)}…
              </a>
            ))}
            {!!c.flop.length && <div className="mt-2 text-xs text-gray-500">Moins bons : {c.flop.map((f) => `« ${f.text.slice(0, 50)}… » (${f.reactions} 👍)`).join(' · ')}</div>}
          </div>
        </>
      )}

      {p && (
        <>
          <h2 className="text-sm font-bold text-gray-700 mb-2">Prospection (envois PLUG)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
            <Kpi label="Messages envoyés" cur={p.current.messages} prev={p.previous.messages} />
            <Kpi label="Réponses" cur={p.current.replies} prev={p.previous.replies} />
            <Kpi label="Taux de réponse" cur={p.current.reply_rate} prev={p.previous.reply_rate} suffix=" %" />
            <Kpi label="Invitations" cur={p.current.invitations} prev={p.previous.invitations} />
            <Kpi label="Acceptées" cur={p.current.accepted} prev={p.previous.accepted} />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-sm">
              <div className="text-xs font-semibold text-gray-600 mb-1">Par version de message</div>
              {Object.entries(p.current.by_template).map(([k, v]) => <div key={k}>{k} : {v.sent} envoyés, {v.replies} réponses ({v.sent ? Math.round((v.replies / v.sent) * 100) : 0} %)</div>)}
              {!Object.keys(p.current.by_template).length && <div className="text-xs text-gray-400">Pas encore d’envoi via PLUG sur la période.</div>}
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-sm">
              <div className="text-xs font-semibold text-gray-600 mb-1">Statuts posés</div>
              {Object.entries(p.current.tags).map(([k, v]) => <div key={k}>{k} : {v}</div>)}
              {!Object.keys(p.current.tags).length && <div className="text-xs text-gray-400">Aucun statut sur la période.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
