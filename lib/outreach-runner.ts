import { getServerSupabase } from '@/lib/supabase'
import { searchPeopleBySearchUrl, startNewChat, sendMessage, getChatMessages, getChats, getConnections, sendLinkedInInvitation } from '@/lib/unipile'
import { scoreProfile } from '@/lib/gemini'
import { getActiveAccountId } from '@/lib/account'
import { guard } from '@/lib/limits'
import type { OutreachCampaign } from '@/types'

type Db = ReturnType<typeof getServerSupabase>

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT || 'Agence/freelance SEO et acquisition B2B.'

async function accountFor(db: Db, linkedin_account_id: string | null): Promise<string> {
  if (linkedin_account_id) {
    const { data } = await db.from('linkedin_accounts').select('unipile_account_id').eq('id', linkedin_account_id).maybeSingle()
    if (data?.unipile_account_id) return data.unipile_account_id
  }
  return getActiveAccountId()
}

// Devine l'entreprise depuis la tagline LinkedIn ("CMO @ Acme", "Head of
// Marketing chez Acme | ex-X", "Growth · Acme"). Renvoie null si rien de
// fiable — on ne veut JAMAIS d'un faux nom de boîte dans un message.
export function companyFromHeadline(headline: string | null): string | null {
  const h = (headline || '').replace(/\s+/g, ' ').trim()
  if (!h) return null
  const m = h.match(/(?:@|\bchez\b|\bat\b|·)\s*([^|·@,()\-–—]{2,40})/i)
  if (!m) return null
  const c = m[1]
    .trim()
    .replace(/\s+(ex-?.*)$/i, '')
    .replace(/[^\p{L}\p{N}).&'’-]+$/u, '') // emojis / symboles en fin ("Electra ⚡")
    .trim()
  // Écarte les faux positifs : trop court, mots vides, ou intitulé de poste
  // générique pris pour une boîte ("Growth Marketing", "SEO").
  if (c.length < 2) return null
  if (/^(the|la|le|les|un|une|home|remote|freelance|indépendant)$/i.test(c)) return null
  if (/^(growth|marketing|seo|digital|acquisition|consultant|freelance|content|brand|performance)( (marketing|growth|seo|digital|manager|hacker|specialist))*$/i.test(c)) return null
  return c
}

// {prenom} = 1er mot du nom, {nom} = nom complet, {entreprise} = boîte connue
// sinon repli neutre "ta boîte" (jamais de placeholder brut envoyé).
function personalize(tpl: string, name: string | null, company?: string | null): string {
  const first = (name || '').split(' ')[0] || ''
  const ent = (company || '').trim() || 'ta boîte'
  return (tpl || '')
    .replace(/\{prenom\}/gi, first)
    .replace(/\{nom\}/gi, name || '')
    .replace(/\{entreprise\}/gi, ent)
}

// Balaye les conversations LinkedIn et renvoie provider_id → chat_id. Source de
// vérité fiable pour "déjà contacté" (le CRM est incomplet). `maxPages` borne la
// profondeur : peu au sourcing (rapide), beaucoup au "Re-scan historique".
async function sweepChats(accountId: string, maxPages = 25): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let cur: string | undefined = undefined
  let pages = 0
  while (pages < maxPages) {
    const { items: chats, cursor: next } = await getChats(accountId, 100, cur)
    pages++
    for (const ch of chats) if (ch.attendee_provider_id) map.set(ch.attendee_provider_id, ch.id)
    if (!next || !chats.length) break
    cur = next
  }
  return map
}

// Re-scanne l'historique et met à jour chat_id sur les cibles encore à traiter
// (sourced/approved) — pour rattraper les "déjà échangé" ratés au sourcing,
// sans avoir à re-sourcer toute la campagne.
export async function rescanHistory(db: Db, campaign: OutreachCampaign): Promise<{ updated: number; scanned: number }> {
  const accountId = await accountFor(db, campaign.linkedin_account_id)
  const chatByProvider = await sweepChats(accountId)
  const { data: targets } = await db
    .from('outreach_targets')
    .select('id, provider_id, chat_id, status')
    .eq('campaign_id', campaign.id)
    .in('status', ['sourced', 'approved'])
  let updated = 0
  for (const t of targets || []) {
    if (t.chat_id || !t.provider_id) continue
    const chat = chatByProvider.get(t.provider_id)
    if (chat) {
      const { error } = await db.from('outreach_targets').update({ chat_id: chat }).eq('id', t.id)
      if (!error) updated++
    }
  }
  return { updated, scanned: (targets || []).length }
}

export interface SourceResult {
  added: number
  total: number
  skipped_dup: number
  skipped_noid: number
  errors: number
  error_sample?: string
  has_more: boolean // true = LinkedIn a renvoyé plus que ce qu'on a ramené (plafond atteint)
  overlap?: Record<string, number> // audiences (tags/campagnes) auxquelles appartiennent les doublons écartés
}

// ÉTAPE 1 — Source les profils d'une URL, les score (IA vs ICP), et les insère
// en 'sourced' (dédup contre TOUTES les campagnes). Diagnostique : on distingue
// les vrais doublons, les profils sans identifiant exploitable, et les erreurs
// d'insertion — pour ne plus jamais avoir un "À valider = 0" inexpliqué.
export async function sourceCampaign(db: Db, campaign: OutreachCampaign): Promise<SourceResult> {
  if (!campaign.search_url) throw new Error('Cette campagne n’a pas d’URL de recherche.')
  const accountId = await accountFor(db, campaign.linkedin_account_id)

  // LinkedIn ne renvoie qu'une page (~10 profils) par requête. On ramène ~120
  // profils par clic (assez petit pour tenir dans le timeout serverless), en
  // REPRENANT là où le dernier "Sourcer" s'était arrêté (cursor mémorisé sur la
  // campagne) → recliquer "Sourcer" continue la liste sans doublon, au lieu de
  // reprendre du début. Quand la recherche est épuisée, on efface le cursor.
  const MAX_ITEMS = 120
  const MAX_PAGES = 15
  const items: Awaited<ReturnType<typeof searchPeopleBySearchUrl>>['items'] = []
  let cursor: string | undefined = (campaign.source_cursor as string | null) || undefined
  let pages = 0
  let exhausted = false
  while (items.length < MAX_ITEMS && pages < MAX_PAGES) {
    const res: Awaited<ReturnType<typeof searchPeopleBySearchUrl>> =
      await searchPeopleBySearchUrl(accountId, campaign.search_url, cursor)
    pages++
    items.push(...res.items)
    cursor = res.cursor
    if (!res.cursor || !res.items.length) { exhausted = true; break }
  }
  // Mémorise la position pour le prochain clic (ou efface si on a tout ramené).
  await db.from('outreach_campaigns').update({ source_cursor: exhausted ? null : cursor || null }).eq('id', campaign.id)
  const total = items.length

  // Clé d'identité : provider_id (ACoAA…) sinon public_identifier — pour dédup
  // et insertion même si Unipile ne renvoie pas toujours le provider_id.
  const idOf = (p: (typeof items)[number]) => p.provider_id || p.public_identifier || null

  const ids = items.map(idOf).filter(Boolean) as string[]
  const inCampaign = new Set<string>()
  const overlap: Record<string, number> = {}
  if (ids.length) {
    const { data: byProv } = await db.from('outreach_targets').select('provider_id, public_identifier, campaign_id').in('provider_id', ids)
    // Table des audiences (tag sinon nom) pour dire À QUELLE audience appartient
    // chaque doublon écarté.
    const { data: allCamps } = await db.from('outreach_campaigns').select('id, name, tag')
    const audienceOf = new Map((allCamps || []).map((c) => [c.id as string, (c.tag as string) || (c.name as string)]))
    ;(byProv || []).forEach((r) => {
      if (r.provider_id) inCampaign.add(r.provider_id)
      if (r.public_identifier) inCampaign.add(r.public_identifier)
      if (r.campaign_id && r.campaign_id !== campaign.id) {
        const aud = audienceOf.get(r.campaign_id as string) || 'autre'
        overlap[aud] = (overlap[aud] || 0) + 1
      }
    })
    // Liste "ne plus contacter" : on exclut ces personnes de TOUTES les campagnes.
    const { data: dnc } = await db.from('do_not_contact').select('provider_id').in('provider_id', ids)
    ;(dnc || []).forEach((r) => { if (r.provider_id) { inCampaign.add(r.provider_id); overlap['🚫 ne plus contacter'] = (overlap['🚫 ne plus contacter'] || 0) + 1 } })
  }

  // Conversations LinkedIn existantes → provider_id : chat_id, pour marquer les
  // prospects "déjà échangé" (source de vérité plus fiable que le CRM).
  // Balayage léger au sourcing (5 pages ≈ 500 chats récents) pour rester rapide.
  // Le bouton "Re-scan historique" fait un balayage profond ensuite.
  let chatByProvider = new Map<string, string>()
  try {
    chatByProvider = await sweepChats(accountId, 5)
  } catch { /* si l'API chats échoue, on continue sans le marquage */ }

  let added = 0, skipped_dup = 0, skipped_noid = 0, errors = 0
  let error_sample: string | undefined

  // Ne garde que les profils neufs avec un identifiant, puis score en parallèle.
  const fresh = items.filter((p) => {
    const id = idOf(p)
    if (!id) { skipped_noid++; return false }
    if (inCampaign.has(id)) { skipped_dup++; return false }
    return true
  })

  // Scoring par lots de 20 pour ne pas saturer l'API Gemini quand la liste est
  // grande (jusqu'à 400 profils).
  const scored: Array<{ p: (typeof fresh)[number]; score: number; reason: string }> = []
  for (let i = 0; i < fresh.length; i += 20) {
    const chunk = fresh.slice(i, i + 20)
    const part = await Promise.all(chunk.map(async (p) => {
      try {
        const s = await scoreProfile({ name: p.name || '', jobTitle: p.headline || null, myBusinessContext: DEFAULT_CONTEXT })
        return { p, score: s.score, reason: s.reason }
      } catch {
        return { p, score: 5, reason: '' }
      }
    }))
    scored.push(...part)
  }

  for (const { p, score, reason } of scored) {
    // Conversation LinkedIn déjà ouverte avec ce profil ? On pré-remplit chat_id
    // → le prospect s'affichera "déjà échangé" et on réutilisera ce fil.
    const existingChat = p.provider_id ? chatByProvider.get(p.provider_id) || null : null
    const { error } = await db.from('outreach_targets').insert({
      campaign_id: campaign.id,
      provider_id: p.provider_id || null,
      name: p.name,
      headline: p.headline,
      profile_url: p.profile_url,
      public_identifier: p.public_identifier,
      company: companyFromHeadline(p.headline),
      score,
      score_reason: reason,
      status: 'sourced',
      chat_id: existingChat,
    })
    if (!error) added++
    else { errors++; if (!error_sample) error_sample = error.message }
  }

  return { added, total, skipped_dup, skipped_noid, errors, error_sample, has_more: !exhausted, overlap }
}

// Combien envoyés aujourd'hui sur cette campagne (plafond quotidien campagne).
async function sentTodayCount(db: Db, campaignId: string): Promise<number> {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0)
  const { count } = await db
    .from('outreach_targets')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .gte('last_sent_at', start.toISOString())
  return count || 0
}

export interface AdvanceResult { sent: number; step?: string; target?: string; skipped_reason?: string; error?: string }

// ÉTAPE 2 — Avance la séquence d'UN cran pour la campagne (1 envoi max).
//   approved -> envoie msg1 -> msg1_sent (next_action_at = +followup_days)
//   msg1_sent & due & msg2 -> si répondu : replied ; sinon envoie msg2 -> done
export async function advanceCampaign(db: Db, campaign: OutreachCampaign): Promise<AdvanceResult> {
  // Plage horaire (heure de Paris, DST géré par Intl) : on n'envoie jamais en
  // dehors — pas de DM à minuit. Fenêtre vide = pas de restriction.
  if (campaign.active_hour_start != null && campaign.active_hour_end != null) {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date())) % 24
    const s = campaign.active_hour_start, e = campaign.active_hour_end
    const inWindow = s <= e ? (h >= s && h < e) : (h >= s || h < e)
    if (!inWindow) return { sent: 0, skipped_reason: `Hors plage horaire (${s}h-${e}h, il est ${h}h à Paris)` }
  }

  const sentToday = await sentTodayCount(db, campaign.id)
  if (sentToday >= (campaign.daily_cap || 15)) {
    return { sent: 0, skipped_reason: `Plafond campagne atteint (${sentToday}/${campaign.daily_cap})` }
  }

  const accountId = await accountFor(db, campaign.linkedin_account_id)

  // Invitation-first : détecte les invitations ACCEPTÉES (la personne est devenue
  // une connexion) → passe 'invited' → 'connected' pour qu'elle reçoive le msg1.
  if (campaign.invite_first) {
    const { data: invited } = await db
      .from('outreach_targets')
      .select('id, provider_id')
      .eq('campaign_id', campaign.id)
      .eq('status', 'invited')
    if (invited && invited.length) {
      try {
        const conns = new Set<string>()
        let cur: string | undefined = undefined
        for (let p = 0; p < 10; p++) {
          const { items, cursor } = await getConnections(accountId, 200, cur)
          items.forEach((c) => { if (c.provider_id) conns.add(c.provider_id) })
          if (!cursor || !items.length) break
          cur = cursor
        }
        const now = new Date().toISOString()
        for (const t of invited) {
          if (t.provider_id && conns.has(t.provider_id)) {
            await db.from('outreach_targets').update({ status: 'connected', connected_at: now }).eq('id', t.id)
          }
        }
      } catch { /* API relations indispo → on réessaiera au prochain tour */ }
    }
  }

  // Priorité 1 : relances dues. RÈGLE ABSOLUE — jamais de relance à quelqu'un
  // qui a répondu. On purge d'abord toutes les relances "répondu" (statut
  // 'replied'), puis on envoie la 1re relance vraiment légitime. Boucle bornée
  // pour éviter tout emballement.
  if (campaign.msg2) {
    for (let i = 0; i < 200; i++) {
      const { data: due } = await db
        .from('outreach_targets')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('status', 'msg1_sent')
        .lte('next_action_at', new Date().toISOString())
        .order('next_action_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (!due) break // plus aucune relance due

      // Sans fil de conversation connu, impossible de vérifier une réponse ni de
      // continuer le bon thread → on clôt la séquence sans relancer (par sécurité,
      // on ne crée pas un nouveau message "à froid" en guise de relance).
      if (!due.chat_id) {
        await db.from('outreach_targets').update({ status: 'done' }).eq('id', due.id)
        continue
      }

      // Répondu ? On considère "répondu" dès qu'il existe LE MOINDRE message
      // entrant dans le fil (indépendant de l'ordre renvoyé par l'API).
      let replied = false
      try {
        const msgs = await getChatMessages(due.chat_id, 15)
        replied = msgs.some((m) => !(m.is_sender === 1 || m.is_sender === true))
      } catch {
        // Lecture impossible (erreur transitoire) : on NE prend PAS le risque de
        // relancer quelqu'un qui aurait répondu. On laisse la cible en
        // 'msg1_sent' (réessai au prochain tour) et on sort des relances pour
        // tenter un 1er message à la place — pas d'emballement sur cette cible.
        break
      }
      if (replied) {
        await db.from('outreach_targets').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', due.id)
        continue // on ne relance pas — cible suivante
      }

      // Relance légitime (aucune réponse) → on envoie.
      const g = await guard(db, accountId, 'dm')
      if (!g.allowed) return { sent: 0, skipped_reason: g.reason }
      try {
        const text = personalize(campaign.msg2, due.name, due.company || companyFromHeadline(due.headline))
        await sendMessage(due.chat_id, text)
        // 'msg2_sent' = relance envoyée, séquence terminée (statut distinct de
        // 'done' pour que tu voies dans le Suivi qui a reçu 1 vs 2 messages).
        await db.from('outreach_targets').update({ status: 'msg2_sent', last_sent_at: new Date().toISOString() }).eq('id', due.id)
        return { sent: 1, step: 'msg2', target: due.name }
      } catch (err) {
        await db.from('outreach_targets').update({ status: 'error', error: String(err).slice(0, 300) }).eq('id', due.id)
        return { sent: 0, error: String(err) }
      }
    }
  }

  // Priorité 2 : 1er message. En DM direct = aux 'approved'. En invitation-first
  // = aux 'connected' (invitation déjà acceptée).
  const msg1Status = campaign.invite_first ? 'connected' : 'approved'
  const { data: appr } = await db
    .from('outreach_targets')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('status', msg1Status)
    .order('score', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Priorité 3 (invitation-first uniquement) : envoyer une invitation à un
  // 'approved' quand il n'y a personne à messager. La note porte l'accroche.
  if (!appr && campaign.invite_first) {
    const { data: toInvite } = await db
      .from('outreach_targets')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('status', 'approved')
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!toInvite) return { sent: 0, skipped_reason: 'Aucune invitation ni message en attente' }
    if (!toInvite.provider_id) {
      await db.from('outreach_targets').update({ status: 'error', error: 'Pas de provider_id pour inviter' }).eq('id', toInvite.id)
      return { sent: 0, error: 'Pas de provider_id' }
    }
    const gi = await guard(db, accountId, 'invite')
    if (!gi.allowed) return { sent: 0, skipped_reason: gi.reason }
    try {
      const note = personalize(campaign.invite_note || '', toInvite.name, toInvite.company || companyFromHeadline(toInvite.headline)).slice(0, 290)
      await sendLinkedInInvitation(accountId, toInvite.provider_id, note || undefined)
      await db.from('outreach_targets').update({ status: 'invited', invited_at: new Date().toISOString() }).eq('id', toInvite.id)
      return { sent: 1, step: 'invite', target: toInvite.name }
    } catch (err) {
      await db.from('outreach_targets').update({ status: 'error', error: String(err).slice(0, 300) }).eq('id', toInvite.id)
      return { sent: 0, error: String(err) }
    }
  }

  if (!appr) return { sent: 0, skipped_reason: campaign.invite_first ? 'Aucune invitation acceptée à messager' : 'Aucun approuvé en attente' }

  const g = await guard(db, accountId, 'dm')
  if (!g.allowed) return { sent: 0, skipped_reason: g.reason }
  try {
    const text = personalize(campaign.msg1, appr.name, appr.company || companyFromHeadline(appr.headline))
    // Conversation déjà ouverte (détectée au sourcing) → on continue le fil au
    // lieu d'en créer un doublon.
    let chatId = appr.chat_id as string | null
    if (chatId) await sendMessage(chatId, text)
    else {
      const res = (await startNewChat(accountId, appr.provider_id!, text)) as { id?: string }
      chatId = res?.id || null
    }
    const nextAt = new Date(Date.now() + (campaign.followup_days || 3) * 86400000).toISOString()
    await db.from('outreach_targets').update({
      status: campaign.msg2 ? 'msg1_sent' : 'done',
      chat_id: chatId,
      last_sent_at: new Date().toISOString(),
      next_action_at: campaign.msg2 ? nextAt : null,
    }).eq('id', appr.id)
    return { sent: 1, step: 'msg1', target: appr.name }
  } catch (err) {
    await db.from('outreach_targets').update({ status: 'error', error: String(err).slice(0, 300) }).eq('id', appr.id)
    return { sent: 0, error: String(err) }
  }
}

// DÉTECTION DES RÉPONSES (indépendante des relances). Balaye les cibles déjà
// contactées de TOUTES les campagnes actives et marque 'replied' + replied_at dès
// qu'un message ENTRANT existe dans le fil. Sert à comparer les campagnes sur un
// taux de réponse fiable, sans attendre qu'une relance passe. Lecture seule côté
// LinkedIn (aucun envoi).
export interface SweepRepliesResult { checked: number; replies: number }

export async function sweepReplies(db: Db): Promise<SweepRepliesResult> {
  const { data: campaigns } = await db.from('outreach_campaigns').select('id').eq('active', true)
  let checked = 0, replies = 0
  for (const c of campaigns || []) {
    const { data: targets } = await db
      .from('outreach_targets')
      .select('id, chat_id')
      .eq('campaign_id', c.id)
      .in('status', ['msg1_sent', 'msg2_sent', 'done'])
      .is('replied_at', null)
      .not('chat_id', 'is', null)
      .limit(500)
    for (const t of targets || []) {
      checked++
      try {
        const msgs = await getChatMessages(t.chat_id as string, 15)
        const replied = msgs.some((m) => !(m.is_sender === 1 || m.is_sender === true))
        if (replied) {
          await db.from('outreach_targets').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', t.id)
          replies++
        }
      } catch { /* fil illisible → on réessaiera au prochain passage */ }
    }
  }
  return { checked, replies }
}
