'use client'

import { useEffect, useState } from 'react'
import { Send, Clock, Trash2, ExternalLink, Check, RefreshCw, RotateCcw, Tag } from 'lucide-react'

// PLUG — « À valider » : toutes les actions préparées, une carte par personne.
// Nathan modifie le message, met un statut, supprime ou envoie. Rien ne part
// sans clic ; les envois sont espacés par le cron plug-send.

interface Action {
  id: string; type: string; status: string; tag: string | null
  person_name: string | null; headline: string | null; company: string | null
  profile_url: string | null; title: string | null; context: string | null; url: string | null
  score: number | null; message: string | null; template_key: string | null
  note: string | null; error: string | null; sent_at: string | null; replied_at: string | null; reply_text: string | null; created_at: string
}

const TYPES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'reply', label: '💬 Réponses à traiter', hint: 'Ils t’ont écrit, tu n’as pas répondu' },
  { key: 'engager_dm', label: '👥 Engageurs 1er degré', hint: 'Message personnalisé (question ChatGPT + concurrents) — vérifie dans ChatGPT avant d’envoyer' },
  { key: 'engager_invite', label: '➕ Engageurs 2e degré', hint: 'Invitation sans note ; le message arrive ici quand elle est acceptée' },
  { key: 'relance', label: '🔁 Relances', hint: 'Ton dernier message est resté sans réponse' },
  { key: 'mission', label: '💼 Missions', hint: 'Posts / offres pour postuler (Ouvrir puis Fait)' },
  { key: 'lk_comment', label: '📝 Posts LinkedIn à commenter', hint: 'Commentaire proposé à copier (Ouvrir puis Fait)' },
  { key: 'x_reply', label: '🐦 Posts X à commenter', hint: '« Répondre » ouvre X avec le texte prérempli' },
]
const SENDABLE = ['engager_dm', 'engager_invite', 'relance', 'reply']
const TAGS = ['🔥 Chaud', 'RDV', 'Pas maintenant', 'Client', 'Partenaire', 'Pas intéressé']
const VIEWS: Array<{ key: string; label: string }> = [
  { key: 'todo', label: 'À valider' }, { key: 'queued', label: 'En file d’envoi' }, { key: 'later', label: 'Plus tard' },
  { key: 'history', label: 'Envoyés / faits' }, { key: 'dismissed', label: 'Supprimés' },
]

export default function PlugPage() {
  const [view, setView] = useState('todo')
  const [type, setType] = useState('')
  const [actions, setActions] = useState<Action[]>([])
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const p = new URLSearchParams({ status: view })
    if (type) p.set('type', type)
    fetch(`/api/plug/actions?${p}`).then((x) => x.json()).then((r) => {
      if (!alive) return
      if (r.error) setErr(r.error)
      setActions(r.actions || [])
      setCounts(r.counts || {})
    })
    return () => { alive = false }
  }, [view, type, tick])
  const reload = () => setTick((t) => t + 1)

  async function act(a: Action, op: string, extra: Record<string, unknown> = {}) {
    setBusy(a.id); setErr('')
    const message = drafts[a.id] ?? a.message ?? ''
    const r = await fetch(`/api/plug/actions/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, message, ...extra }),
    }).then((x) => x.json())
    setBusy(null)
    if (r.error) return setErr(r.error)
    if (op === 'save' || op === 'tag' || op === 'note') return reload()
    setActions((xs) => xs.filter((x) => x.id !== a.id))
    reload()
  }

  const todoCounts = counts[view === 'history' ? 'sent' : view] || {}
  const xIntent = (a: Action) => {
    const id = (a.url || '').split('/').pop() || ''
    return `https://x.com/intent/post?in_reply_to=${id}&text=${encodeURIComponent(drafts[a.id] ?? a.message ?? '')}`
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">À valider</h1>
          <p className="text-xs text-gray-500">Modifie, mets un statut, supprime ou envoie. Les envois partent un par un, espacés de 2 à 4 min.</p>
        </div>
        <button onClick={reload} className="p-2 rounded-lg hover:bg-gray-100" aria-label="Rafraîchir"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1.5 rounded-full text-xs border ${view === v.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
            {v.label}{counts[v.key] ? ` · ${Object.values(counts[v.key]).reduce((s, n) => s + n, 0)}` : ''}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button onClick={() => setType('')} className={`px-2.5 py-1 rounded-lg text-xs ${!type ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>Tout</button>
        {TYPES.map((t) => (
          <button key={t.key} onClick={() => setType(t.key)} className={`px-2.5 py-1 rounded-lg text-xs ${type === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {t.label}{todoCounts[t.key] ? ` (${todoCounts[t.key]})` : ''}
          </button>
        ))}
      </div>
      {type && <p className="text-xs text-gray-500 mb-3">{TYPES.find((t) => t.key === type)?.hint}</p>}
      {err && <div className="mb-3 p-2 rounded bg-red-50 text-red-700 text-sm">{err}</div>}
      {!actions.length && <div className="p-8 text-center text-sm text-gray-400 border border-dashed rounded-xl">Rien ici pour l’instant.</div>}

      <div className="space-y-3">
        {actions.map((a) => {
          const t = TYPES.find((x) => x.key === a.type)
          const sendable = SENDABLE.includes(a.type)
          const msg = drafts[a.id] ?? a.message ?? ''
          return (
            <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-400">{t?.label || a.type}{a.score != null ? ` · ${a.type === 'mission' ? `score ${a.score}/100` : a.type === 'lk_comment' ? `${a.score} réactions` : `note ${a.score}`}` : ''}{a.tag ? ` · ${a.tag}` : ''}</div>
                  <div className="font-semibold text-gray-900 truncate">
                    {a.profile_url ? <a href={a.profile_url} target="_blank" rel="noreferrer" className="hover:underline">{a.person_name || 'Profil'}</a> : a.person_name || a.title}
                  </div>
                  {a.headline && <div className="text-xs text-gray-500 truncate">{a.headline}{a.company ? ` · ${a.company}` : ''}</div>}
                  {a.title && a.person_name && <div className="text-xs text-gray-600 mt-0.5">{a.title}</div>}
                </div>
                <select value={a.tag || ''} onChange={(e) => act(a, 'tag', { tag: e.target.value })} className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 shrink-0" aria-label="Statut">
                  <option value="">Statut…</option>
                  {TAGS.map((tg) => <option key={tg} value={tg}>{tg}</option>)}
                  {a.tag && !TAGS.includes(a.tag) && <option value={a.tag}>{a.tag}</option>}
                </select>
              </div>

              <input value={notes[a.id] ?? a.note ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                onBlur={() => { if (notes[a.id] !== undefined && notes[a.id] !== (a.note ?? '')) act(a, 'note', { note: notes[a.id] }) }}
                placeholder="Remarque (ex. vu au salon, rappeler en janvier…)" className="mt-2 w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
              {a.context && <pre className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">{a.context}</pre>}
              {a.profile_url && <div className="mt-1 text-[11px] text-gray-400 break-all select-all">{a.profile_url}</div>}
              {a.url && <div className="mt-1 text-[11px] text-gray-400 break-all select-all">{a.url}</div>}

              {a.type !== 'engager_invite' && (a.message !== null || sendable) && (
                <textarea value={msg} onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                  rows={Math.min(8, Math.max(3, Math.ceil(msg.length / 80)))}
                  className="mt-2 w-full text-sm border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder={a.type === 'mission' ? 'Pourquoi cette mission' : 'Message'} />
              )}
              {a.type === 'engager_invite' && <div className="mt-2 text-xs text-gray-500">Invitation sans note. Le message personnalisé reviendra ici une fois acceptée.</div>}
              {a.error && <div className="mt-1 text-xs text-red-600">{a.error}</div>}
              {a.reply_text && <div className="mt-1 text-xs text-green-700">↩︎ Réponse : {a.reply_text}</div>}

              <div className="mt-3 flex flex-wrap gap-2">
                {view === 'todo' || view === 'later' ? (
                  <>
                    {sendable && (
                      <button disabled={busy === a.id} onClick={() => act(a, 'send')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs disabled:opacity-50">
                        <Send className="w-3.5 h-3.5" />{a.type === 'engager_invite' ? 'Inviter' : 'Envoyer'}
                      </button>
                    )}
                    {a.type === 'x_reply' && <a href={xIntent(a)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black text-white text-xs"><ExternalLink className="w-3.5 h-3.5" />Répondre</a>}
                    {(a.type === 'mission' || a.type === 'lk_comment') && a.url && <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs"><ExternalLink className="w-3.5 h-3.5" />Ouvrir</a>}
                    {!sendable && <button disabled={busy === a.id} onClick={() => act(a, 'done')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs"><Check className="w-3.5 h-3.5" />Fait</button>}
                    {drafts[a.id] !== undefined && <button disabled={busy === a.id} onClick={() => act(a, 'save')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs"><Tag className="w-3.5 h-3.5" />Enregistrer</button>}
                    {view === 'todo' && <button disabled={busy === a.id} onClick={() => act(a, 'later')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs"><Clock className="w-3.5 h-3.5" />Plus tard</button>}
                    <button disabled={busy === a.id} onClick={() => act(a, 'dismiss')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs text-red-600"><Trash2 className="w-3.5 h-3.5" />Supprimer</button>
                  </>
                ) : (
                  <button disabled={busy === a.id} onClick={() => act(a, 'reopen')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs"><RotateCcw className="w-3.5 h-3.5" />Remettre à valider</button>
                )}
                {a.sent_at && <span className="text-[11px] text-gray-400 self-center">Envoyé le {new Date(a.sent_at).toLocaleString('fr-FR')}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
