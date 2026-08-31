'use client'

import { useEffect, useState, useCallback } from 'react'
import { AuditTarget } from '@/types'
import { Plus, Search, Send, Trash2, ExternalLink, Loader2, Check, ChevronDown } from 'lucide-react'

interface Candidate {
  provider_id: string | null
  name: string | null
  headline: string | null
  profile_url: string | null
  location: string | null
  connected?: boolean
  recommended?: boolean
  score: number
}

const DEFAULT_TEMPLATE = `Bonjour {prenom},

Je suis Nathan, fondateur de Decupler. On aide les marques à ressortir dans les réponses des IA (ChatGPT, Perplexity, Google AI Overviews) — le réflexe qu'ont désormais les gens avant d'acheter un complément.

J'ai regardé comment {boite} apparaît sur ces IA et je vous ai préparé un petit audit GEO : {lien}

Si le sujet vous parle, on en discute avec plaisir 🙂`

const SEED_COMPANIES = `Arkopharma https://nathanfenina.github.io/decupler-proposals/arkopharma/
PiLeJe https://nathanfenina.github.io/decupler-proposals/pileje/
Nutergia https://nathanfenina.github.io/decupler-proposals/nutergia/
Forté Pharma https://nathanfenina.github.io/decupler-proposals/forte-pharma/
Biocyte https://nathanfenina.github.io/decupler-proposals/biocyte/
Nutri&Co https://nathanfenina.github.io/decupler-proposals/nutri-and-co/
Nutripure https://nathanfenina.github.io/decupler-proposals/nutripure/
Novoma https://nathanfenina.github.io/decupler-proposals/novoma/
Nutrimea https://nathanfenina.github.io/decupler-proposals/nutrimea/
UNAE https://nathanfenina.github.io/decupler-proposals/unae/
Les Miraculeux https://nathanfenina.github.io/decupler-proposals/les-miraculeux/
Lashilé Beauty https://nathanfenina.github.io/decupler-proposals/lashile-beauty/
Granions https://nathanfenina.github.io/decupler-proposals/granions/
Eafit https://nathanfenina.github.io/decupler-proposals/eafit/
Vitavea https://nathanfenina.github.io/decupler-proposals/vitavea/
Oenobiol https://nathanfenina.github.io/decupler-proposals/oenobiol/
NHCO Nutrition https://nathanfenina.github.io/decupler-proposals/nhco-nutrition/
Laboratoire Lescuyer https://nathanfenina.github.io/decupler-proposals/laboratoire-lescuyer/
D-LAB Nutricosmetics https://nathanfenina.github.io/decupler-proposals/d-lab-nutricosmetics/
Dynveo https://nathanfenina.github.io/decupler-proposals/dynveo/`

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-500',
  found: 'bg-blue-100 text-blue-700',
  sent: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  skipped: 'bg-amber-100 text-amber-700',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'À trouver',
  found: 'Contact trouvé',
  sent: 'Envoyé',
  error: 'Erreur',
  skipped: 'Écarté',
}

export default function AuditsPage() {
  const [targets, setTargets] = useState<AuditTarget[]>([])
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [showAdd, setShowAdd] = useState(false)
  const [addText, setAddText] = useState(SEED_COMPANIES)

  const fetchTargets = useCallback(async () => {
    const data = await fetch('/api/audits').then((r) => r.json())
    if (Array.isArray(data)) setTargets(data)
  }, [])

  useEffect(() => {
    fetchTargets()
    try {
      const saved = localStorage.getItem('audit_template')
      if (saved) setTemplate(saved)
    } catch {}
  }, [fetchTargets])

  const saveTemplate = (t: string) => {
    setTemplate(t)
    try { localStorage.setItem('audit_template', t) } catch {}
  }

  const addCompanies = async () => {
    if (!addText.trim()) return
    setBusy('add')
    setMsg('')
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: addText }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMsg(`${data.created} boîte(s) ajoutée(s).`)
      setShowAdd(false)
      fetchTargets()
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const findContact = async (id: string) => {
    setBusy(id)
    setMsg('')
    try {
      const res = await fetch(`/api/audits/${id}/find`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCandidates((prev) => ({ ...prev, [id]: data.contacts || [] }))
      if (!data.contacts?.length) setMsg(data.hint || 'Aucun contact trouvé pour cette boîte.')
      else if (data.hint) setMsg(data.hint)
      else setMsg('')
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const pickContact = async (id: string, c: Candidate) => {
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, provider_id: c.provider_id, contact_name: c.name, contact_headline: c.headline, contact_profile_url: c.profile_url, status: 'found' } : t)))
    setCandidates((prev) => { const n = { ...prev }; delete n[id]; return n })
    await fetch(`/api/audits/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: c.provider_id, contact_name: c.name, contact_headline: c.headline, contact_profile_url: c.profile_url, status: 'found' }),
    })
  }

  const send = async (id: string) => {
    if (!confirm('Envoyer le DM d\'audit à ce contact ?')) return
    setBusy(id)
    setMsg('')
    try {
      const res = await fetch(`/api/audits/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'sent', message_sent: data.message } : t)))
      setMsg('DM envoyé ✅')
    } catch (err) {
      setMsg(`Erreur: ${String(err)}`)
      fetchTargets()
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Retirer cette boîte ?')) return
    setTargets((prev) => prev.filter((t) => t.id !== id))
    await fetch(`/api/audits/${id}`, { method: 'DELETE' })
  }

  const sentCount = targets.filter((t) => t.status === 'sent').length

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3">
          <h1 className="font-semibold text-gray-900 text-base leading-tight">Audits ciblés</h1>
          <p className="text-xs text-gray-500">Colle tes boîtes → l&apos;app trouve le bon contact marketing sur LinkedIn → tu valides → envoi du DM d&apos;audit avec ton lien perso.</p>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        {/* Message template */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-900">Message d&apos;audit</h2>
            <span className="text-[11px] text-gray-400">Variables : <code>{'{prenom}'}</code> · <code>{'{boite}'}</code> · <code>{'{lien}'}</code></span>
          </div>
          <textarea
            rows={6}
            value={template}
            onChange={(e) => saveTemplate(e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-2 text-sm resize-y font-mono"
          />
          <p className="text-[11px] text-gray-400">Le même message pour toutes ; seuls le prénom, le nom de la boîte et le lien d&apos;audit changent. Enregistré automatiquement.</p>
        </div>

        {/* Add companies */}
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <button onClick={() => setShowAdd((s) => !s)} className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
            <Plus className="w-4 h-4" /> Ajouter des boîtes <ChevronDown className={`w-3.5 h-3.5 transition ${showAdd ? 'rotate-180' : ''}`} />
          </button>
          {showAdd && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-gray-500">Une boîte par ligne : <code>Nom de la boîte https://lien-audit</code> (ou séparé par une tabulation / un point-virgule).</p>
              <textarea
                rows={8}
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-2 text-xs resize-y font-mono"
              />
              <button onClick={addCompanies} disabled={busy === 'add'} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                {busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Ajouter à la liste
              </button>
            </div>
          )}
        </div>

        {msg && <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">{msg}</div>}

        {/* Progress */}
        {targets.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span className="font-medium">{sentCount} / {targets.length} envoyés</span>
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-xs">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${targets.length ? (sentCount / targets.length) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {targets.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Aucune boîte. Ajoute-en ci-dessus.</div>
          ) : (
            targets.map((t) => {
              const cands = candidates[t.id]
              return (
                <div key={t.id} className="p-3">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900">{t.company}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[t.status] || STATUS_BADGE.pending}`}>{STATUS_LABEL[t.status] || t.status}</span>
                        {t.audit_url && (
                          <a href={t.audit_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5">audit <ExternalLink className="w-2.5 h-2.5" /></a>
                        )}
                      </div>
                      {t.contact_name ? (
                        <div className="text-xs text-gray-600 mt-0.5">
                          <span className="font-medium">{t.contact_name}</span>
                          {t.contact_headline ? <span className="text-gray-400"> — {t.contact_headline}</span> : null}
                          {t.contact_profile_url && (
                            <a href={t.contact_profile_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">profil</a>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-400 mt-0.5">Aucun contact choisi</div>
                      )}
                      {t.status === 'error' && t.error && <div className="text-[11px] text-red-500 mt-0.5">{t.error}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 flex-wrap">
                      <button onClick={() => findContact(t.id)} disabled={busy === t.id} className="text-[11px] px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 inline-flex items-center gap-1">
                        {busy === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} {t.contact_name ? 'Autre contact' : 'Trouver le contact'}
                      </button>
                      <button onClick={() => send(t.id)} disabled={busy === t.id || !t.provider_id || t.status === 'sent'} className="text-[11px] px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
                        <Send className="w-3 h-3" /> Envoyer
                      </button>
                      <button onClick={() => remove(t.id)} className="text-[11px] px-1.5 py-1 text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>

                  {/* Candidates */}
                  {cands && cands.length > 0 && (
                    <div className="mt-2 bg-gray-50 rounded p-2 space-y-1">
                      <p className="text-[11px] font-medium text-gray-700">Choisis le bon contact <span className="text-gray-400 font-normal">— ★ = mon choix recommandé</span> :</p>
                      {cands.map((c, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-2 text-[11px] px-2 py-1.5 rounded border ${
                            c.recommended ? 'bg-green-50 border-green-300' : 'border-transparent hover:bg-blue-50 hover:border-blue-200'
                          }`}
                        >
                          <button onClick={() => pickContact(t.id, c)} className="text-left flex items-start gap-2 min-w-0 flex-1" title="Choisir ce contact">
                            {c.recommended ? <span className="text-yellow-500 mt-0.5 shrink-0">★</span> : <Check className="w-3 h-3 mt-0.5 text-blue-500 shrink-0" />}
                            <span className="min-w-0">
                              <span className={`font-medium ${c.recommended ? 'text-green-800' : 'text-gray-800'}`}>{c.name || 'Sans nom'}</span>
                              {c.recommended && <span className="ml-1 text-[9px] px-1 py-0.5 rounded-full bg-green-200 text-green-800 font-semibold">recommandé</span>}
                              {c.connected ? (
                                <span className="ml-1 text-[9px] px-1 py-0.5 rounded-full bg-green-100 text-green-700">connecté · DM ok</span>
                              ) : (
                                <span className="ml-1 text-[9px] px-1 py-0.5 rounded-full bg-amber-100 text-amber-700">non connecté</span>
                              )}
                              {c.headline ? <span className="text-gray-500"> — {c.headline}</span> : null}
                              {c.location ? <span className="text-gray-400"> · {c.location}</span> : null}
                            </span>
                          </button>
                          {c.profile_url && (
                            <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-blue-600 hover:underline inline-flex items-center gap-0.5" title="Ouvrir le profil LinkedIn">
                              profil <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      ))}
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
