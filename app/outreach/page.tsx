'use client'

import React, { useEffect, useState, useCallback } from 'react'
import type { OutreachCampaign, OutreachTarget } from '@/types'
import {
  Plus, Play, Trash2, Power, ExternalLink, Loader2, Search, Save,
  CheckCircle2, XCircle, MessageSquare, Info, History, Filter, X,
} from 'lucide-react'
import { formatDistanceToNow, errMsg } from '@/lib/utils'

type TargetWithHistory = OutreachTarget & {
  history: { contact_id: string | null; chat_id: string | null; last_message: string | null; last_message_at: string | null; is_sender_last: boolean; status: string | null } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  sourced: { label: 'À valider', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'En file', cls: 'bg-blue-100 text-blue-700' },
  invited: { label: '📨 Invité', cls: 'bg-cyan-100 text-cyan-700' },
  connected: { label: '🤝 Connecté', cls: 'bg-teal-100 text-teal-700' },
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

// Fondateur / décideur (la recherche mot-clé LinkedIn laisse passer des non-fondateurs).
const FOUNDER_RE = /\b(fondat|co-?fondat|founder|co-?found|ceo|dirigeant|g[ée]rant|pr[ée]sident|owner|co-?owner)\b/i
// Prestataires marketing (vendent le service → pas des acheteurs) + faux "CMO"
// (Chief Medical Officer, CRO) + rôles hors-cible (commercial). Sur la tagline.
const PROVIDER_RE = /(freelance|fractional|part[- ]?time|externalis|temps partag|\bagence\b|\bagency\b|consultant|\badvisor\b|j['’]aide|j['’]accompagne|nous aidons|nous accompagnons|chief medical|medical officer|\bcro\b|chief revenue|business develop|commercial|n[ée]gociat)/i

export default function OutreachPage() {
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([])
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [targets, setTargets] = useState<TargetWithHistory[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('')
  const [foundersOnly, setFoundersOnly] = useState(false)
  const [hideProviders, setHideProviders] = useState(false)
  const [restStatus, setRestStatus] = useState('all')
  const [showCompanies, setShowCompanies] = useState(false)
  const [companiesText, setCompaniesText] = useState('')
  const [adKeywords, setAdKeywords] = useState('')
  const [jobKeywords, setJobKeywords] = useState('')
  const [pubStatus, setPubStatus] = useState<{ status?: string; conclusion?: string | null; started_at?: string; html_url?: string; available?: boolean; none?: boolean } | null>(null)

  // create form
  const [name, setName] = useState('')
  const [searchUrl, setSearchUrl] = useState('')
  const [msg1, setMsg1] = useState('')
  const [msg2, setMsg2] = useState('')
  const [followupDays, setFollowupDays] = useState('3')
  const [dailyCap, setDailyCap] = useState('15')
  const [inviteFirst, setInviteFirst] = useState(false)
  const [inviteNote, setInviteNote] = useState('')

  // inline settings (campagne sélectionnée)
  const [sName, setSName] = useState('')
  const [sMsg1, setSMsg1] = useState('')
  const [sMsg2, setSMsg2] = useState('')
  const [sFollow, setSFollow] = useState('3')
  const [sCap, setSCap] = useState('15')
  const [sHourStart, setSHourStart] = useState('9')
  const [sHourEnd, setSHourEnd] = useState('18')
  const [sIcp, setSIcp] = useState('')
  const [icp, setIcp] = useState('')
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
      setSHourStart(String(data.campaign.active_hour_start ?? 9))
      setSHourEnd(String(data.campaign.active_hour_end ?? 18))
      setSIcp(data.campaign.icp || '')
      setDirty(false)
    }
  }, [])

  const fetchPubStatus = useCallback(async () => {
    const d = await fetch('/api/outreach/publish-status').then((r) => r.json()).catch(() => null)
    setPubStatus(d)
  }, [])

  useEffect(() => { fetchCampaigns(); fetchPubStatus() }, [fetchCampaigns, fetchPubStatus])
  useEffect(() => { if (selected) loadTargets(selected) }, [selected, loadTargets])

  // Tant qu'une session tourne, on rafraîchit l'état + les compteurs toutes les
  // 20s pour voir la file se vider en direct.
  const sessionRunning = !!pubStatus?.available && !!pubStatus.status && pubStatus.status !== 'completed' && !pubStatus.none
  useEffect(() => {
    if (!sessionRunning) return
    const t = setInterval(() => { fetchPubStatus(); fetchCampaigns(); if (selected) loadTargets(selected) }, 20000)
    return () => clearInterval(t)
  }, [sessionRunning, fetchPubStatus, fetchCampaigns, loadTargets, selected])

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault(); setBusy('create'); setMsg('')
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, search_url: searchUrl, msg1, msg2: msg2 || null, followup_days: Number(followupDays), daily_cap: Number(dailyCap), invite_first: inviteFirst, invite_note: inviteFirst ? (inviteNote || null) : null, icp: icp || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setName(''); setSearchUrl(''); setMsg1(''); setMsg2(''); setFollowupDays('3'); setDailyCap('15'); setIcp('')
      setShowForm(false); await fetchCampaigns(); setSelected(data.id)
    } catch (err) { setMsg('Erreur : ' + errMsg(err)) } finally { setBusy(null) }
  }

  async function saveSettings() {
    if (!selected) return
    setBusy('save'); setMsg('')
    try {
      const res = await fetch(`/api/outreach/${selected}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sName, msg1: sMsg1, msg2: sMsg2 || null, followup_days: Number(sFollow), daily_cap: Number(sCap), active_hour_start: Number(sHourStart), active_hour_end: Number(sHourEnd), icp: sIcp || null }),
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
        if (data.skipped_dup) {
          const ov = data.overlap && Object.keys(data.overlap).length
            ? ` (${Object.entries(data.overlap as Record<string, number>).map(([a, n]) => `${a}: ${n}`).join(', ')})`
            : ''
          parts.push(`${data.skipped_dup} déjà dans une audience${ov}`)
        }
        if (data.skipped_noid) parts.push(`${data.skipped_noid} sans identifiant`)
        if (data.errors) parts.push(`${data.errors} en erreur${data.error_sample ? ` (${data.error_sample})` : ''}`)
        const more = data.has_more ? ' · ⚠️ il reste des profils — reclique « Sourcer » pour la suite' : ' · liste complète ✓'
        setMsg(`${parts.join(' · ')} — sur ${data.total} trouvés${more}`)
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

  // Ban permanent : ajoute à la liste "ne plus contacter" (exclut du sourcing de
  // TOUTES les campagnes) + écarte la cible ici.
  async function banTarget(t: TargetWithHistory) {
    if (!t.provider_id) { setMsg('Impossible : pas d’identifiant LinkedIn pour cette personne.'); return }
    if (!confirm(`Ne plus JAMAIS contacter ${t.name || 'cette personne'} (toutes campagnes) ?`)) return
    setBusy('t-' + t.id)
    try {
      await fetch('/api/outreach/dnc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider_id: t.provider_id, name: t.name, reason: 'manuel' }) })
      await fetch(`/api/outreach/targets/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'skipped' }) })
      await loadTargets(selected!); await fetchCampaigns()
    } finally { setBusy(null) }
  }

  // Source une campagne à partir d'une liste d'entreprises (une par ligne).
  async function sourceCompanies(id: string) {
    const list = companiesText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
    if (!list.length) { setMsg('Colle au moins une entreprise (une par ligne).'); return }
    setBusy('sourceco'); setMsg('')
    try {
      const d = await fetch(`/api/outreach/${id}/source-companies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companies: list, per_company: 2 }) }).then((r) => r.json())
      if (d.error) setMsg('Erreur : ' + d.error)
      else {
        setMsg(`✓ ${d.added} décideurs ajoutés · ${d.resolved}/${d.companies} boîtes résolues · ${d.skipped_dup} déjà dans une audience · ${d.notfound} introuvables${d.notFoundSample?.length ? ` (${d.notFoundSample.join(', ')})` : ''}`)
        setShowCompanies(false); setCompaniesText('')
        await loadTargets(id); await fetchCampaigns()
      }
    } finally { setBusy(null) }
  }

  // Boîtes qui recrutent (offres LinkedIn) → remplit la liste d'entreprises à sourcer.
  async function findHiring() {
    const keywords = jobKeywords.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
    if (!keywords.length) return
    setBusy('jobs'); setMsg('')
    try {
      const d = await fetch('/api/outreach/hiring-companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords, days: 30 }) }).then((r) => r.json())
      if (d.error) { setMsg('Erreur offres : ' + d.error); return }
      const names = (d.companies as Array<{ name: string }>).map((c) => c.name)
      setCompaniesText((prev) => [prev.trim(), ...names].filter(Boolean).join('\n'))
      setMsg(`🧲 ${names.length} boîtes qui recrutent (${d.jobs} offres analysées) — ajoutées à la liste, vire celles qui ne te parlent pas puis « Sourcer ces entreprises ».`)
    } finally { setBusy(null) }
  }

  // Annonceurs (bibliothèque pub Meta) → remplit la liste d'entreprises à sourcer.
  async function findAdvertisers() {
    const keywords = adKeywords.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
    if (!keywords.length) return
    setBusy('ads'); setMsg('')
    try {
      const d = await fetch('/api/outreach/advertisers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords, per_keyword: 60 }) }).then((r) => r.json())
      if (d.error) { setMsg('Erreur annonceurs : ' + d.error); return }
      const names = (d.advertisers as Array<{ name: string; active_ads: number }>).map((a) => a.name)
      setCompaniesText((prev) => [prev.trim(), ...names].filter(Boolean).join('\n'))
      setMsg(`📢 ${names.length} annonceurs trouvés (${d.ads} pubs actives analysées) — ajoutés à la liste, vire ceux qui ne te parlent pas puis « Sourcer ces entreprises ».`)
    } finally { setBusy(null) }
  }

  // Détecte les réponses sur toutes les campagnes actives (taux fiables).
  async function detectReplies() {
    setBusy('detect')
    try {
      const d = await fetch('/api/outreach/detect-replies', { method: 'POST' }).then((r) => r.json())
      if (d.error) setMsg('Erreur détection : ' + d.error)
      else {
        setMsg(`Détection : ${d.replies} réponse(s) trouvée(s) sur ${d.checked} conversation(s) vérifiée(s).`)
        if (selected) { await loadTargets(selected); await fetchCampaigns() }
      }
    } finally { setBusy(null) }
  }

  // Re-score les "à valider" avec la cible (ICP) de la campagne ; ceux < 4 sont
  // écartés d'office. Boucle tant qu'il en reste (200 par appel).
  async function rescore(id: string) {
    setBusy('rescore'); setMsg('')
    try {
      let total = 0, skipped = 0, more = true, guard = 0
      while (more && guard++ < 10) {
        const d = await fetch(`/api/outreach/${id}/rescore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 200, min_score_skip: 4 }) }).then((r) => r.json())
        if (d.error) { setMsg('Erreur re-score : ' + d.error); return }
        total += d.scored; skipped += d.skipped; more = !!d.has_more
        setMsg(`Re-score : ${total} profils notés, ${skipped} écartés (< 4/10)${more ? '…' : '.'}`)
      }
      await loadTargets(id); await fetchCampaigns()
    } finally { setBusy(null) }
  }

  async function bulkStatus(from: string, to: string) {
    // Respecte le filtre courant : "Tout écarter" avec un filtre "seo" n'écarte
    // que les profils SEO affichés, pas toute la liste.
    const rows = targets.filter((t) => t.status === from && matchFilter(t))
    if (!rows.length) return
    const verb = to === 'skipped' ? 'Écarter' : 'Mettre en file'
    if (!confirm(`${verb} ${rows.length} profil(s)${filter.trim() ? ` (filtre « ${filter.trim()} »)` : ''} ?`)) return
    setBusy('bulk'); setMsg('')
    try {
      await Promise.all(rows.map((t) =>
        fetch(`/api/outreach/targets/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }) })
      ))
      setMsg(`✓ ${rows.length} profil(s) → ${STATUS_META[to]?.label || to}`)
      await loadTargets(selected!); await fetchCampaigns()
    } finally { setBusy(null) }
  }

  async function rescanHistory(id: string) {
    setBusy('rescan'); setMsg('')
    try {
      const res = await fetch(`/api/outreach/${id}/rescan-history`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setMsg(`✓ Historique re-scanné : ${data.updated} « déjà échangé » retrouvés sur ${data.scanned} à traiter`)
      await loadTargets(id)
    } catch (err) {
      setMsg('Erreur : ' + errMsg(err))
    } finally { setBusy(null) }
  }

  // Nettoie la FILE : retire (status skipped) tous les approuvés qui matchent
  // les prestataires / faux CMO / commerciaux. Un clic pour dépolluer la file.
  async function cleanQueue() {
    const rows = targets.filter((t) => t.status === 'approved' && PROVIDER_RE.test(t.headline || ''))
    if (!rows.length) { setMsg('Aucun prestataire / faux CMO dans la file 👍'); return }
    if (!confirm(`Retirer ${rows.length} prestataire(s) / faux CMO de la file d'envoi ?`)) return
    setBusy('bulk'); setMsg('')
    try {
      await Promise.all(rows.map((t) =>
        fetch(`/api/outreach/targets/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'skipped' }) })
      ))
      setMsg(`✓ ${rows.length} retiré(s) de la file`)
      await loadTargets(selected!); await fetchCampaigns()
    } finally { setBusy(null) }
  }

  // Lance la session d'envoi (GitHub) : envoie la file espacé, sans ouvrir GitHub.
  async function publishSession(id: string) {
    if (!confirm('Lancer la session d\'envoi ? Les messages de la file partiront un par un, espacés (4-6 min), jusqu\'au plafond du jour.')) return
    setBusy('publish'); setMsg('')
    try {
      const res = await fetch(`/api/outreach/${id}/publish`, { method: 'POST' })
      const data = await res.json()
      if (data.error) setMsg(`⚠️ ${data.error}`)
      else {
        // Garde-fou plage horaire : si on est hors fenêtre, le cron n'enverra
        // rien tant qu'on n'est pas revenu dedans → on prévient tout de suite.
        const parisH = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date())) % 24
        const hs = Number(sHourStart), he = Number(sHourEnd)
        const inWindow = hs <= he ? parisH >= hs && parisH < he : parisH >= hs || parisH < he
        setMsg(
          inWindow
            ? (data.message || 'Session lancée ✅ — reviens dans quelques minutes, la file se vide.')
            : `Session lancée, mais il est ${parisH}h à Paris et ta plage d'envoi est ${hs}h-${he}h → aucun message ne partira avant ${hs}h. Élargis la plage dans les réglages si tu veux envoyer maintenant.`
        )
        // La campagne est réactivée côté serveur → on le reflète tout de suite.
        setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, active: true } : c)))
        // Affiche l'état "en cours" tout de suite, puis re-synchronise avec GitHub.
        setPubStatus({ available: true, status: 'in_progress' })
        setTimeout(() => fetchPubStatus(), 6000)
      }
    } catch (err) { setMsg('Erreur : ' + errMsg(err)) } finally { setBusy(null) }
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
  const f = filter.trim().toLowerCase()
  function matchFilter(t: TargetWithHistory) {
    if (foundersOnly && !FOUNDER_RE.test(t.headline || '')) return false
    if (hideProviders && PROVIDER_RE.test(t.headline || '')) return false
    if (!f) return true
    return `${t.name || ''} ${t.headline || ''}`.toLowerCase().includes(f)
  }
  const toValidate = targets.filter((t) => t.status === 'sourced' && matchFilter(t))
  const approved = targets.filter((t) => t.status === 'approved' && matchFilter(t))
  const rest = targets.filter((t) => !['sourced', 'approved'].includes(t.status) && matchFilter(t))
  const sourcedTotal = targets.filter((t) => t.status === 'sourced').length

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
            <label className="text-xs font-medium text-gray-600">Cible (ICP) — pour le scoring IA et l&apos;accroche <span className="text-gray-400">(optionnel)</span></label>
            <textarea value={icp} onChange={(e) => setIcp(e.target.value)} rows={2} placeholder="ex. Dirigeants ou RH de PME 11-200 salariés (agences, cabinets comptables, ESN) pour une formation IA financée par l'OPCO"
              className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="rounded-lg border border-cyan-200 bg-cyan-50/50 p-2.5">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={inviteFirst} onChange={(e) => setInviteFirst(e.target.checked)} />
              <span><strong>Invitation d&apos;abord</strong> (hors audience) — envoie une invitation, puis le message une fois acceptée</span>
            </label>
            <p className="text-[11px] text-gray-500 mt-1">Coche pour cibler des gens à qui tu n&apos;es pas encore connecté (2e/3e degré). Séquence : invitation → (acceptée) → message initial → relance. Sinon, message direct aux 1res connexions.</p>
            {inviteFirst && (
              <div className="mt-2">
                <label className="text-xs font-medium text-gray-600">Note d&apos;invitation (≤ 300 car., optionnelle) · <span className="text-gray-400">{'{prenom}'}</span></label>
                <textarea value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} rows={2} maxLength={300} placeholder="hello {prenom}, je connecte avec les gens qui font du SEO / de l'IA — au plaisir d'échanger 🙌"
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Message initial — envoyé {inviteFirst ? 'une fois l’invitation acceptée' : 'à tous'} · <span className="text-gray-400">{'{prenom}'} · {'{entreprise}'} · {'{accroche}'} (1re ligne IA) · plusieurs versions séparées par une ligne <code>===</code> = rotation aléatoire</span></label>
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
                <button onClick={() => setShowCompanies((v) => !v)} disabled={busy === 'sourceco'}
                  title="Sourcer les décideurs marketing à partir d'une liste d'entreprises (ex: boîtes qui ont levé)"
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'sourceco' ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>🏢</span>} Par entreprises
                </button>
                <button onClick={() => rescanHistory(current.id)} disabled={busy === 'rescan'}
                  title="Re-scanne tes conversations LinkedIn pour rattraper les « déjà échangé » anciens"
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'rescan' ? <Loader2 className="w-4 h-4 animate-spin" /> : <History className="w-4 h-4" />} Re-scan historique
                </button>
                <button onClick={() => rescore(current.id)} disabled={busy === 'rescore'}
                  title="Re-note les « à valider » avec la cible (ICP) de la campagne et écarte ceux < 4/10"
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'rescore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>🎯</span>} Re-scorer
                </button>
                <button onClick={detectReplies} disabled={busy === 'detect'}
                  title="Vérifie qui a répondu (marque « A répondu ») pour des taux de réponse fiables"
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'detect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>💬</span>} Détecter réponses
                </button>
                <button onClick={() => publishSession(current.id)} disabled={busy === 'publish'} title="Lance la session d'envoi : la file part un par un, espacé (4-6 min), jusqu'au plafond du jour."
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                  {busy === 'publish' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Lancer l&apos;envoi
                </button>
                <button onClick={() => runStep(current.id)} disabled={busy === 'run'} title="Envoie 1 message maintenant (test)."
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Avancer (test)
                </button>
                <button onClick={() => toggleActive(current)} title={current.active ? 'Mettre en pause' : 'Activer'} className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                  <Power className={`w-4 h-4 ${current.active ? 'text-green-600' : 'text-gray-400'}`} />
                </button>
                <button onClick={() => remove(current.id)} className="p-1.5 rounded-lg border border-gray-300 hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>

              {/* Sourcer par entreprises (ex: boîtes qui ont levé) */}
              {showCompanies && (
                <div className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-3 space-y-2">
                  <div className="text-sm font-medium text-gray-800">🏢 Sourcer les décideurs par entreprise</div>
                  <p className="text-[11px] text-gray-500">Une entreprise par ligne (boîtes qui recrutent, qui ont levé, qui font de la pub…). L&apos;app résout chaque société sur LinkedIn et récupère jusqu&apos;à 2 décideurs (marketing / growth, ou fondateur-CEO si la boîte est petite).</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-gray-500">🧲 Boîtes qui recrutent (offres LinkedIn, 30 j) — rôles :</span>
                    <input value={jobKeywords} onChange={(e) => setJobKeywords(e.target.value)} placeholder="ex: SEO, growth, responsable acquisition"
                      className="flex-1 min-w-[220px] text-xs border border-gray-300 rounded px-2 py-1" />
                    <button onClick={findHiring} disabled={busy === 'jobs' || !jobKeywords.trim()}
                      className="text-xs px-2.5 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                      {busy === 'jobs' ? '…' : 'Chercher'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-gray-500">📢 Trouver des annonceurs (pub Meta active, FR) :</span>
                    <input value={adKeywords} onChange={(e) => setAdKeywords(e.target.value)} placeholder="ex: logiciel B2B, e-commerce, formation"
                      className="flex-1 min-w-[220px] text-xs border border-gray-300 rounded px-2 py-1" />
                    <button onClick={findAdvertisers} disabled={busy === 'ads' || !adKeywords.trim()}
                      className="text-xs px-2.5 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                      {busy === 'ads' ? '…' : 'Chercher'}
                    </button>
                  </div>
                  <textarea value={companiesText} onChange={(e) => setCompaniesText(e.target.value)} rows={6}
                    placeholder={'Alan\nPennylane\nSpendesk\nQonto\n…'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
                  <div className="flex gap-2">
                    <button onClick={() => sourceCompanies(current.id)} disabled={busy === 'sourceco'}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                      {busy === 'sourceco' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Sourcer ces entreprises
                    </button>
                    <button onClick={() => setShowCompanies(false)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">Fermer</button>
                  </div>
                </div>
              )}

              {/* État de la session d'envoi (GitHub Actions) — pour savoir si ça tourne */}
              {pubStatus?.available && !pubStatus.none && pubStatus.status && (
                <div
                  className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border ${
                    sessionRunning
                      ? 'bg-blue-50 border-blue-200 text-blue-800'
                      : pubStatus.conclusion === 'failure'
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600'
                  }`}
                >
                  {sessionRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      <span className="flex-1">
                        <strong>Session d’envoi en cours</strong> — les messages partent un par un, espacés (4-6 min). Tu peux fermer l’onglet. Mets la campagne en <em>pause</em> (bouton <Power className="w-3 h-3 inline" />) pour couper au prochain tour.
                      </span>
                    </>
                  ) : pubStatus.conclusion === 'failure' ? (
                    <>
                      <XCircle className="w-4 h-4 shrink-0" />
                      <span className="flex-1">Dernière session en échec.</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span className="flex-1">
                        Aucune session en cours. Dernière session <strong>terminée</strong>
                        {pubStatus.started_at ? ` (${formatDistanceToNow(pubStatus.started_at)})` : ''}. Clique « Lancer l’envoi » pour (re)partir.
                      </span>
                    </>
                  )}
                  {pubStatus.html_url && (
                    <a href={pubStatus.html_url} target="_blank" rel="noopener noreferrer" className="underline shrink-0 text-xs">journal</a>
                  )}
                </div>
              )}

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
                  <label className="text-xs font-medium text-gray-600">Cible (ICP) — sert au scoring IA des profils et à l&apos;accroche <span className="text-gray-400">(vide = contexte SEO par défaut)</span></label>
                  <textarea value={sIcp} onChange={(e) => { setSIcp(e.target.value); setDirty(true) }} rows={2} placeholder="ex. Dirigeants ou RH de PME 11-200 salariés (agences, cabinets comptables, ESN) pour une formation IA financée par l'OPCO" className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Message initial · <span className="text-gray-400">{'{prenom}'} · {'{entreprise}'} · {'{accroche}'} (1re ligne IA) · versions séparées par une ligne <code>===</code> = rotation aléatoire</span></label>
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
                <div>
                  <label className="text-xs font-medium text-gray-600">Plage horaire d&apos;envoi (heure de Paris) — jamais de DM en dehors</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="number" min={0} max={23} value={sHourStart} onChange={(e) => { setSHourStart(e.target.value); setDirty(true) }} className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                    <span className="text-sm text-gray-400">h  →</span>
                    <input type="number" min={0} max={23} value={sHourEnd} onChange={(e) => { setSHourEnd(e.target.value); setDirty(true) }} className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                    <span className="text-sm text-gray-400">h  (ex. 9 → 18)</span>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  L&apos;espacement entre 2 envois (~4-6 min, comme un humain) est géré automatiquement par la session
                  d&apos;envoi + les garde-fous anti-ban. Un profil déjà présent dans une campagne n&apos;est jamais re-sourcé ailleurs.
                </p>
              </div>

              {/* Filtre : nom + tagline. Les actions groupées respectent le filtre. */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Filter className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input value={filter} onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filtrer par nom ou tagline (ex. « seo », « agence »)…"
                    className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:border-blue-400 focus:outline-none" />
                  {filter && (
                    <button onClick={() => setFilter('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 shrink-0 cursor-pointer select-none">
                  <input type="checkbox" checked={foundersOnly} onChange={(e) => setFoundersOnly(e.target.checked)} />
                  Fondateurs seulement
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 shrink-0 cursor-pointer select-none" title="Masque freelance / agence / consultant / fractional / part-time / externalisé + faux CMO (medical, CRO)">
                  <input type="checkbox" checked={hideProviders} onChange={(e) => setHideProviders(e.target.checked)} />
                  Masquer les prestataires
                </label>
                {(f || foundersOnly || hideProviders) && <span className="text-xs text-gray-500 shrink-0">{toValidate.length}/{sourcedTotal}</span>}
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
                    <button onClick={() => banTarget(t)} title="Ne plus jamais contacter (toutes campagnes)" className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">
                      🚫
                    </button>
                  </>
                )}
                empty="Rien à valider. Clique « Sourcer » pour récupérer les profils de la recherche."
              />

              {/* EN FILE (approuvés) */}
              <TargetTable
                title="En file d'attente d'envoi" tone="blue" rows={approved} busy={busy}
                bulk={approved.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button onClick={cleanQueue} disabled={busy === 'bulk'}
                      title="Retire de la file les prestataires, faux CMO (medical/CRO) et commerciaux"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                      <XCircle className="w-3.5 h-3.5" /> Nettoyer la file
                    </button>
                    {(f || foundersOnly || hideProviders) && (
                      <button onClick={() => bulkStatus('approved', 'skipped')} disabled={busy === 'bulk'}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        <XCircle className="w-3.5 h-3.5" /> Retirer les {approved.length} affichés
                      </button>
                    )}
                  </div>
                )}
                rowActions={(t) => (
                  <button onClick={() => setStatus(t, 'skipped')} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">
                    <XCircle className="w-3.5 h-3.5" /> Retirer
                  </button>
                )}
                empty="Personne en file. Garde des profils depuis « À valider »."
              />

              {/* SUIVI (envoyés / répondu / terminé) — avec filtre par statut */}
              <div className="mt-4">
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  {([
                    ['all', `Tous (${rest.length})`],
                    ['invited', `📨 Invités (${rest.filter((t) => t.status === 'invited').length})`],
                    ['connected', `🤝 Connectés (${rest.filter((t) => t.status === 'connected').length})`],
                    ['msg1_sent', `Msg 1 (${rest.filter((t) => t.status === 'msg1_sent').length})`],
                    ['msg2_sent', `Relancés (${rest.filter((t) => t.status === 'msg2_sent').length})`],
                    ['replied', `💬 Ont répondu (${rest.filter((t) => t.status === 'replied').length})`],
                    ['done', `Terminés (${rest.filter((t) => t.status === 'done').length})`],
                    ['skipped', `Écartés (${rest.filter((t) => t.status === 'skipped').length})`],
                    ['error', `Erreurs (${rest.filter((t) => t.status === 'error').length})`],
                  ] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setRestStatus(v)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${restStatus === v ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <TargetTable title="Suivi" tone="slate"
                  rows={restStatus === 'all' ? rest : rest.filter((t) => t.status === restStatus)}
                  busy={busy} empty="Rien d'envoyé pour l'instant." />
              </div>
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
      // Priorité au chat_id (conversation LinkedIn directe) ; sinon le fil CRM.
      const url = t.history.chat_id
        ? `/api/outreach/thread?chat_id=${encodeURIComponent(t.history.chat_id)}`
        : `/api/contacts/${t.history.contact_id}/thread`
      const d = await fetch(url).then((r) => r.json()).catch(() => [])
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
