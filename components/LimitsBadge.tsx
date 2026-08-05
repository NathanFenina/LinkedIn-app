'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert } from 'lucide-react'

interface Usage {
  total: number | null
  globalCap: number
  perType: Array<{ type: string; used: number | null; cap: number; label: string }>
}

// Indicateur de garde-fous LinkedIn : usage du jour vs plafonds (anti-ban).
export function LimitsBadge() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const load = () => fetch('/api/limits').then((r) => r.json()).then((d) => { if (!d.error) setUsage(d) }).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  if (!usage) return null
  const total = usage.total ?? 0
  const pct = Math.min(100, Math.round((total / usage.globalCap) * 100))
  const warn = pct >= 80
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-green-500'

  return (
    <div className="px-3 py-2 border-t border-gray-100">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600 mb-1">
          {warn ? <ShieldAlert className="w-3.5 h-3.5 text-amber-500" /> : <ShieldCheck className="w-3.5 h-3.5 text-green-500" />}
          Garde-fous LinkedIn
          <span className="ml-auto text-gray-400">{total}/{usage.globalCap}</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {usage.perType.map((t) => {
            const u = t.used ?? 0
            const p = Math.min(100, Math.round((u / t.cap) * 100))
            return (
              <div key={t.type} className="text-[10px] text-gray-500">
                <div className="flex justify-between"><span>{t.label}</span><span>{u}/{t.cap}</span></div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${p >= 100 ? 'bg-red-400' : 'bg-blue-400'} rounded-full`} style={{ width: `${p}%` }} />
                </div>
              </div>
            )
          })}
          <p className="text-[9px] text-gray-400 pt-1">Blocage dur au plafond. Se remet à zéro chaque jour (UTC).</p>
        </div>
      )}
    </div>
  )
}
