import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
