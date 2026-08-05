'use client'

import { useEffect, useState, useCallback } from 'react'
import { UserPlus2, Sparkles, Check, X, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface Invitation {
  id: string
  name: string | null
  headline: string | null
  provider_id: string | null
  public_identifier: string | null
  message: string | null
  date: string | null
  shared_secret: string | null
}

export default function InvitationsPage() {
  const [invites, setInvites] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const fetchInvites = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/invitations').then((r) => r.json())
      if (Array.isArray(data)) setInvites(data)
      else setMsg(`Erreur: ${data.error || 'chargement impossible'}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvites()
  }, [fetchInvites])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allSelected = invites.length > 0 && selected.size === invites.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(invites.map((i) => i.id)))

  const draftFor = useCallback(async (inv: Invitation): Promise<string | null> => {
    const res = await fetch('/api/invitations/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: inv.name, headline: inv.headline, invitation_text: inv.message }),
    })
    const data = await res.json()
    if (data.text) {
      setDrafts((prev) => ({ ...prev, [inv.id]: data.text }))
      return data.text
    }
    return null
  }, [])

  const prepareOne = async (inv: Invitation) => {
    setBusyId(inv.id)
    setMsg('Génération du message…')
    await draftFor(inv)
    setBusyId(null)
    setMsg('')
  }

  const prepareSelected = async () => {
    const todo = invites.filter((i) => selected.has(i.id) && !drafts[i.id]).slice(0, 15)
    if (todo.length === 0) return
    setBulkBusy(true)
    setMsg(`Préparation de ${todo.length} message(s)… (rien n'est envoyé)`)
    for (const inv of todo) await draftFor(inv).catch(() => null)
    setBulkBusy(false)
    setMsg(`${todo.length} message(s) prêt(s). Relis, édite, puis accepte + envoie.`)
  }

  const handle = async (inv: Invitation, action: 'accept' | 'decline', withMessage: boolean) => {
    const res = await fetch(`/api/invitations/${inv.id}/handle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        shared_secret: inv.shared_secret,
        provider_id: inv.provider_id,
        message: withMessage ? (drafts[inv.id] || '').trim() : undefined,
      }),
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error || res.statusText)
    setInvites((prev) => prev.filter((i) => i.id !== inv.id))
    setSelected((prev) => {
      const n = new Set(prev)
      n.delete(inv.id)
      return n
    })
    return data
  }

  const accept = async (inv: Invitation, withMessage: boolean) => {
    if (withMessage && !(drafts[inv.id] || '').trim()) {
      setMsg('Erreur: prépare/écris le message avant d\'accepter + envoyer.')
      return
    }
    setBusyId(inv.id)
    setMsg('')
    try {
      const r = await handle(inv, 'accept', withMessage)
      setMsg(`${inv.name} accepté${withMessage ? (r.messaged ? ' + message envoyé ✅' : ' (message non envoyé)') : ''} ✅`)
    } catch (e) {
      setMsg(`Erreur: ${String(e)}`)
    } finally {
      setBusyId(null)
    }
  }

  const decline = async (inv: Invitation) => {
    if (!confirm(`Décliner l'invitation de ${inv.name} ?`)) return
    setBusyId(inv.id)
    try {
      await handle(inv, 'decline', false)
      setMsg(`Invitation de ${inv.name} déclinée.`)
    } catch (e) {
      setMsg(`Erreur: ${String(e)}`)
    } finally {
      setBusyId(null)
    }
  }

  const bulkAccept = async (withMessage: boolean) => {
    const targets = invites.filter((i) => selected.has(i.id) && (!withMessage || (drafts[i.id] || '').trim()))
    if (targets.length === 0) {
      setMsg(withMessage ? 'Aucun message préparé dans la sélection.' : 'Sélectionne des invitations.')
      return
    }
    if (!confirm(`Accepter ${targets.length} invitation(s)${withMessage ? ' + envoyer les messages' : ''} ?`)) return
    setBulkBusy(true)
    let ok = 0
    for (const inv of targets) {
      try {
        await handle(inv, 'accept', withMessage)
        ok++
        setMsg(`${ok}/${targets.length} traité(s)…`)
        await new Promise((r) => setTimeout(r, 1500)) // petit délai anti-flag
      } catch {
        /* on continue */
      }
    }
    setBulkBusy(false)
    setMsg(`${ok} invitation(s) acceptée(s)${withMessage ? ' + message envoyé' : ''}.`)
  }

  const isError = msg.toLowerCase().startsWith('erreur')

  return (
    <>
      <header className="bg-white/90 backdrop-blur border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1000px] mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm">
              <UserPlus2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 text-base leading-tight">Invitations reçues</h1>
              <p className="text-xs text-gray-500">Accepte (avec un message perso si tu veux), à l&apos;unité ou en groupe. Rien n&apos;est envoyé sans ton clic.</p>
            </div>
          </div>
          <button onClick={fetchInvites} disabled={loading}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
          </button>
        </div>
      </header>

      <div className="max-w-[1000px] mx-auto px-6 py-6 space-y-4">
        {invites.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-gray-600 mr-1">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              {selected.size > 0 ? `${selected.size} sélectionnée(s)` : 'Tout sélectionner'}
            </label>
            <div className="h-4 w-px bg-gray-200 mx-1" />
            <button disabled={bulkBusy || selected.size === 0} onClick={prepareSelected}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
              {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Préparer les messages (sél.)
            </button>
            <button disabled={bulkBusy || selected.size === 0} onClick={() => bulkAccept(false)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-40">
              <Check className="w-3.5 h-3.5" /> Accepter la sélection
            </button>
            <button disabled={bulkBusy || selected.size === 0} onClick={() => bulkAccept(true)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
              <Check className="w-3.5 h-3.5" /> Accepter + envoyer (sél.)
            </button>
          </div>
        )}

        {msg && (
          <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 border ${isError ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
            {isError ? <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />}
            <span className="flex-1">{msg}</span>
            <button onClick={() => setMsg('')} className="opacity-50 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {loading && invites.length === 0 && <div className="text-center text-sm text-gray-400 py-10">Chargement…</div>}

        {!loading && invites.length === 0 && (
          <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-white">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-gray-600 font-medium">Aucune invitation en attente 🎉</p>
          </div>
        )}

        {invites.map((inv) => (
          <section key={inv.id} className={`bg-white border rounded-xl p-4 shadow-sm ${selected.has(inv.id) ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-900 text-sm truncate">{inv.name || 'Inconnu'}</h2>
                  {inv.date && <span className="text-[10px] text-gray-400">{formatDistanceToNow(inv.date)}</span>}
                </div>
                {inv.headline && <p className="text-[12px] text-gray-500 truncate">{inv.headline}</p>}
                {inv.message && (
                  <p className="text-[13px] text-gray-600 mt-1 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
                    <span className="text-[10px] uppercase text-gray-400 font-semibold mr-1">note</span>{inv.message}
                  </p>
                )}
              </div>
              {inv.public_identifier && (
                <a href={`https://www.linkedin.com/in/${inv.public_identifier}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-blue-600 inline-flex items-center gap-1 shrink-0 hover:underline">
                  profil <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>

            {drafts[inv.id] !== undefined && (
              <div className="mt-3 ml-7">
                <div className="text-[10px] font-bold uppercase text-blue-600 mb-1">Message de bienvenue — édite librement</div>
                <textarea value={drafts[inv.id]} onChange={(e) => setDrafts((p) => ({ ...p, [inv.id]: e.target.value }))} rows={3}
                  className="w-full text-sm text-gray-900 border border-gray-200 rounded-lg p-2.5 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none" />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3 ml-7">
              <button disabled={busyId === inv.id} onClick={() => accept(inv, false)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-40">
                {busyId === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accepter
              </button>
              {drafts[inv.id] === undefined ? (
                <button disabled={busyId === inv.id} onClick={() => prepareOne(inv)}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                  <Sparkles className="w-3.5 h-3.5" /> Préparer un message
                </button>
              ) : (
                <button disabled={busyId === inv.id || !drafts[inv.id]?.trim()} onClick={() => accept(inv, true)}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
                  <Check className="w-3.5 h-3.5" /> Accepter + envoyer
                </button>
              )}
              <button disabled={busyId === inv.id} onClick={() => decline(inv)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-200 text-gray-400 rounded-lg hover:bg-red-50 hover:text-red-600 ml-auto disabled:opacity-40">
                <X className="w-3.5 h-3.5" /> Décliner
              </button>
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
