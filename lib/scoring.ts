import type { Contact } from '@/types'

// ---------------------------------------------------------------------------
// Scoring & cadence de setting (méthode Decupler : regles.md §11 + cadence).
// Tier P1 > P2 > P3 = "qui je traite maintenant".
//   - Intent : réponse reçue > froid.
//   - Fit ICP : décideur (CMO/CEO) devant.
//   - Fraîcheur : < 7 j chaud, 7-30 tiède, > 30 froid.
// Cadence relance : J+3, jours variables, MAX 3 relances puis archive.
// ---------------------------------------------------------------------------

const DAY = 86400000

export function daysSince(iso: string | null): number {
  if (!iso) return 9999
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
}

// Décideur ICP prioritaire (CMO / CEO / founder / head of marketing…).
export function isDecisionMaker(c: Contact): boolean {
  const t = (c.job_title || '').toLowerCase()
  return /\b(cmo|ceo|coo|founder|fondateur|dirigeant|g[ée]rant|head of|vp|directeur|director|chief)\b/.test(t)
}

export type Tier = 'P1' | 'P2' | 'P3'

// Un lead "à traiter" = la personne a écrit en dernier (is_sender_last=false).
export function needsReply(c: Contact): boolean {
  return !c.is_sender_last
}

// Prochaine relance due ? (tu as écrit en dernier, ≥3j, <3 relances)
export function isRelanceDue(c: Contact): boolean {
  if (c.is_sender_last !== true) return false
  if ((c.relance_count || 0) >= 3) return false
  const ref = c.last_relance_at || c.last_message_at
  return daysSince(ref) >= 3
}

// Doit être archivé (3 relances sans réponse, ou froid > 60j).
export function shouldArchive(c: Contact): boolean {
  return (c.is_sender_last === true && (c.relance_count || 0) >= 3) || daysSince(c.last_message_at) > 60
}

// Tier de priorité pour le tri du cockpit.
export function tier(c: Contact): Tier {
  const fresh = daysSince(c.last_message_at)
  const decider = isDecisionMaker(c)
  const hot = (c.score || 0) >= 7
  // P1 : réponse reçue récente OU décideur chaud.
  if (needsReply(c) && (fresh <= 2 || decider || hot)) return 'P1'
  // P2 : en cours / relance due / décideur tiède.
  if (needsReply(c) || isRelanceDue(c) || (decider && fresh <= 30)) return 'P2'
  return 'P3'
}

// Score numérique pour trier (plus grand = plus prioritaire).
export function priorityScore(c: Contact): number {
  let s = 0
  const fresh = daysSince(c.last_message_at)
  if (needsReply(c)) s += 100
  if (isDecisionMaker(c)) s += 50
  s += (c.score || 0) * 3
  s += Math.max(0, 30 - fresh) // bonus fraîcheur
  return s
}

// Étape de relance recommandée selon le nombre déjà envoyé (scripts.md §8).
export function relanceStep(relanceCount: number): { label: string; goal: string } {
  switch (relanceCount) {
    case 0:
      return {
        label: 'Soft bump',
        goal: 'relance très courte "soft bump" : juste faire remonter ton message au cas où il serait passé à la trappe. une ligne, légère, avec un smiley.',
      }
    case 1:
      return {
        label: 'Callback',
        goal: 'relance "callback" : reviens vers la personne en rappelant ta question initiale, et demande si c\'est juste pas le bon moment. deux bulles courtes, une question ouverte.',
      }
    case 2:
      return {
        label: 'Porte de sortie',
        goal: 'relance "porte de sortie" : dernier message soft, aucun souci si ce n\'est pas la priorité, demande si tu es hors sujet ou si ça vaut le coup d\'en reparler plus tard. jamais "si besoin fais signe".',
      }
    default:
      return {
        label: 'Breakup',
        goal: 'message de "breakup" final avant archivage : tu arrêtes de le déranger, ta porte reste ouverte, et s\'il connaît quelqu\'un que ça pourrait aider, qu\'il te l\'envoie. chaleureux.',
      }
  }
}
