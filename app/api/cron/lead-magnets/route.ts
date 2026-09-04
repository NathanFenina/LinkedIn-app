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
import { getPostComments, startNewChat, sendMessage, getChatMessages, sendPostComment, sendLinkedInInvitation, normalizeComment, resolvePostSocialId, type NormalizedComment } from '@/lib/unipile'
import { checkLimit, logAction } from '@/lib/limits'
import { extractFirstName } from '@/lib/gemini'
import { addBusinessDays } from '@/lib/utils'

const DEFAULT_COMMENT_REPLY = 'Envoyé en MP {prenom} 📩 (check tes messages 🙌)'
const DEFAULT_INVITE_NOTE = "Hello {prenom}, je t'envoie la ressource — connecte-toi qu'on puisse échanger 🙌 {magnet_url}"

type LMCampaign = {
  id: string
  name: string
  magnet_url: string | null
  reply_to_comment?: boolean
  comment_reply?: string | null
  invite_on_fail?: boolean
  invite_note?: string | null
}

// Répond publiquement au commentaire de la personne (best-effort, ne bloque
// jamais l'envoi). Renvoie l'ISO si la réponse est postée, sinon null.
async function maybeReplyToComment(
  db: ReturnType<typeof getServerSupabase>,
  ACCOUNT_ID: string,
  socialId: string,
  campaign: LMCampaign,
  n: NormalizedComment
): Promise<string | null> {
  if (!campaign.reply_to_comment || !n.comment_id) return null
  const tpl = campaign.comment_reply?.trim() || DEFAULT_COMMENT_REPLY
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
      replied = msgs.some((m) => !(m.is_sender === 1 || m.is_sender === true))
    } catch {
      // Lecture impossible → on ne prend pas le risque de relancer un répondeur.
      // On sort des relances pour ce tour (les 1ers messages, eux, continuent).
      return null
    }
    if (replied) {
      await db.from('lead_magnet_sends').update({ replied: true }).eq('id', due.id)
      continue // cible suivante
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

// Envoie AU PLUS UN DM sur l'ensemble des campagnes candidates. Renvoie
// { sent, campaign?, name? } — sent=0 signifie "plus rien à envoyer" (fin de
// session pour la boucle GitHub Actions).
async function sendOne(
  db: ReturnType<typeof getServerSupabase>,
  campaignId: string | null
): Promise<SendResult> {
  let q = db.from('lead_magnet_campaigns').select('*').eq('active', true)
  if (campaignId) q = q.eq('id', campaignId)
  else q = q.eq('auto_run', true)
  const { data: campaigns } = await q
  if (!campaigns || campaigns.length === 0) {
    return { sent: 0, reason: campaignId ? 'Campagne inactive ou introuvable' : 'Aucune campagne active' }
  }

  for (const campaign of campaigns) {
    const ACCOUNT_ID = await resolveAccountId(db, campaign.linkedin_account_id)
    if (!ACCOUNT_ID) continue

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
    while (true) {
      const { items, cursor: next } = await getPostComments(ACCOUNT_ID, socialId, cursor, 100)
      if (!items.length) break
      for (const c of items) {
        const n = normalizeComment(c)
        const providerId = n.commenter_provider_id
        if (!providerId || sentSet.has(providerId)) continue
        const matches = !triggerKw || (n.comment_text || '').toLowerCase().includes(triggerKw)
        if (!matches) continue

        // Cap DM en LECTURE SEULE : on ne consomme le quota que sur un envoi
        // réussi (un échec = personne non-contactable, ne doit pas brûler le quota).
        const chk = await checkLimit(db, ACCOUNT_ID, 'dm')
        if (!chk.allowed) return { sent: 0, reason: chk.reason || 'Plafond messages atteint' }

        const personalised = await personalize(campaign.message_template, n.commenter_name, campaign.magnet_url)
        try {
          const chat = (await startNewChat(ACCOUNT_ID, providerId, personalised)) as { id?: string }
          await logAction(db, ACCOUNT_ID, 'dm')
          // Réponse publique au commentaire (« Envoyé en MP ✅ »), best-effort.
          const commentRepliedAt = await maybeReplyToComment(db, ACCOUNT_ID, socialId, campaign, n)
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
            chat_id: chat?.id || null,
            followup_due_at: followupDue,
            comment_replied_at: commentRepliedAt,
          })
          await db.from('lead_magnet_campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', campaign.id)
          return { sent: 1, campaign: campaign.name, name: n.commenter_name, step: 'dm' }
        } catch (err) {
          // DM impossible (souvent 2e degré / messagerie fermée).
          // Option : au lieu d'échouer, on envoie une DEMANDE DE CONNEXION avec
          // une note (qui porte la ressource) → le 2e degré devient un lead.
          if (campaign.invite_on_fail) {
            const invChk = await checkLimit(db, ACCOUNT_ID, 'invite')
            if (invChk.allowed) {
              const note = (await personalize(campaign.invite_note?.trim() || DEFAULT_INVITE_NOTE, n.commenter_name, campaign.magnet_url)).slice(0, 290)
              try {
                await sendLinkedInInvitation(ACCOUNT_ID, providerId, note)
                await logAction(db, ACCOUNT_ID, 'invite')
                const commentRepliedAt = await maybeReplyToComment(db, ACCOUNT_ID, socialId, campaign, n)
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
              } catch {
                // invitation aussi impossible → on marque échec (voir ci-dessous)
              }
            } else {
              // Plafond invitations atteint : on ne marque PAS (retry demain),
              // on passe au commentateur suivant.
              continue
            }
          }
          // Ni DM ni invitation → on marque [ÉCHEC] pour ne pas boucler dessus.
          sentSet.add(providerId)
          await db
            .from('lead_magnet_sends')
            .insert({
              campaign_id: campaign.id,
              commenter_provider_id: providerId,
              commenter_name: n.commenter_name,
              commenter_profile_url: n.commenter_profile_url,
              comment_text: n.comment_text,
              message_sent: `[ÉCHEC] ${String(err).slice(0, 180)}`,
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
