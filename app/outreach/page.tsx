'use client'

import { useEffect, useState, useCallback } from 'react'
import type { OutreachCampaign, OutreachTarget } from '@/types'
import {
  Plus, Play, Trash2, Power, Users, ExternalLink, Loader2, Search,
  CheckCircle2, XCircle, Send, Clock, MessageSquare, ChevronDown, ChevronRight,
} from 'lucide-react'
import { formatDistanceToNow, errMsg } from '@/lib/utils'

type TargetWithHistory = OutreachTarget & {
  history: { last_message: string | null; last_message_at: string | null; is_sender_last: boolean; status: string } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  sourced: { label: 'À valider', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approuvé', cls: 'bg-blue-100 text-blue-700' },
  skipped: { label: 'Écarté', cls: 'bg-gray-100 text-gray-500' },
  msg1_sent: { label: 'Msg 1 envoyé', cls: 'bg-indigo-100 text-indigo-700' },
  msg2_sent: { label: 'Relancé', cls: 'bg-purple-100 text-purple-700' },
  done: { label: 'Terminé', cls: 'bg-slate-200 text-slate-600' },
  replied: { label: '💬 A répondu', cls: 'bg-green-100 text-green-700' },
  error: { label: 'Erreur', cls: 'bg-red-100 text-red-700' },
}

function scoreCls(s: number) {
  if (s >= 8) return 'bg-green-100 text-green-700'
  if (s >= 5) return 'bg-amber-100 text-amber-700'
  return 'bg-gray-100 text-gray-500'
}

export default function OutreachPage() {
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([])
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [targets, setTargets] = useState<TargetWithHistory[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // create form
  const [name, setName] = useState('')
  const [searchUrl, setSearchUrl] = useState('')
  const [msg1, setMsg1] = useState('')
  const [msg2, setMsg2] = useState('')
  const [followupDays, setFollowupDays] = useState('3')
  const [dailyCap, setDailyCap] = useState('15')

  const fetchCampaigns = useCallback(async () => {
    const data = await fetch('/api/outreach').then((r) => r.json())
    if (data.campaigns) {
      setCampaigns(data.campaigns)
      setCounts(data.counts || {})
    }
  }, [])

  const loadTargets = useCallback(async (id: string) => {
    const data = await fetch(`/api/outreach/${id}`).then((r) => r.json())
    setTargets(data.targets || [])
  }, [])

  useEffect(() => { fetchCampaigns() }, [fetchCampaigns])
  useEffect(() => { if (selected) loadTargets(selected) }, [selected, loadTargets])

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault()
    setBusy('create'); setMsg('')
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, search_url: searchUrl, msg1, msg2: msg2 || null,
          followup_days: Number(followupDays), daily_cap: Number(dailyCap),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setName(''); setSearchUrl(''); setMsg1(''); setMsg2(''); setFollowupDays('3'); setDailyCap('15')
      setShowForm(false)
      await fetchCampaigns()
      setSelected(data.id)
    } catch (err) {
      setMsg('Erreur : ' + errMsg(err))
    } finally { setBusy(null) }
  }

  async function source(id: string) {
    setBusy('source-' + id); setMsg('')
    try {
      const res = await fetch(`/api/outreach/${id}/source`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setMsg(`✓ ${data.added} profils ajoutés · ${data.skipped_dup} déjà connus (sur ${data.total} trouvés)`)
      await loadTargets(id); await fetchCampaigns()
    } catch (err) {
      setMsg('Erreur sourcing : ' + errMsg(err))
    } finally { setBusy(null) }
  }

  async function setTargetStatus(t: TargetWithHistory, status: string) {
    setBusy('t-' + t.id)
    try {
      await fetch(`/api/outreach/targets/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await loadTargets(selected!); await fetchCampaigns()
    } finally { setBusy(null) }
  }

  async function runStep(id: string) {
    setBusy('run-' + id); setMsg('')
    try {
      const res = await fetch(`/api/outreach/${id}/run`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      if (data.sent) setMsg(`✓ ${data.step} envoyé à ${data.target}`)
      else setMsg(data.skipped_reason || data.error || 'Rien à envoyer pour le moment')
      await loadTargets(id); await fetchCampaigns()
    } catch (err) {
      setMsg('Erreur : ' + errMsg(err))
    } finally { setBusy(null) }
  }

  async function toggleActive(c: OutreachCampaign) {
    await fetch(`/api/outreach/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !c.active }),
    })
    await fetchCampaigns()
  }

  async function remove(id: string) {
    if (!confirm('Supprimer cette campagne et toutes ses cibles ?')) return
    await fetch(`/api/outreach/${id}`, { method: 'DELETE' })
    if (selected === id) { setSelected(null); setTargets([]) }
    await fetchCampaigns()
  }

  const current = campaigns.find((c) => c.id === selected)
  const c = counts[selected || ''] || {}
  const toValidate = targets.filter((t) => t.status === 'sourced')
  const approved = targets.filter((t) => t.status === 'approved')
  const inSeq = targets.filter((t) => ['msg1_sent', 'msg2_sent'].includes(t.status))
  const closed = targets.filter((t) => ['done', 'replied', 'skipped', 'error'].includes(t.status))

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Séquenceur outbound</h1>
          <p className="text-sm text-gray-500 mt-1">
            Colle une recherche LinkedIn → l&apos;IA score les profils → tu valides à la main qui reste →
            message initial + relance auto (stop dès qu&apos;on te répond).
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Nouvelle campagne
        </button>
      </div>

      {msg && (
        <div className="mt-3 text-sm px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-700">{msg}</div>
      )}

      {showForm && (
        <form onSubmit={createCampaign} className="mt-4 border border-gray-200 rounded-xl p-4 space-y-3 bg-white">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Nom de la campagne</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required
                placeholder="Fondateurs SaaS FR"
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">URL de recherche LinkedIn (1re connexion)</label>
              <input value={searchUrl} onChange={(e) => setSearchUrl(e.target.value)} required
                placeholder="https://www.linkedin.com/search/results/people/?keywords=..."
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Message initial · <span className="text-gray-400">{'{prenom}'} = prénom auto</span></label>
            <textarea value={msg1} onChange={(e) => setMsg1(e.target.value)} required rows={3}
              placeholder="salut {prenom}, je vois qu'on est connectés…"
              className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Relance (optionnel — laissé vide = pas de relance)</label>
            <textarea value={msg2} onChange={(e) => setMsg2(e.target.value)} rows={2}
              placeholder="je me permets de revenir vers toi {prenom}…"
              className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Délai avant relance (jours)</label>
              <input type="number" min={1} value={followupDays} onChange={(e) => setFollowupDays(e.target.value)}
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Max envois / jour</label>
              <input type="number" min={1} value={dailyCap} onChange={(e) => setDailyCap(e.target.value)}
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'create'}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Créer
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="text-sm px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">Annuler</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-3 gap-4 mt-5">
        {/* Liste des campagnes */}
        <div className="space-y-2">
          {campaigns.length === 0 && (
            <p className="text-sm text-gray-400 py-8 text-center">Aucune campagne. Crées-en une pour démarrer.</p>
          )}
          {campaigns.map((camp) => {
            const cc = counts[camp.id] || {}
            const active = selected === camp.id
            return (
              <button key={camp.id} onClick={() => setSelected(camp.id)}
                className={`w-full text-left border rounded-xl p-3 transition-colors ${active ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-gray-900 truncate">{camp.name}</span>
                  {camp.active
                    ? <span className="text-[10px] text-green-600 font-medium">● actif</span>
                    : <span className="text-[10px] text-gray-400">en pause</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-2 text-[10px]">
                  {(cc.sourced || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{cc.sourced} à valider</span>}
                  {(cc.approved || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{cc.approved} approuvés</span>}
                  {(cc.msg1_sent || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{cc.msg1_sent} en séquence</span>}
                  {(cc.replied || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700">{cc.replied} réponses</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* Détail campagne sélectionnée */}
        <div className="col-span-2">
          {!current && <p className="text-sm text-gray-400 py-8 text-center">Sélectionne une campagne.</p>}
          {current && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <a href={current.search_url || '#'} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1 truncate max-w-[200px]">
                  <ExternalLink className="w-3 h-3 shrink-0" /> recherche source
                </a>
                <div className="flex-1" />
                <button onClick={() => source(current.id)} disabled={busy === 'source-' + current.id}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'source-' + current.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Sourcer les profils
                </button>
                <button onClick={() => runStep(current.id)} disabled={busy === 'run-' + current.id}
                  title="Avance la séquence d'un cran (test manuel)"
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {busy === 'run-' + current.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Avancer
                </button>
                <button onClick={() => toggleActive(current)} title={current.active ? 'Mettre en pause' : 'Activer'}
                  className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                  <Power className={`w-4 h-4 ${current.active ? 'text-green-600' : 'text-gray-400'}`} />
                </button>
                <button onClick={() => remove(current.id)} className="p-1.5 rounded-lg border border-gray-300 hover:bg-red-50 text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] text-gray-400 mb-3">
                Séquence : msg initial → relance à J+{current.followup_days} · max {current.daily_cap}/jour · {c.done || 0} terminés
              </p>

              <Section title="À valider" icon={<Users className="w-4 h-4" />} count={toValidate.length}
                open={expanded.tovalidate ?? true} onToggle={() => setExpanded((e) => ({ ...e, tovalidate: !(e.tovalidate ?? true) }))}>
                {toValidate.map((t) => (
                  <TargetRow key={t.id} t={t} busy={busy === 't-' + t.id}
                    actions={
                      <>
                        <button onClick={() => setTargetStatus(t, 'approved')}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Garder
                        </button>
                        <button onClick={() => setTargetStatus(t, 'skipped')}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">
                          <XCircle className="w-3.5 h-3.5" /> Écarter
                        </button>
                      </>
                    } />
                ))}
                {toValidate.length === 0 && <Empty>Rien à valider. Clique « Sourcer les profils ».</Empty>}
              </Section>

              <Section title="Approuvés — en file d'attente" icon={<Send className="w-4 h-4" />} count={approved.length}
                open={expanded.approved ?? false} onToggle={() => setExpanded((e) => ({ ...e, approved: !e.approved }))}>
                {approved.map((t) => (
                  <TargetRow key={t.id} t={t} busy={busy === 't-' + t.id}
                    actions={
                      <button onClick={() => setTargetStatus(t, 'skipped')}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">
                        <XCircle className="w-3.5 h-3.5" /> Retirer
                      </button>
                    } />
                ))}
                {approved.length === 0 && <Empty>Personne en attente d&apos;envoi.</Empty>}
              </Section>

              <Section title="En séquence" icon={<Clock className="w-4 h-4" />} count={inSeq.length}
                open={expanded.inseq ?? false} onToggle={() => setExpanded((e) => ({ ...e, inseq: !e.inseq }))}>
                {inSeq.map((t) => <TargetRow key={t.id} t={t} busy={false} />)}
                {inSeq.length === 0 && <Empty>Aucune séquence en cours.</Empty>}
              </Section>

              <Section title="Clôturés" icon={<CheckCircle2 className="w-4 h-4" />} count={closed.length}
                open={expanded.closed ?? false} onToggle={() => setExpanded((e) => ({ ...e, closed: !e.closed }))}>
                {closed.map((t) => <TargetRow key={t.id} t={t} busy={false} />)}
                {closed.length === 0 && <Empty>Rien de clôturé.</Empty>}
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, icon, count, open, onToggle, children }: {
  title: string; icon: React.ReactNode; count: number; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border border-gray-200 rounded-xl mb-3 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left">
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        <span className="text-gray-500">{icon}</span>
        <span className="text-sm font-medium text-gray-700">{title}</span>
        <span className="text-xs text-gray-400">({count})</span>
      </button>
      {open && <div className="divide-y divide-gray-100">{children}</div>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-400 px-3 py-4 text-center">{children}</p>
}

function TargetRow({ t, busy, actions }: { t: TargetWithHistory; busy: boolean; actions?: React.ReactNode }) {
  const [showReason, setShowReason] = useState(false)
  const m = STATUS_META[t.status] || { label: t.status, cls: 'bg-gray-100 text-gray-500' }
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${scoreCls(t.score)}`}>
          {t.score}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900 truncate">{t.name || '—'}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span>
            {t.profile_url && (
              <a href={t.profile_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-600">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {t.headline && <p className="text-xs text-gray-500 truncate">{t.headline}</p>}
          {t.history && (
            <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
              <MessageSquare className="w-3 h-3 shrink-0" />
              Déjà échangé{t.history.last_message_at ? ` · ${formatDistanceToNow(t.history.last_message_at)}` : ''}
              {t.history.is_sender_last ? ' · dernier msg = toi' : ' · a répondu'}
            </p>
          )}
          {t.score_reason && (
            <button onClick={() => setShowReason((v) => !v)} className="text-[11px] text-gray-400 hover:text-gray-600 mt-0.5">
              {showReason ? '− masquer' : '+ pourquoi ce score'}
            </button>
          )}
          {showReason && t.score_reason && <p className="text-[11px] text-gray-500 mt-1 italic">{t.score_reason}</p>}
          {t.error && <p className="text-[11px] text-red-500 mt-1">{t.error}</p>}
        </div>
        {actions && (
          <div className="flex items-center gap-1.5 shrink-0">
            {busy ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : actions}
          </div>
        )}
      </div>
    </div>
  )
}
