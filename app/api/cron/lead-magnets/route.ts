// Cron / session d'envoi des lead-magnets.
//
// Auth: header "Authorization: Bearer ${CRON_SECRET}".
//
// IMPORTANT — espacement : cet endpoint envoie AU PLUS UN DM par appel, puis
// renvoie { sent: 0 | 1 }. C'est la boucle GitHub Actions (cron-lead-magnets.yml)
// qui rappelle l'endpoint et dort 2-3 min aléatoires entre deux envois, comme
// une vraie personne. Une passe unique n'enverra donc qu'un seul message : c'est
// voulu.
//
// Modes :
//   - Sans campaign_id  → parcourt les campagnes actives + auto_run (cron quotidien).
//   - Avec campaign_id  → cible cette campagne précise si elle est active
//                          (bouton "Lancer l'envoi" de l'app). Mettre la campagne
//                          en pause (active=false) coupe l'envoi au prochain tour.

import { getServerSupabase } from '@/lib/supabase'
import { getPostComments, startNewChat, sendMessage, getChatMessages, sendPostComment, sendLinkedInInvitation, normalizeComment, resolvePostSocialId, getOwnProfile, type NormalizedComment } from '@/lib/unipile'
import { checkLimit, logAction } from '@/lib/limits'
import { pickVariant } from '@/lib/outreach-runner'
import { extractFirstName } from '@/lib/gemini'
import { addBusinessDays } from '@/lib/utils'

const DEFAULT_COMMENT_REPLY = 'Envoyé en MP {prenom} 📩 (check tes messages 🙌)'
const DEFAULT_NOTCONNECTED_REPLY = "Merci {prenom} 🙌 ajoute-moi en contact et je t'envoie la ressource en MP direct !"
const DEFAULT_INVITE_NOTE = "Hello {prenom}, je t'envoie la ressource — connecte-toi qu'on puisse échanger 🙌 {magnet_url}"

// Plafond QUOTIDIEN des lead-magnets (1ers messages + messages uniques), hors
// campagnes outreach (Séquenceur) qui ont leur propre rythme. Modifiable via
// app_settings.lm_daily_cap.
const LM_DAILY_CAP_DEFAULT = 50
const WEBINAR_LINK = /linkedin\.com\/events\//i

function parisDayStartISO(): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
  return new Date(`${d}T00:00:00+02:00`).toISOString()
}
async function lmSentToday(db: ReturnType<typeof getServerSupabase>): Promise<number> {
  const since = parisDayStartISO()
  const [a, b] = await Promise.all([
    db.from('lead_magnet_sends').select('id', { count: 'exact', head: true }).gte('sent_at', since).not('message_sent', 'ilike', '[%'),
    db.from('lead_magnet_sends').select('id', { count: 'exact', head: true }).gte('broadcast_sent_at', since),
  ])
  return (a.count || 0) + (b.count || 0)
}
async function lmDailyCap(db: ReturnType<typeof getServerSupabase>): Promise<number> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'lm_daily_cap').maybeSingle()
  return Number(data?.value) || LM_DAILY_CAP_DEFAULT
}
// La personne a-t-elle DÉJÀ reçu l'invitation au workshop (n'importe quelle
// campagne) ou est-elle en « ne plus contacter » ? → jamais deux invitations.
async function alreadyInvitedOrBanned(db: ReturnType<typeof getServerSupabase>, providerId: string): Promise<boolean> {
  const [inv, dnc] = await Promise.all([
    db.from('lead_magnet_sends').select('id').eq('commenter_provider_id', providerId).not('webinar_invited_at', 'is', null).limit(1),
    db.from('do_not_contact').select('provider_id').eq('provider_id', providerId).limit(1),
  ])
  return !!(inv.data && inv.data.length) || !!(dnc.data && dnc.data.length)
}

type LMCampaign = {
  id: string
  name: string
  magnet_url: string | null
  reply_to_comment?: boolean
  comment_reply?: string | null
  comment_reply_notconnected?: string | null
  invite_on_fail?: boolean
  invite_note?: string | null
}

// Répond publiquement au commentaire de la personne avec le texte fourni
// (best-effort, ne bloque jamais l'envoi). Renvoie l'ISO si posté, sinon null.
async function postCommentReply(
  db: ReturnType<typeof getServerSupabase>,
  ACCOUNT_ID: string,
  socialId: string,
  campaign: LMCampaign,
  n: NormalizedComment,
  tpl: string
): Promise<string | null> {
  if (!campaign.reply_to_comment || !n.comment_id || !tpl.trim()) return null
  try {
    const chk = await checkLimit(db, ACCOUNT_ID, 'comment')
    if (!chk.allowed) return null
    const text = await personalize(tpl, n.commenter_name, campaign.magnet_url)
    await sendPostComment(ACCOUNT_ID, socialId, text, n.comment_id)
    await logAction(db, ACCOUNT_ID, 'comment')
    return new Date().toISOString()
  } catch {
    return null
  }
}

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

async function resolveAccountId(
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
  if (first?.unipile_account_id) return first.unipile_account_id
  return process.env.LINKEDIN_ACCOUNT_ID || null
}

// Construit le message perso. {name} = prénom rapide (1er mot). {prenom} =
// prénom nettoyé par l'IA (seulement si le template l'utilise, pour épargner
// des appels). {magnet_url} = lien du lead magnet.
async function personalize(
  template: string,
  commenterName: string | null,
  magnetUrl: string | null
): Promise<string> {
  const quickFirst = (commenterName || '').split(' ')[0] || ''
  let prenom = quickFirst
  if (/\{prenom\}/i.test(template)) {
    prenom = (await extractFirstName(commenterName || '')) || quickFirst
  }
  return template
    .replace(/\{prenom\}/gi, prenom)
    .replace(/\{name\}/gi, quickFirst)
    .replace(/\{magnet_url\}/gi, magnetUrl || '')
}

type SendResult = { sent: number; campaign?: string; name?: string | null; reason?: string; step?: string }

// Tente d'envoyer UNE relance due pour la campagne (2 jours ouvrés après le 1er
// message, UNIQUEMENT à ceux qui n'ont pas répondu). Renvoie le résultat si une
// relance part (ou un blocage plafond), sinon null (aucune relance due).
async function trySendFollowup(
  db: ReturnType<typeof getServerSupabase>,
  ACCOUNT_ID: string,
  campaign: { id: string; name: string; followup_message: string | null; magnet_url: string | null }
): Promise<SendResult | null> {
  if (!campaign.followup_message) return null
  const nowIso = new Date().toISOString()
  for (let i = 0; i < 100; i++) {
    const { data: due } = await db
      .from('lead_magnet_sends')
      .select('*')
      .eq('campaign_id', campaign.id)
      .is('followup_sent_at', null)
      .eq('replied', false)
      .not('chat_id', 'is', null)
      .not('message_sent', 'ilike', '[ÉCHEC]%')
      .lte('followup_due_at', nowIso)
      .order('followup_due_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!due) return null // aucune relance due

    // RÈGLE : jamais de relance à quelqu'un qui a répondu.
    let replied = false
    try {
      const msgs = await getChatMessages(due.chat_id as string, 15)
      // Réponse = message entrant POSTÉRIEUR à notre envoi (un vieux fil ne compte pas).
      const since = (due.sent_at as string | null) || ''
      replied = (msgs as Array<{ timestamp?: string; is_sender?: number | boolean }>).some(
        (m) => !(m.is_sender === 1 || m.is_sender === true) && (!since || (m.timestamp || '') > since)
      )
    } catch {
      // Lecture impossible → on ne prend pas le risque de relancer un répondeur.
      // On sort des relances pour ce tour (les 1ers messages, eux, continuent).
      return null
    }
    if (replied) {
      await db.from('lead_magnet_sends').update({ replied: true, replied_at: new Date().toISOString() }).eq('id', due.id)
      continue // cible suivante
    }

    // GARDE ANTI-DOUBLON : la même personne peut avoir plusieurs lignes (a
    // commenté 2 posts / 2 campagnes). Si elle a déjà reçu UNE relance (toutes
    // campagnes) dans les 14 derniers jours, on n'en renvoie pas une seconde.
    if (due.commenter_provider_id) {
      const since14 = new Date(Date.now() - 14 * 86400000).toISOString()
      const { data: already } = await db
        .from('lead_magnet_sends')
        .select('id')
        .eq('commenter_provider_id', due.commenter_provider_id)
        .neq('id', due.id)
        .gte('followup_sent_at', since14)
        .limit(1)
      if (already && already.length) {
        await db.from('lead_magnet_sends').update({ followup_sent_at: new Date().toISOString() }).eq('id', due.id)
        continue // marquée "traitée" sans envoi
      }
    }

    const chk = await checkLimit(db, ACCOUNT_ID, 'dm')
    if (!chk.allowed) return { sent: 0, reason: chk.reason || 'Plafond messages atteint' }

    const text = await personalize(campaign.followup_message, due.commenter_name, campaign.magnet_url)
    try {
      await sendMessage(due.chat_id as string, text)
      await logAction(db, ACCOUNT_ID, 'dm')
      await db.from('lead_magnet_sends').update({ followup_sent_at: new Date().toISOString() }).eq('id', due.id)
      return { sent: 1, campaign: campaign.name, name: due.commenter_name, step: 'relance' }
    } catch {
      // Échec d'envoi de la relance : on marque comme traitée pour ne pas
      // boucler, et on continue à la relance suivante (ne stoppe pas la session).
      await db.from('lead_magnet_sends').update({ followup_sent_at: new Date().toISOString() }).eq('id', due.id)
      continue
    }
  }
  return null
}

// MESSAGE UNIQUE (broadcast_message) : envoyé UNE fois aux personnes de la
// campagne déjà contactées, sans réponse, jamais invitées au workshop. Pas de
// relance derrière. Sert à inviter au workshop les commentateurs d'un ancien post.
async function trySendBroadcast(
  db: ReturnType<typeof getServerSupabase>,
  ACCOUNT_ID: string,
  campaign: { id: string; name: string; broadcast_message: string | null; magnet_url: string | null }
): Promise<SendResult | null> {
  if (!campaign.broadcast_message?.trim()) return null
  for (let i = 0; i < 100; i++) {
    const { data: due } = await db
      .from('lead_magnet_sends')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('replied', false)
      .is('broadcast_sent_at', null)
      .is('webinar_invited_at', null)
      .not('chat_id', 'is', null)
      .not('message_sent', 'ilike', '[%')
      .order('sent_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!due) return null
    const mark = (patch: Record<string, unknown>) => db.from('lead_magnet_sends').update(patch).eq('id', due.id)

    // Jamais à quelqu'un qui a répondu depuis (vérif live du fil).
    try {
      const msgs = await getChatMessages(due.chat_id as string, 15)
      const since = (due.sent_at as string | null) || ''
      const replied = (msgs as Array<{ timestamp?: string; is_sender?: number | boolean }>).some(
        (m) => !(m.is_sender === 1 || m.is_sender === true) && (!since || (m.timestamp || '') > since)
      )
      if (replied) { await mark({ replied: true, replied_at: new Date().toISOString() }); continue }
    } catch { return null }

    if (due.commenter_provider_id && (await alreadyInvitedOrBanned(db, due.commenter_provider_id))) {
      await mark({ broadcast_sent_at: new Date().toISOString() }) // déjà invité ailleurs → on marque sans envoyer
      continue
    }
    const chk = await checkLimit(db, ACCOUNT_ID, 'dm')
    if (!chk.allowed) return { sent: 0, reason: chk.reason || 'Plafond messages atteint' }
    const text = await personalize(pickVariant(campaign.broadcast_message).text, due.commenter_name, campaign.magnet_url)
    try {
      await sendMessage(due.chat_id as string, text)
      await logAction(db, ACCOUNT_ID, 'dm')
      const now = new Date().toISOString()
      await mark({ broadcast_sent_at: now, webinar_invited_at: WEBINAR_LINK.test(text) ? now : null })
      return { sent: 1, campaign: campaign.name, name: due.commenter_name, step: 'message unique' }
    } catch {
      await mark({ broadcast_sent_at: new Date().toISOString() })
      continue
    }
  }
  return null
}

// provider_id du compte (Nathan) : on ne répond / n'écrit JAMAIS à ses propres
// commentaires. Mis en cache par compte pour la durée de l'instance.
const ownIdCache = new Map<string, string | null>()
async function ownProviderId(accountId: string): Promise<string | null> {
  if (ownIdCache.has(accountId)) return ownIdCache.get(accountId) || null
  let id: string | null = null
  try { id = (await getOwnProfile(accountId)).provider_id || null } catch { /* inconnu */ }
  if (id) ownIdCache.set(accountId, id)
  return id
}

// Envoie AU PLUS UN DM sur l'ensemble des campagnes candidates. Renvoie
// { sent, campaign?, name? } — sent=0 signifie "plus rien à envoyer" (fin de
// session pour la boucle GitHub Actions).
async function sendOne(
  db: ReturnType<typeof getServerSupabase>,
  campaignId: string | null
): Promise<SendResult> {
  // Jamais d'envoi le week-end (heure de Paris).
  if (new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(new Date()).match(/^(Sat|Sun)$/)) {
    return { sent: 0, reason: 'Week-end : pas d’envoi' }
  }
  let q = db.from('lead_magnet_campaigns').select('*').eq('active', true)
  if (campaignId) q = q.eq('id', campaignId)
  else q = q.eq('auto_run', true)
  const { data: campaignsRaw } = await q
  if (!campaignsRaw || campaignsRaw.length === 0) {
    return { sent: 0, reason: campaignId ? 'Campagne inactive ou introuvable' : 'Aucune campagne active' }
  }

  // Plafond quotidien lead-magnets (hors Séquenceur).
  const sentToday = await lmSentToday(db)
  const cap = await lmDailyCap(db)
  if (sentToday >= cap) return { sent: 0, reason: `Plafond lead-magnets atteint (${sentToday}/${cap} aujourd'hui)` }

  // ALTERNANCE : on tourne l'ordre des campagnes à chaque envoi pour ne pas
  // enchaîner 20 messages identiques (rendu plus naturel).
  // Les réponses en commentaire comptent dans l'alternance (pas dans le plafond DM).
  const { count: commentedToday } = await db.from('lead_magnet_sends').select('id', { count: 'exact', head: true })
    .gte('comment_replied_at', parisDayStartISO()).ilike('message_sent', '[COMMENT]%')
  const rot = (sentToday + (commentedToday || 0)) % campaignsRaw.length
  const campaigns = [...campaignsRaw.slice(rot), ...campaignsRaw.slice(0, rot)]

  for (const campaign of campaigns) {
    const ACCOUNT_ID = await resolveAccountId(db, campaign.linkedin_account_id)
    if (!ACCOUNT_ID) continue

    // PRIORITÉ 0 : message unique (invitation workshop aux déjà-contactés).
    const bc = await trySendBroadcast(db, ACCOUNT_ID, campaign)
    if (bc) return bc

    // Résout le social_id CANONIQUE (urn:li:activity:...) et ré-écrit en base si
    // le stocké était un share (numéro différent → 0 commentaire).
    const socialId = await resolvePostSocialId(ACCOUNT_ID, campaign.social_id, campaign.post_url)
    if (!socialId) continue
    if (socialId !== campaign.social_id) {
      await db.from('lead_magnet_campaigns').update({ social_id: socialId }).eq('id', campaign.id)
    }

    // PRIORITÉ 1 : relances dues (2 jours ouvrés, sans réponse). On les envoie
    // avant les nouveaux 1ers messages.
    const followup = await trySendFollowup(db, ACCOUNT_ID, campaign)
    if (followup) return followup

    const ownId = await ownProviderId(ACCOUNT_ID)
    const { data: alreadySent } = await db
      .from('lead_magnet_sends')
      .select('commenter_provider_id')
      .eq('campaign_id', campaign.id)
    const sentSet = new Set((alreadySent || []).map((s) => s.commenter_provider_id))
    const triggerKw = campaign.trigger_keyword?.toLowerCase().trim() || ''

    // min_comments : on ne déclenche que si le post a atteint le seuil.
    if (campaign.min_comments && campaign.min_comments > 0) {
      let count = 0
      let countCursor: string | undefined = undefined
      while (true) {
        const { items, cursor: next } = await getPostComments(ACCOUNT_ID, socialId, countCursor, 100)
        count += items.length
        if (count >= campaign.min_comments || !next || !items.length) break
        countCursor = next
      }
      if (count < campaign.min_comments) continue
    }

    // Parcourt les commentaires, trouve le PREMIER commentateur pas encore
    // traité et qui matche le trigger, envoie un seul DM puis renvoie.
    let cursor: string | undefined = undefined
    commentsLoop: while (true) {
      const { items, cursor: next } = await getPostComments(ACCOUNT_ID, socialId, cursor, 100)
      if (!items.length) break
      for (const c of items) {
        const n = normalizeComment(c)
        const providerId = n.commenter_provider_id
        if (!providerId || sentSet.has(providerId)) continue
        const matches = !triggerKw || (n.comment_text || '').toLowerCase().includes(triggerKw)
        if (!matches) continue
        if (ownId && providerId === ownId) continue // mon propre commentaire

        // MODE « COMMENTAIRE SEUL » : pas de DM. On répond publiquement sous le
        // commentaire de la personne (variantes « === »), une fois par personne.
        // Seul « ne plus contacter » bloque (la ressource a été demandée).
        if (campaign.comment_only) {
          const { data: dnc } = await db.from('do_not_contact').select('provider_id').eq('provider_id', providerId).limit(1)
          if (dnc && dnc.length) { sentSet.add(providerId); continue }
          if (!n.comment_id) continue
          // Étalement : plafond de réponses PAR JOUR pour cette campagne
          // (app_settings.lm_comment_daily_cap, défaut 30) → jamais tout le post d'un coup.
          const { data: cc } = await db.from('app_settings').select('value').eq('key', 'lm_comment_daily_cap').maybeSingle()
          const commentCap = Number(cc?.value) || 30
          const { count: commentsToday } = await db.from('lead_magnet_sends').select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaign.id).gte('comment_replied_at', parisDayStartISO())
          if ((commentsToday || 0) >= commentCap) break commentsLoop // plafond du jour → campagne suivante
          // Déjà une réponse sous ce commentaire (souvent Nathan à la main) → on n'ajoute rien.
          if (((c as { reply_counter?: number }).reply_counter || 0) > 0) { sentSet.add(providerId); continue }
          const cchk = await checkLimit(db, ACCOUNT_ID, 'comment')
          if (!cchk.allowed) return { sent: 0, reason: cchk.reason || 'Plafond commentaires atteint' }
          const text = await personalize(pickVariant(campaign.comment_reply || campaign.message_template).text, n.commenter_name, campaign.magnet_url)
          sentSet.add(providerId)
          try {
            await sendPostComment(ACCOUNT_ID, socialId, text, n.comment_id)
            await logAction(db, ACCOUNT_ID, 'comment')
            const now = new Date().toISOString()
            await db.from('lead_magnet_sends').insert({
              campaign_id: campaign.id, commenter_provider_id: providerId, commenter_name: n.commenter_name,
              commenter_profile_url: n.commenter_profile_url, comment_text: n.comment_text,
              message_sent: `[COMMENT] ${text}`, comment_replied_at: now,
              webinar_invited_at: WEBINAR_LINK.test(text) ? now : null,
            })
            await db.from('lead_magnet_campaigns').update({ last_run_at: now }).eq('id', campaign.id)
            return { sent: 1, campaign: campaign.name, name: n.commenter_name, step: 'comment' }
          } catch (err) {
            await db.from('lead_magnet_sends').insert({
              campaign_id: campaign.id, commenter_provider_id: providerId, commenter_name: n.commenter_name,
              commenter_profile_url: n.commenter_profile_url, comment_text: n.comment_text,
              message_sent: `[ÉCHEC] commentaire : ${String(err).slice(0, 160)}`,
            }).then(() => {}, () => {})
            continue
          }
        }

        // Déjà invité au workshop par une autre campagne, ou « ne plus contacter »
        // → on mémorise sans envoyer (jamais deux invitations à la même personne).
        if (await alreadyInvitedOrBanned(db, providerId)) {
          sentSet.add(providerId)
          await db.from('lead_magnet_sends').insert({
            campaign_id: campaign.id, commenter_provider_id: providerId, commenter_name: n.commenter_name,
            commenter_profile_url: n.commenter_profile_url, comment_text: n.comment_text,
            message_sent: '[DOUBLON] déjà invité au workshop / ne plus contacter',
          }).then(() => {}, () => {})
          continue
        }

        // Cap DM en LECTURE SEULE : on ne consomme le quota que sur un envoi
        // réussi (un échec = personne non-contactable, ne doit pas brûler le quota).
        const chk = await checkLimit(db, ACCOUNT_ID, 'dm')
        if (!chk.allowed) return { sent: 0, reason: chk.reason || 'Plafond messages atteint' }

        // Variantes (séparées par une ligne « === ») tirées au hasard.
        const personalised = await personalize(pickVariant(campaign.message_template).text, n.commenter_name, campaign.magnet_url)
        try {
          const chat = (await startNewChat(ACCOUNT_ID, providerId, personalised)) as { chat_id?: string; id?: string }
          await logAction(db, ACCOUNT_ID, 'dm')
          // Réponse publique au commentaire (« Envoyé en MP ✅ »), best-effort.
          const commentRepliedAt = await postCommentReply(db, ACCOUNT_ID, socialId, campaign, n, campaign.comment_reply?.trim() || DEFAULT_COMMENT_REPLY)
          // Planifie la relance à N jours ouvrés (défaut 2) si configurée.
          const followupDue = campaign.followup_message
            ? addBusinessDays(new Date(), campaign.followup_business_days || 2).toISOString()
            : null
          await db.from('lead_magnet_sends').insert({
            campaign_id: campaign.id,
            commenter_provider_id: providerId,
            commenter_name: n.commenter_name,
            commenter_profile_url: n.commenter_profile_url,
            comment_text: n.comment_text,
            message_sent: personalised,
            chat_id: chat?.chat_id || chat?.id || null,
            followup_due_at: followupDue,
            comment_replied_at: commentRepliedAt,
            webinar_invited_at: WEBINAR_LINK.test(personalised) ? new Date().toISOString() : null,
          })
          await db.from('lead_magnet_campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', campaign.id)
          return { sent: 1, campaign: campaign.name, name: n.commenter_name, step: 'dm' }
        } catch (err) {
          // DM impossible (souvent 2e degré / messagerie fermée).
          // Option : au lieu d'échouer, on envoie une DEMANDE DE CONNEXION avec
          // une note (qui porte la ressource) → le 2e degré devient un lead.
          let inviteError = ''
          if (campaign.invite_on_fail) {
            const invChk = await checkLimit(db, ACCOUNT_ID, 'invite')
            if (invChk.allowed) {
              const note = (await personalize(campaign.invite_note?.trim() || DEFAULT_INVITE_NOTE, n.commenter_name, campaign.magnet_url)).slice(0, 290)
              try {
                await sendLinkedInInvitation(ACCOUNT_ID, providerId, note)
                await logAction(db, ACCOUNT_ID, 'invite')
                const commentRepliedAt = await postCommentReply(db, ACCOUNT_ID, socialId, campaign, n, campaign.comment_reply_notconnected?.trim() || DEFAULT_NOTCONNECTED_REPLY)
                sentSet.add(providerId)
                await db.from('lead_magnet_sends').insert({
                  campaign_id: campaign.id,
                  commenter_provider_id: providerId,
                  commenter_name: n.commenter_name,
                  commenter_profile_url: n.commenter_profile_url,
                  comment_text: n.comment_text,
                  message_sent: `[INVITÉ] ${note}`,
                  invited_at: new Date().toISOString(),
                  comment_replied_at: commentRepliedAt,
                }).then(() => {}, () => {})
                await db.from('lead_magnet_campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', campaign.id)
                return { sent: 1, campaign: campaign.name, name: n.commenter_name, step: 'invite' }
              } catch (invErr) {
                // invitation aussi impossible → on marque échec (voir ci-dessous)
                inviteError = String(invErr).slice(0, 120)
              }
            } else {
              // Plafond invitations atteint : on ne marque PAS (retry demain),
              // on passe au commentateur suivant.
              continue
            }
          }
          // Pas de DM (ni invitation) → on invite la personne à se connecter
          // via un COMMENTAIRE public (« ajoute-moi et je t'envoie la ressource »).
          sentSet.add(providerId)
          const notConnTpl = campaign.comment_reply_notconnected?.trim() || DEFAULT_NOTCONNECTED_REPLY
          const cRepliedAt = await postCommentReply(db, ACCOUNT_ID, socialId, campaign, n, notConnTpl)
          if (cRepliedAt) {
            await db
              .from('lead_magnet_sends')
              .insert({
                campaign_id: campaign.id,
                commenter_provider_id: providerId,
                commenter_name: n.commenter_name,
                commenter_profile_url: n.commenter_profile_url,
                comment_text: n.comment_text,
                message_sent: `[COMMENT] ${notConnTpl}`,
                comment_replied_at: cRepliedAt,
              })
              .then(() => {}, () => {})
            await db.from('lead_magnet_campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', campaign.id)
            return { sent: 1, campaign: campaign.name, name: n.commenter_name, step: 'comment' }
          }
          // Rien n'a pu être fait (ni DM, ni invitation, ni commentaire) → [ÉCHEC].
          await db
            .from('lead_magnet_sends')
            .insert({
              campaign_id: campaign.id,
              commenter_provider_id: providerId,
              commenter_name: n.commenter_name,
              commenter_profile_url: n.commenter_profile_url,
              comment_text: n.comment_text,
              message_sent: `[ÉCHEC] ${String(err).slice(0, 180)}${inviteError ? ` | invitation: ${inviteError}` : ''}`,
            })
            .then(
              () => {},
              () => {}
            )
          continue
        }
      }
      if (!next) break
      cursor = next
    }
  }

  return { sent: 0, reason: 'Tous les commentateurs ont déjà reçu le message' }
}

function campaignIdFrom(request: Request, body: unknown): string | null {
  const url = new URL(request.url)
  const fromQuery = url.searchParams.get('campaign_id')
  if (fromQuery) return fromQuery
  if (body && typeof body === 'object' && 'campaign_id' in body) {
    const v = (body as { campaign_id?: unknown }).campaign_id
    if (typeof v === 'string' && v) return v
  }
  return null
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  try {
    const db = getServerSupabase()
    const result = await sendOne(db, campaignIdFrom(request, body))
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}
