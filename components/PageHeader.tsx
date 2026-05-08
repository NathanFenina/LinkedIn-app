'use client'

import { SyncBar } from './SyncBar'

interface PageHeaderProps {
  title: string
  subtitle?: string
  onSynced: () => void
  right?: React.ReactNode
}

export function PageHeader({ title, subtitle, onSynced, right }: PageHeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-semibold text-gray-900 text-base leading-tight">{title}</h1>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {right}
          <SyncBar onSynced={onSynced} />
        </div>
      </div>
    </header>
  )
}
