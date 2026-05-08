import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
