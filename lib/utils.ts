import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Ajoute N jours OUVRÉS (lun-ven) à une date, en sautant samedi/dimanche.
// Ex: vendredi + 2 jours ouvrés → mardi. Utilisé pour les relances.
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from)
  let added = 0
  while (added < n) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay() // 0 = dimanche, 6 = samedi
    if (day !== 0 && day !== 6) added++
  }
  return d
}

// Extrait un message lisible d'une erreur (Error, erreur Supabase, string…).
// Évite les "[object Object]" quand String(err) est appelé sur un objet.
export function errMsg(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string }
    return e.message || e.details || e.hint || JSON.stringify(err)
  }
  return String(err)
}

export function formatDistanceToNow(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMin / 60)
  const diffD = Math.floor(diffH / 24)

  if (diffMin < 1) return "à l'instant"
  if (diffMin < 60) return `il y a ${diffMin} min`
  if (diffH < 24) return `il y a ${diffH}h`
  if (diffD < 7) return `il y a ${diffD}j`
  if (diffD < 30) return `il y a ${Math.floor(diffD / 7)} sem.`
  if (diffD < 365) return `il y a ${Math.floor(diffD / 30)} mois`
  return `il y a ${Math.floor(diffD / 365)} an(s)`
}
