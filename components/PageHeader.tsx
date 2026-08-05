'use client'

import { SyncBar } from './SyncBar'
import { HelpButton } from './HelpButton'
import type { HOW_TO_SECTIONS } from '@/lib/how-to-work-sections'

interface PageHeaderProps {
  title: string
  subtitle?: string
  onSynced: () => void
  right?: React.ReactNode
  helpSectionId?: keyof typeof HOW_TO_SECTIONS
}

export function PageHeader({ title, subtitle, onSynced, right, helpSectionId }: PageHeaderProps) {
  return (
    <header className="bg-white/90 backdrop-blur border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div>
            <h1 className="font-semibold text-gray-900 text-base leading-tight">{title}</h1>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
          {helpSectionId && <HelpButton sectionId={helpSectionId} />}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {right}
          <SyncBar onSynced={onSynced} />
        </div>
      </div>
    </header>
  )
}
