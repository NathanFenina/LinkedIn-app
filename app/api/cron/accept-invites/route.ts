// Cron / session d'acceptation automatique des invitations reçues.
//
// Auth: header "Authorization: Bearer ${CRON_SECRET}".
//
// Espacement : accepte AU PLUS UNE invitation par appel (+ message de bienvenue),
// puis renvoie { accepted: 0 | 1 }. La boucle GitHub Actions (cron-accept-invites.yml)
// rappelle et dort 2-3 min entre chaque, pour ne pas envoyer les bienvenues en
// rafale. Tourne une fois par jour (schedule) et respecte les plafonds LinkedIn.

import { getServerSupabase } from '@/lib/supabase'
import { getReceivedInvitations, handleInvitation, startNewChat } from '@/lib/unipile'
import { checkLimit, logAction } from '@/lib/limits'
import { extractFirstName } from '@/lib/gemini'

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

async function unipileAccountFor(
  db: ReturnType<typeof getServerSupabase>,
  linkedin_account_id: string | null
): Promise<string | null> {
  if (linkedin_account_id) {
    const { data } = await db
      .from('linkedin_accounts')
      .select('unipile_account_id')
      .eq('id', linkedin_account_id)
      .maybeSingle()
    if (data?.unipile_account_id) return data.unipile_account_id
  }
  const { data: first } = await db
    .from('linkedin_accounts')
    .select('unipile_account_id')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return first?.unipile_account_id || process.env.LINKEDIN_ACCOUNT_ID || null
}

function startOfDayISO(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

async function personalizeWelcome(tpl: string, name: string | null): Promise<string> {
  const quick = (name || '').split(' ')[0] || ''
  const prenom = /\{prenom\}/i.test(tpl) ? (await extractFirstName(name || '')) || quick : quick
  return tpl.replace(/\{prenom\}/gi, prenom).replace(/\{name\}/gi, quick)
}

async function acceptOne(
  db: ReturnType<typeof getServerSupabase>
): Promise<{ accepted: number; name?: string | null; reason?: string }> {
  const { data: configs } = await db.from('auto_accept_config').select('*').eq('enabled', true)
  if (!configs || configs.length === 0) return { accepted: 0, reason: 'Auto-accept désactivé' }

  for (const cfg of configs) {
    const ACCOUNT_ID = await unipileAccountFor(db, cfg.linkedin_account_id)
    if (!ACCOUNT_ID) continue

    // Plafond quotidien (config) + garde-fou LinkedIn (accept).
    const { count: acceptedToday } = await db
      .from('accepted_invites')
      .select('id', { count: 'exact', head: true })
      .eq('linkedin_account_id', cfg.linkedin_account_id)
      .gte('accepted_at', startOfDayISO())
    if ((acceptedToday || 0) >= (cfg.daily_cap || 20)) continue

    const accChk = await checkLimit(db, ACCOUNT_ID, 'accept')
    if (!accChk.allowed) continue

    // Première invitation en attente.
    const { items } = await getReceivedInvitations(ACCOUNT_ID, undefined, 50)
    const inv = items.find((i) => i.id && i.provider_id)
    if (!inv) continue // rien à accepter pour ce compte

    try {
      await handleInvitation(ACCOUNT_ID, inv.id, 'accept', inv.shared_secret)
      await logAction(db, ACCOUNT_ID, 'accept')
    } catch (err) {
      // Acceptation impossible → on note pour ne pas boucler, on passe.
      await db.from('accepted_invites').insert({
        linkedin_account_id: cfg.linkedin_account_id,
        provider_id: inv.provider_id,
        name: inv.name,
        headline: inv.headline,
        welcome_sent: false,
        welcome_message: `[ÉCHEC accept] ${String(err).slice(0, 150)}`,
      }).then(() => {}, () => {})
      continue
    }

    // Message de bienvenue (best-effort, respecte le plafond DM).
    let welcomeSent = false
    let welcomeMsg: string | null = null
    if (cfg.welcome_message?.trim()) {
      const dmChk = await checkLimit(db, ACCOUNT_ID, 'dm')
      if (dmChk.allowed && inv.provider_id) {
        try {
          welcomeMsg = await personalizeWelcome(cfg.welcome_message, inv.name)
          await startNewChat(ACCOUNT_ID, inv.provider_id, welcomeMsg)
          await logAction(db, ACCOUNT_ID, 'dm')
          welcomeSent = true
        } catch {
          welcomeSent = false
        }
      }
    }

    await db.from('accepted_invites').insert({
      linkedin_account_id: cfg.linkedin_account_id,
      provider_id: inv.provider_id,
      name: inv.name,
      headline: inv.headline,
      welcome_sent: welcomeSent,
      welcome_message: welcomeMsg,
    }).then(() => {}, () => {})
    await db.from('auto_accept_config').update({ last_run_at: new Date().toISOString() }).eq('linkedin_account_id', cfg.linkedin_account_id)

    return { accepted: 1, name: inv.name }
  }

  return { accepted: 0, reason: 'Aucune invitation à accepter (ou plafond atteint)' }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Jamais de message le dimanche (heure de Paris).
  if (new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(new Date()) === 'Sun') {
    return Response.json({ ok: true, sent: 0, accepted: 0, reason: 'Dimanche : pas d’envoi' })
  }
  try {
    const db = getServerSupabase()
    const result = await acceptOne(db)
    // "sent" en plus de "accepted" pour que la boucle générique s'arrête quand accepted=0.
    return Response.json({ ok: true, sent: result.accepted, ...result })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}
