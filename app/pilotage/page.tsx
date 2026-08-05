'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, UserPlus2, MessageCircle, Eye, ArrowRight, ShieldCheck } from 'lucide-react'

interface Counts {
  toReply: number | null
  invitations: number | null
  draftComments: number | null
  visitors: number | null
}

export default function PilotagePage() {
  const [c, setC] = useState<Counts>({ toReply: null, invitations: null, draftComments: null, visitors: null })

  useEffect(() => {
    fetch('/api/contacts?tab=conversations').then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setC((p) => ({ ...p, toReply: d.filter((x) => !x.is_sender_last).length }))
    }).catch(() => {})
    fetch('/api/invitations').then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setC((p) => ({ ...p, invitations: d.length }))
    }).catch(() => {})
    fetch('/api/comment-campaigns').then((r) => r.json()).then(async (camps) => {
      if (!Array.isArray(camps)) return
      let drafts = 0
      for (const camp of camps.filter((x) => x.active)) {
        const detail = await fetch(`/api/comment-campaigns/${camp.id}`).then((r) => r.json()).catch(() => null)
        if (detail?.sends) drafts += detail.sends.filter((s: { status: string }) => s.status === 'draft').length
      }
      setC((p) => ({ ...p, draftComments: drafts }))
    }).catch(() => {})
    fetch('/api/visitors').then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setC((p) => ({ ...p, visitors: d.filter((x: { invited_at?: string | null; score?: number }) => !x.invited_at && (x.score || 0) >= 7).length }))
    }).catch(() => {})
  }, [])

  const cards = [
    { href: '/messagerie', icon: MessageSquare, label: 'Messages à répondre', count: c.toReply, cta: 'Ouvrir la messagerie', color: 'blue' },
    { href: '/invitations', icon: UserPlus2, label: 'Invitations reçues', count: c.invitations, cta: 'Traiter les invitations', color: 'violet' },
    { href: '/comments', icon: MessageCircle, label: 'Brouillons de commentaires', count: c.draftComments, cta: 'Revoir les brouillons', color: 'amber' },
    { href: '/visitors', icon: Eye, label: 'Visiteurs à inviter (top)', count: c.visitors, cta: 'Voir les visiteurs', color: 'emerald' },
  ] as const

  const colorCls: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  }

  return (
    <>
      <header className="bg-white/90 backdrop-blur border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-3">
          <h1 className="font-semibold text-gray-900 text-base leading-tight">À faire aujourd&apos;hui</h1>
          <p className="text-xs text-gray-500">Ton point de départ : ce qui t&apos;attend, en un coup d&apos;œil.</p>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {cards.map(({ href, icon: Icon, label, count, cta, color }) => (
            <Link key={href} href={href}
              className="group bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-gray-300 transition flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${colorCls[color]}`}>
                <Icon className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-3xl font-bold text-gray-900 leading-none">
                  {count === null ? <span className="text-gray-200">–</span> : count}
                </div>
                <div className="text-sm text-gray-600 mt-0.5">{label}</div>
              </div>
              <span className="text-xs text-gray-400 group-hover:text-blue-600 inline-flex items-center gap-1 shrink-0">
                {cta} <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-green-500 shrink-0" />
          <p className="text-xs text-gray-600">
            <b>Garde-fous LinkedIn actifs.</b> Tes actions du jour sont plafonnées automatiquement (voir la jauge en bas de la barre latérale) pour protéger ton compte. Au plafond, l&apos;envoi est bloqué.
          </p>
        </div>
      </div>
    </>
  )
}
