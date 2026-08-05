'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare, Users, Eye, FileText, Link as LinkIcon, Target, Briefcase, Magnet, UserPlus2, Zap, BookOpen, MessageCircle, LayoutDashboard } from 'lucide-react'
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

const NAV: NavItem[] = [
  { href: '/pilotage', label: 'À faire aujourd\'hui', icon: LayoutDashboard, group: 'PILOTAGE' },
  { href: '/messagerie', label: 'Messagerie', icon: MessageSquare, group: 'MESSAGES' },
  { href: '/invitations', label: 'Invitations', icon: UserPlus2, group: 'MESSAGES' },
  { href: '/', label: 'CRM (leads)', icon: Users, group: 'CRM' },
  { href: '/connections', label: 'Connexions', icon: LinkIcon, group: 'CRM' },
  { href: '/visitors', label: 'Visiteurs', icon: Eye, group: 'CRM' },
  { href: '/comments', label: 'Commentaires auto', icon: MessageCircle, group: 'OUTREACH' },
  { href: '/signals', label: 'Signaux', icon: Target, group: 'OUTREACH' },
  { href: '/jobs', label: 'Jobs', icon: Briefcase, group: 'OUTREACH' },
  { href: '/lead-magnets', label: 'Lead magnets', icon: Magnet, group: 'OUTREACH' },
  { href: '/competitor', label: 'Outreach concurrent', icon: UserPlus2, group: 'OUTREACH' },
  { href: '/templates', label: 'Templates', icon: FileText, group: 'CONFIG' },
  { href: '/automations', label: 'Automations', icon: Zap, group: 'CONFIG' },
]

export function Sidebar() {
  const pathname = usePathname()

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
        {(['PILOTAGE', 'MESSAGES', 'CRM', 'OUTREACH', 'CONFIG'] as const).map((group) => (
          <div key={group} className="pt-2 first:pt-0">
            <div className="px-3 py-1 text-[10px] font-bold text-gray-400 tracking-widest">{group}</div>
            {NAV.filter((n) => n.group === group).map(({ href, label, icon: Icon, disabled }) => {
              const active = !disabled && (href === '/' ? pathname === '/' : pathname.startsWith(href))
              if (disabled) {
                return (
                  <div
                    key={href}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-300 cursor-not-allowed"
                    title="Bientôt"
                  >
                    <Icon className="w-4 h-4" />
                    <span className="flex-1">{label}</span>
                    <span className="text-[9px] uppercase bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">soon</span>
                  </div>
                )
              }
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                    active
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              )
            })}
          </div>
        ))}
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
