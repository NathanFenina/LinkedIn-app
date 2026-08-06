'use client'

import React, { useEffect, useState, useCallback } from 'react'
import type { OutreachCampaign, OutreachTarget } from '@/types'
import {
  Plus, Play, Trash2, Power, ExternalLink, Loader2, Search, Save,
  CheckCircle2, XCircle, MessageSquare, Info, History,
} from 'lucide-react'
import { formatDistanceToNow, errMsg } from '@/lib/utils'

type TargetWithHistory = OutreachTarget & {
  history: { contact_id: string; last_message: string | null; last_message_at: string | null; is_sender_last: boolean; status: string } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  sourced: { label: 'À valider', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'En file', cls: 'bg-blue-100 text-blue-700' },
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

  // create form
  const [name, setName] = useState('')
  const [searchUrl, setSearchUrl] = useState('')
  const [msg1, setMsg1] = useState('')
  const [msg2, setMsg2] = useState('')
  const [followupDays, setFollowupDays] = useState('3')
  const [dailyCap, setDailyCap] = useState('15')

  // inline settings (campagne sélectionnée)
  const [sName, setSName] = useState('')
  const [sMsg1, setSMsg1] = useState('')
  const [sMsg2, setSMsg2] = useState('')
  const [sFollow, setSFollow] = useState('3')
  const [sCap, setSCap] = useState('15')
  const [dirty, setDirty] = useState(false)

  const fetchCampaigns = useCallback(async () => {
    const data = await fetch('/api/outreach').then((r) => r.json())
    if (data.campaigns) { setCampaigns(data.campaigns); setCounts(data.counts || {}) }
  }, [])

  const loadTargets = useCallback(async (id: string) => {
    const data = await fetch(`/api/outreach/${id}`).then((r) => r.json())
    setTargets(data.targets || [])
    if (data.campaign) {
      setSName(data.campaign.name || '')
      setSMsg1(data.campaign.msg1 || '')
      setSMsg2(data.campaign.msg2 || '')
      setSFollow(String(data.campaign.followup_days ?? 3))
      setSCap(String(data.campaign.daily_cap ?? 15))
      setDirty(false)
    }
  }, [])

  useEffect(() => { fetchCampaigns() }, [fetchCampaigns])
  useEffect(() => { if (selected) loadTargets(selected) }, [selected, loadTargets])

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault(); setBusy('create'); setMsg('')
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, search_url: searchUrl, msg1, msg2: msg2 || null, followup_days: Number(followupDays), daily_cap: Number(dailyCap) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setName(''); setSearchUrl(''); setMsg1(''); setMsg2(''); setFollowupDays('3'); setDailyCap('15')
      setShowForm(false); await fetchCampaigns(); setSelected(data.id)
    } catch (err) { setMsg('Erreur : ' + errMsg(err)) } finally { setBusy(null) }
  }

  async function saveSettings() {
    if (!selected) return
    setBusy('save'); setMsg('')
    try {
      const res = await fetch(`/api/outreach/${selected}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sName, msg1: sMsg1, msg2: sMsg2 || null, followup_days: Number(sFollow), daily_cap: Number(sCap) }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur')
      setDirty(false); setMsg('✓ Réglages enregistrés'); await fetchCampaigns()
    } catch (err) { setMsg('Erreur : ' + errMsg(err)) } finally { setBusy(null) }
  }

  async function source(id: string) {
    setBusy('source'); setMsg('')
    try {
      const res = await fetch(`/api/outreach/${id}/source`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      if (data.total === 0) {
        setMsg('⚠️ LinkedIn n’a renvoyé aucun profil pour cette URL. Vérifie que c’est bien une URL de recherche de personnes (…/search/results/people/…) et que ton compte y a accès.')
      } else {
        const parts = [`✓ ${data.added} ajoutés à valider`]
        if (data.skipped_dup) parts.push(`${data.skipped_dup} déjà dans une campagne`)
        if (data.skipped_noid) parts.push(`${data.skipped_noid} sans identifiant`)
        if (data.errors) parts.push(`${data.errors} en erreur${data.error_sample ? ` (${data.error_sample})` : ''}`)
        setMsg(`${parts.join(' · ')} — sur ${data.total} trouvés`)
      }
      await loadTargets(id); await fetchCampaigns()
    } catch (err) { setMsg('Erreur sourcing : ' + errMsg(err)) } finally { setBusy(null) }
  }

  async function setStatus(t: TargetWithHistory, status: string) {
    setBusy('t-' + t.id)
    try {
      await fetch(`/api/outreach/targets/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      await loadTargets(selected!); await fetchCampaigns()
    } finally { setBusy(null) }
  }

  async function bulkStatus(from: string, to: string) {
    const rows = targets.filter((t) => t.status === from)
    if (!rows.length) return
    if (to === 'skipped' && !confirm(`Écarter ${rows.length} profil(s) ?`)) return
    setBusy('bulk'); setMsg('')
    try {
      await Promise.all(rows.map((t) =>
        fetch(`/api/outreach/targets/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }) })
      ))
      setMsg(`✓ ${rows.length} profil(s) → ${STATUS_META[to]?.label || to}`)
      await loadTargets(selected!); await fetchCampaigns()
    } finally { setBusy(null) }
  }

  async function runStep(id: string) {
    setBusy('run'); setMsg('')
    try {
      const res = await fetch(`/api/outreach/${id}/run`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      if (data.sent) setMsg(`✓ ${data.step} envoyé à ${data.target}`)
      else if (data.skipped_reason === 'Aucun approuvé en attente')
        setMsg('Rien à envoyer : commence par « Sourcer » puis garde des profils dans « À valider ».')
      else setMsg(data.skipped_reason || data.error || 'Rien à envoyer')
      await loadTargets(id); await fetchCampaigns()
    } catch (err) { setMsg('Erreur : ' + errMsg(err)) } finally { setBusy(null) }
  }

  async function toggleActive(c: OutreachCampaign) {
    await fetch(`/api/outreach/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !c.active }) })
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
  const rest = targets.filter((t) => !['sourced', 'approved'].includes(t.status))

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Séquenceur outbound</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            1 · colle une recherche LinkedIn → 2 · l&apos;IA score chaque profil → 3 · tu gardes / écartes
            à la main → 4 · <strong>1 message pour tous</strong> (avec {'{prenom}'}) + relance auto, qui
            <strong> s&apos;arrête dès qu&apos;on te répond</strong>.
          </p>
        </div>
        <button onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-700 shrink-0">
          <Plus className="w-4 h-4" /> Nouvelle campagne
        </button>
      </div>

      {msg && <div className="mt-3 text-sm px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-700">{msg}</div>}

      {showForm && (
        <form onSubmit={createCampaign} className="mt-4 border border-gray-200 rounded-xl p-4 space-y-3 bg-white">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Nom / tag de la campagne</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Fondateurs SaaS FR"
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">URL de recherche LinkedIn (1re connexion)</label>
              <input value={searchUrl} onChange={(e) => setSearchUrl(e.target.value)} required placeholder="https://www.linkedin.com/search/results/people/?keywords=..."
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Message initial — envoyé à tous · <span className="text-gray-400">{'{prenom}'} = prénom auto</span></label>
            <textarea value={msg1} onChange={(e) => setMsg1(e.target.value)} required rows={3} placeholder="salut {prenom}, je vois qu'on est connectés…"
              className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Relance (optionnel — vide = pas de relance)</label>
            <textarea value={msg2} onChange={(e) => setMsg2(e.target.value)} rows={2} placeholder="je me permets de revenir vers toi {prenom}…"
              className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Délai avant relance (jours)</label>
              <input type="number" min={1} value={followupDays} onChange={(e) => setFollowupDays(e.target.value)} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Max envois / jour</label>
              <input type="number" min={1} value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'create'} className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Créer
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">Annuler</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-4 gap-4 mt-5">
        {/* Liste des campagnes */}
        <div className="space-y-2">
          {campaigns.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Aucune campagne.</p>}
          {campaigns.map((camp) => {
            const cc = counts[camp.id] || {}
            const active = selected === camp.id
            return (
              <button key={camp.id} onClick={() => setSelected(camp.id)}
                className={`w-full text-left border rounded-xl p-3 transition-colors ${active ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-gray-900 truncate">{camp.name}</span>
                  {camp.active ? <span className="text-[10px] text-green-600 font-medium shrink-0">● actif</span> : <span className="text-[10px] text-gray-400 shrink-0">pause</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-2 text-[10px]">
                  {(cc.sourced || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{cc.sourced} à valider</span>}
                  {(cc.approved || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{cc.approved} en file</span>}
                  {(cc.msg1_sent || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{cc.msg1_sent} en séq.</span>}
                  {(cc.replied || 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700">{cc.replied} réponses</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* Détail campagne */}
        <div className="col-span-3">
          {!current && <p className="text-sm text-gray-400 py-8 text-center">Sélectionne une campagne, ou crées-en une.</p>}
          {current && (
            <div className="space-y-4">
              {/* Barre d'actions */}
              <div className="flex items-center gap-2">
                <a href={current.search_url || '#'} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1 truncate max-w-[180px]">
                  <ExternalLink className="w-3 h-3 shrink-0" /> recherche source
                </a>
                <div className="flex-1" />
                <button onClick={() => source(current.id)} disabled={busy === 'source'}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'source' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Sourcer
                </button>
                <button onClick={() => runStep(current.id)} disabled={busy === 'run'} title="Envoie 1 message maintenant (test). En prod, la session GitHub envoie tout seul, espacé."
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Avancer (test)
                </button>
                <button onClick={() => toggleActive(current)} title={current.active ? 'Mettre en pause' : 'Activer'} className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                  <Power className={`w-4 h-4 ${current.active ? 'text-green-600' : 'text-gray-400'}`} />
                </button>
                <button onClick={() => remove(current.id)} className="p-1.5 rounded-lg border border-gray-300 hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>

              {/* Réglages inline : LE message pour tous + délais */}
              <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Réglages de la campagne</h3>
                  <button onClick={saveSettings} disabled={!dirty || busy === 'save'}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-40">
                    {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Enregistrer
                  </button>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Nom / tag</label>
                  <input value={sName} onChange={(e) => { setSName(e.target.value); setDirty(true) }} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Message initial — envoyé à tous · <span className="text-gray-400">{'{prenom}'}</span></label>
                  <textarea value={sMsg1} onChange={(e) => { setSMsg1(e.target.value); setDirty(true) }} rows={3} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Relance — envoyée à tous ceux qui n&apos;ont pas répondu</label>
                  <textarea value={sMsg2} onChange={(e) => { setSMsg2(e.target.value); setDirty(true) }} rows={2} placeholder="(vide = pas de relance)" className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600">Délai avant relance (jours)</label>
                    <input type="number" min={1} value={sFollow} onChange={(e) => { setSFollow(e.target.value); setDirty(true) }} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Max envois / jour</label>
                    <input type="number" min={1} value={sCap} onChange={(e) => { setSCap(e.target.value); setDirty(true) }} className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  L&apos;espacement entre 2 envois (~4-6 min, comme un humain) est géré automatiquement par la session
                  d&apos;envoi + les garde-fous anti-ban. Un profil déjà présent dans une campagne n&apos;est jamais re-sourcé ailleurs.
                </p>
              </div>

              {/* À VALIDER — tableau + actions groupées */}
              <TargetTable
                title="À valider" tone="amber" rows={toValidate} busy={busy}
                bulk={
                  toValidate.length > 0 && (
                    <div className="flex gap-2">
                      <button onClick={() => bulkStatus('sourced', 'approved')} disabled={busy === 'bulk'}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Tout garder & mettre en file
                      </button>
                      <button onClick={() => bulkStatus('sourced', 'skipped')} disabled={busy === 'bulk'}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        <XCircle className="w-3.5 h-3.5" /> Tout écarter
                      </button>
                    </div>
                  )
                }
                rowActions={(t) => (
                  <>
                    <button onClick={() => setStatus(t, 'approved')} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Garder
                    </button>
                    <button onClick={() => setStatus(t, 'skipped')} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">
                      <XCircle className="w-3.5 h-3.5" /> Écarter
                    </button>
                  </>
                )}
                empty="Rien à valider. Clique « Sourcer » pour récupérer les profils de la recherche."
              />

              {/* EN FILE (approuvés) */}
              <TargetTable
                title="En file d'attente d'envoi" tone="blue" rows={approved} busy={busy}
                bulk={approved.length > 0 && (
                  <span className="text-[11px] text-gray-400">Envoi auto, espacé, max {current.daily_cap}/j — ou « Avancer (test) » pour envoyer 1 tout de suite.</span>
                )}
                rowActions={(t) => (
                  <button onClick={() => setStatus(t, 'skipped')} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">
                    <XCircle className="w-3.5 h-3.5" /> Retirer
                  </button>
                )}
                empty="Personne en file. Garde des profils depuis « À valider »."
              />

              {/* SUIVI (envoyés / répondu / terminé) */}
              <TargetTable title="Suivi" tone="slate" rows={rest} busy={busy} empty="Rien d'envoyé pour l'instant." />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TargetTable({ title, tone, rows, busy, bulk, rowActions, empty }: {
  title: string
  tone: 'amber' | 'blue' | 'slate'
  rows: TargetWithHistory[]
  busy: string | null
  bulk?: React.ReactNode
  rowActions?: (t: TargetWithHistory) => React.ReactNode
  empty: string
}) {
  const dot = tone === 'amber' ? 'bg-amber-400' : tone === 'blue' ? 'bg-blue-500' : 'bg-slate-400'
  const [openId, setOpenId] = useState<string | null>(null)
  const [threads, setThreads] = useState<Record<string, Array<{ text: string; is_sender: boolean }>>>({})
  const [threadLoading, setThreadLoading] = useState<string | null>(null)

  async function toggleHistory(t: TargetWithHistory) {
    if (!t.history) return
    if (openId === t.id) { setOpenId(null); return }
    setOpenId(t.id)
    if (!threads[t.id]) {
      setThreadLoading(t.id)
      const d = await fetch(`/api/contacts/${t.history.contact_id}/thread`).then((r) => r.json()).catch(() => [])
      setThreads((p) => ({ ...p, [t.id]: Array.isArray(d) ? d : [] }))
      setThreadLoading(null)
    }
  }

  const cols = rowActions ? 6 : 5
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <span className="text-sm font-semibold text-gray-700">{title}</span>
          <span className="text-xs text-gray-400">({rows.length})</span>
        </div>
        {bulk}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 px-3 py-5 text-center">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 border-b border-gray-100">
                <th className="text-left font-medium px-3 py-1.5 w-12">Score</th>
                <th className="text-left font-medium px-3 py-1.5">Nom</th>
                <th className="text-left font-medium px-3 py-1.5">Tagline</th>
                <th className="text-left font-medium px-3 py-1.5">Historique</th>
                <th className="text-left font-medium px-3 py-1.5">Statut</th>
                {rowActions && <th className="px-3 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const m = STATUS_META[t.status] || { label: t.status, cls: 'bg-gray-100 text-gray-500' }
                return (
                <React.Fragment key={t.id}>
                  <tr className="border-b border-gray-50 last:border-0 align-top hover:bg-gray-50/50">
                    <td className="px-3 py-2">
                      <span title={t.score_reason || ''} className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${scoreCls(t.score)}`}>{t.score}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-900">{t.name || '—'}</span>
                        {t.profile_url && <a href={t.profile_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-600"><ExternalLink className="w-3 h-3" /></a>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 max-w-[220px]"><span className="line-clamp-2">{t.headline || '—'}</span></td>
                    <td className="px-3 py-2 text-xs">
                      {t.history ? (
                        <button onClick={() => toggleHistory(t)} className="text-amber-700 flex items-center gap-1 hover:underline">
                          <History className="w-3 h-3 shrink-0" />
                          déjà échangé{t.history.last_message_at ? ` · ${formatDistanceToNow(t.history.last_message_at)}` : ''}
                        </button>
                      ) : <span className="text-gray-300">jamais contacté</span>}
                    </td>
                    <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span></td>
                    {rowActions && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 justify-end">
                          {busy === 't-' + t.id ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : rowActions(t)}
                        </div>
                      </td>
                    )}
                  </tr>
                  {openId === t.id && (
                    <tr className="bg-amber-50/40">
                      <td colSpan={cols} className="px-4 py-3">
                        {threadLoading === t.id ? (
                          <span className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> chargement de l&apos;historique…</span>
                        ) : (threads[t.id]?.length ? (
                          <div className="space-y-1.5 max-w-2xl">
                            {threads[t.id].map((mm, i) => (
                              <div key={i} className={`text-xs px-2.5 py-1.5 rounded-lg ${mm.is_sender ? 'bg-blue-100 text-blue-900 ml-auto max-w-[80%]' : 'bg-white border border-gray-200 text-gray-700 max-w-[80%]'}`}>
                                {mm.text}
                              </div>
                            ))}
                          </div>
                        ) : <span className="text-xs text-gray-400">Aucun message trouvé dans l&apos;historique.</span>)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
