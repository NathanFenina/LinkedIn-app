'use client'

import { useEffect, useState, useCallback } from 'react'
import { LinkedInAccount } from '@/types'
import { Plus, Check, ChevronDown } from 'lucide-react'

export function AccountSwitcher() {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([])
  const [active, setActive] = useState<{ id: string | null; label: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [label, setLabel] = useState('')
  const [unipileId, setUnipileId] = useState('')

  const refresh = useCallback(async () => {
    const [list, current] = await Promise.all([
      fetch('/api/accounts').then((r) => r.json()).catch(() => []),
      fetch('/api/accounts/active').then((r) => r.json()).catch(() => null),
    ])
    if (Array.isArray(list)) setAccounts(list)
    if (current && !current.error) setActive({ id: current.id, label: current.label })
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [list, current] = await Promise.all([
        fetch('/api/accounts').then((r) => r.json()).catch(() => []),
        fetch('/api/accounts/active').then((r) => r.json()).catch(() => null),
      ])
      if (cancelled) return
      if (Array.isArray(list)) setAccounts(list)
      if (current && !current.error) setActive({ id: current.id, label: current.label })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const select = async (id: string) => {
    await fetch('/api/accounts/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setOpen(false)
    window.location.reload()
  }

  const create = async () => {
    if (!label.trim() || !unipileId.trim()) return
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: label.trim(),
        unipile_account_id: unipileId.trim(),
        is_default: accounts.length === 0,
      }),
    })
    if (res.ok) {
      setLabel('')
      setUnipileId('')
      setShowAdd(false)
      await refresh()
    }
  }

  const display = active?.label || (accounts[0]?.label ?? 'Aucun compte')

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">
            {display.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs font-medium text-gray-700 truncate">{display}</span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg p-1">
          {accounts.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-gray-500">Aucun compte. Ajoute-en un.</p>
          )}
          {accounts.map((a) => {
            const isActive = active?.id === a.id
            return (
              <button
                key={a.id}
                onClick={() => select(a.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded text-left"
              >
                <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[9px] font-bold flex items-center justify-center shrink-0">
                  {a.label.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs flex-1 truncate">{a.label}</span>
                {isActive && <Check className="w-3.5 h-3.5 text-blue-600" />}
              </button>
            )
          })}

          <div className="border-t border-gray-100 mt-1 pt-1">
            {showAdd ? (
              <div className="p-2 space-y-1.5">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (ex: Perso, Pro)"
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1"
                />
                <input
                  value={unipileId}
                  onChange={(e) => setUnipileId(e.target.value)}
                  placeholder="Unipile account_id"
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1"
                />
                <div className="flex gap-1">
                  <button
                    onClick={create}
                    className="flex-1 text-xs bg-blue-600 text-white rounded px-2 py-1 hover:bg-blue-700"
                  >
                    Ajouter
                  </button>
                  <button
                    onClick={() => setShowAdd(false)}
                    className="text-xs text-gray-500 px-2 py-1"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded text-left text-xs text-blue-600"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter un compte
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
