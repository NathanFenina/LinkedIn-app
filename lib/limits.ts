import { getServerSupabase } from './supabase'

// ---------------------------------------------------------------------------
// Garde-fous LinkedIn — évite le ban en plafonnant les actions par compte et
// par 24h (jour UTC), avec BLOCAGE DUR au plafond. Un compteur global limite le
// cumul toutes actions confondues (LinkedIn regarde surtout le volume total).
//
// Dégradation propre : si la table `linkedin_actions` n'existe pas encore, les
// vérifs laissent passer (les caps par feature — ex. daily_cap commentaires —
// restent actifs). Le compteur global s'active dès que la table est créée.
// ---------------------------------------------------------------------------

export type ActionType = 'comment' | 'dm' | 'invite' | 'accept' | 'profile_view'

// Départ conservateur (montée douce possible plus tard). Commentaires jusqu'à 30.
export const CAPS: Record<ActionType, number> = {
  comment: 30,
  dm: 50,
  invite: 15,
  accept: 20,
  profile_view: 120,
}
export const GLOBAL_CAP = 150

export const ACTION_LABELS: Record<ActionType, string> = {
  comment: 'Commentaires',
  dm: 'Messages',
  invite: 'Invitations',
  accept: 'Acceptations',
  profile_view: 'Vues de profil',
}

type Db = ReturnType<typeof getServerSupabase>

function startOfDayISO(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

async function countSince(db: Db, accountId: string, type: ActionType | null, sinceISO: string): Promise<number | null> {
  let q = db
    .from('linkedin_actions')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .gte('created_at', sinceISO)
  if (type) q = q.eq('type', type)
  const { count, error } = await q
  if (error) return null // table absente / souci → signal "inconnu"
  return count || 0
}

export interface LimitCheck {
  allowed: boolean
  reason?: string
  total?: number
  perType?: number
  cap: number
  globalCap: number
}

// Vérifie si une action est permise MAINTENANT (sans logger).
export async function checkLimit(db: Db, accountId: string, type: ActionType): Promise<LimitCheck> {
  const since = startOfDayISO()
  const total = await countSince(db, accountId, null, since)
  const perType = await countSince(db, accountId, type, since)
  // Table absente → on laisse passer (dégradation), caps par feature actifs.
  if (total === null || perType === null) {
    return { allowed: true, cap: CAPS[type], globalCap: GLOBAL_CAP }
  }
  if (total >= GLOBAL_CAP) {
    return { allowed: false, reason: `Plafond global atteint (${total}/${GLOBAL_CAP} actions LinkedIn sur 24h). Réessaie demain.`, total, perType, cap: CAPS[type], globalCap: GLOBAL_CAP }
  }
  if (perType >= CAPS[type]) {
    return { allowed: false, reason: `Plafond ${ACTION_LABELS[type].toLowerCase()} atteint (${perType}/${CAPS[type]} aujourd'hui).`, total, perType, cap: CAPS[type], globalCap: GLOBAL_CAP }
  }
  return { allowed: true, total, perType, cap: CAPS[type], globalCap: GLOBAL_CAP }
}

// Enregistre une action réalisée (best-effort ; ignore si table absente).
export async function logAction(db: Db, accountId: string, type: ActionType): Promise<void> {
  try {
    await db.from('linkedin_actions').insert({ account_id: accountId, type })
  } catch {
    /* table absente → no-op */
  }
}

// Vérifie PUIS logue si permis. Retourne le check (allowed=false = bloqué).
export async function guard(db: Db, accountId: string, type: ActionType): Promise<LimitCheck> {
  const check = await checkLimit(db, accountId, type)
  if (check.allowed) await logAction(db, accountId, type)
  return check
}

// Usage du jour, pour l'indicateur d'UI.
export async function usageToday(db: Db, accountId: string): Promise<{
  total: number | null
  globalCap: number
  perType: Array<{ type: ActionType; used: number | null; cap: number; label: string }>
}> {
  const since = startOfDayISO()
  const total = await countSince(db, accountId, null, since)
  const perType = await Promise.all(
    (Object.keys(CAPS) as ActionType[]).map(async (t) => ({
      type: t,
      used: await countSince(db, accountId, t, since),
      cap: CAPS[t],
      label: ACTION_LABELS[t],
    }))
  )
  return { total, globalCap: GLOBAL_CAP, perType }
}

// Délai aléatoire (ms) entre deux actions d'un bulk — jamais de rafale.
export function humanDelayMs(minSec = 30, maxSec = 90): number {
  const lo = Math.min(minSec, maxSec)
  const hi = Math.max(minSec, maxSec)
  return (Math.floor(Math.random() * (hi - lo + 1)) + lo) * 1000
}
