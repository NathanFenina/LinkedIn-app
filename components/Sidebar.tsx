'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { MessageSquare, Users, Eye, FileText, Link as LinkIcon, Target, Briefcase, Magnet, UserPlus2, Zap, BookOpen, MessageCircle, Send, FileSearch, Gauge, ChevronDown, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountSwitcher } from './AccountSwitcher'
import { LimitsBadge } from './LimitsBadge'

type NavItem = {
  href: string
  label: string
  icon: typeof MessageSquare
  disabled?: boolean
  group?: string
}

type Item = NavItem & { secondary?: boolean }

const NAV: Item[] = [
  // — Primaire : 8 onglets, 3 groupes clairs —
  { href: '/cockpit', label: 'Cockpit', icon: Gauge, group: 'PILOTER' },
  { href: '/outreach', label: 'Séquenceur', icon: Send, group: 'PROSPECTER' },
  { href: '/lead-magnets', label: 'Lead magnets', icon: Magnet, group: 'PROSPECTER' },
  { href: '/audits', label: 'Audits ciblés', icon: FileSearch, group: 'PROSPECTER' },
  { href: '/comments', label: 'Commentaires auto', icon: MessageCircle, group: 'PROSPECTER' },
  { href: '/facebook-leads', label: 'Artisans BTP', icon: Phone, group: 'PROSPECTER' },
  { href: '/', label: 'CRM (leads)', icon: Users, group: 'GÉRER' },
  { href: '/messagerie', label: 'Messagerie', icon: MessageSquare, group: 'GÉRER' },
  { href: '/invitations', label: 'Invitations', icon: UserPlus2, group: 'GÉRER' },
  // — Secondaire : rangé sous « Plus » (rien n'est supprimé) —
  { href: '/prospection', label: 'Prospection', icon: Target, secondary: true },
  { href: '/connections', label: 'Connexions', icon: LinkIcon, secondary: true },
  { href: '/visitors', label: 'Visiteurs', icon: Eye, secondary: true },
  { href: '/signals', label: 'Signaux', icon: Target, secondary: true },
  { href: '/jobs', label: 'Jobs', icon: Briefcase, secondary: true },
  { href: '/competitor', label: 'Outreach concurrent', icon: UserPlus2, secondary: true },
  { href: '/templates', label: 'Templates', icon: FileText, secondary: true },
  { href: '/automations', label: 'Automations', icon: Zap, secondary: true },
]

const PRIMARY_GROUPS = ['PILOTER', 'PROSPECTER', 'GÉRER'] as const

export function Sidebar() {
  const pathname = usePathname()
  const [showMore, setShowMore] = useState(false)

  const linkClass = (href: string) => {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
    return cn(
      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
      active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
    )
  }

  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-white h-screen sticky top-0 flex flex-col">
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <LinkIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-sm leading-none">LinkedIn CRM</h1>
            <p className="text-[10px] text-gray-400 mt-0.5">Setting B2B</p>
          </div>
        </div>
        <AccountSwitcher />
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {PRIMARY_GROUPS.map((group) => (
          <div key={group} className="pt-2 first:pt-0">
            <div className="px-3 py-1 text-[10px] font-bold text-gray-400 tracking-widest">{group}</div>
            {NAV.filter((n) => n.group === group).map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={linkClass(href)}>
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </div>
        ))}

        {/* Plus — outils secondaires, repliés par défaut */}
        <div className="pt-3">
          <button
            onClick={() => setShowMore((s) => !s)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50"
          >
            <ChevronDown className={cn('w-4 h-4 transition-transform', showMore ? 'rotate-180' : '')} />
            <span className="flex-1 text-left">Plus</span>
          </button>
          {showMore && (
            <div className="mt-0.5">
              {NAV.filter((n) => n.secondary).map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={linkClass(href)}>
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      <LimitsBadge />

      <div className="p-2 border-t border-gray-100">
        <Link
          href="/how-to-work"
          className={cn(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
            pathname.startsWith('/how-to-work')
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          )}
        >
          <BookOpen className="w-4 h-4" />
          Comment utiliser l&apos;app
        </Link>
      </div>
    </aside>
  )
}
