import { getServerSupabase } from '@/lib/supabase'
import { searchPeopleBySearchUrl, startNewChat, sendMessage, getChatMessages, getChats } from '@/lib/unipile'
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

function personalize(tpl: string, name: string | null): string {
  const first = (name || '').split(' ')[0] || ''
  return (tpl || '').replace(/\{prenom\}/gi, first).replace(/\{nom\}/gi, name || '')
}

// Balaye les conversations LinkedIn et renvoie provider_id → chat_id. Source de
// vérité fiable pour "déjà contacté" (le CRM est incomplet). On va profond
// (jusqu'à ~2500 chats) pour couvrir aussi les échanges anciens.
async function sweepChats(accountId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let cur: string | undefined = undefined
  let pages = 0
  while (pages < 25) {
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
}

// ÉTAPE 1 — Source les profils d'une URL, les score (IA vs ICP), et les insère
// en 'sourced' (dédup contre TOUTES les campagnes). Diagnostique : on distingue
// les vrais doublons, les profils sans identifiant exploitable, et les erreurs
// d'insertion — pour ne plus jamais avoir un "À valider = 0" inexpliqué.
export async function sourceCampaign(db: Db, campaign: OutreachCampaign): Promise<SourceResult> {
  if (!campaign.search_url) throw new Error('Cette campagne n’a pas d’URL de recherche.')
  const accountId = await accountFor(db, campaign.linkedin_account_id)

  // LinkedIn ne renvoie qu'une page (~10 profils) par requête → on pagine via le
  // cursor pour ramener toute la recherche. On va jusqu'à ~400 profils (40 pages)
  // pour couvrir toute une recherche de niche en 1re connexion, tout en restant
  // raisonnable (anti-ban : c'est Unipile qui cadence les appels LinkedIn).
  const MAX_ITEMS = 400
  const MAX_PAGES = 40
  const items: Awaited<ReturnType<typeof searchPeopleBySearchUrl>>['items'] = []
  let cursor: string | undefined = undefined
  let pages = 0
  let exhausted = false
  while (items.length < MAX_ITEMS && pages < MAX_PAGES) {
    const res: Awaited<ReturnType<typeof searchPeopleBySearchUrl>> =
      await searchPeopleBySearchUrl(accountId, campaign.search_url, cursor)
    pages++
    items.push(...res.items)
    if (!res.cursor || !res.items.length) { exhausted = true; break }
    cursor = res.cursor
  }
  const total = items.length

  // Clé d'identité : provider_id (ACoAA…) sinon public_identifier — pour dédup
  // et insertion même si Unipile ne renvoie pas toujours le provider_id.
  const idOf = (p: (typeof items)[number]) => p.provider_id || p.public_identifier || null

  const ids = items.map(idOf).filter(Boolean) as string[]
  const inCampaign = new Set<string>()
  if (ids.length) {
    const { data: byProv } = await db.from('outreach_targets').select('provider_id, public_identifier').in('provider_id', ids)
    ;(byProv || []).forEach((r) => { if (r.provider_id) inCampaign.add(r.provider_id); if (r.public_identifier) inCampaign.add(r.public_identifier) })
  }

  // Conversations LinkedIn existantes → provider_id : chat_id, pour marquer les
  // prospects "déjà échangé" (source de vérité plus fiable que le CRM).
  let chatByProvider = new Map<string, string>()
  try {
    chatByProvider = await sweepChats(accountId)
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
      score,
      score_reason: reason,
      status: 'sourced',
      chat_id: existingChat,
    })
    if (!error) added++
    else { errors++; if (!error_sample) error_sample = error.message }
  }

  return { added, total, skipped_dup, skipped_noid, errors, error_sample, has_more: !exhausted }
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
  const sentToday = await sentTodayCount(db, campaign.id)
  if (sentToday >= (campaign.daily_cap || 15)) {
    return { sent: 0, skipped_reason: `Plafond campagne atteint (${sentToday}/${campaign.daily_cap})` }
  }

  const accountId = await accountFor(db, campaign.linkedin_account_id)

  // Priorité 1 : follow-ups dus.
  if (campaign.msg2) {
    const { data: due } = await db
      .from('outreach_targets')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('status', 'msg1_sent')
      .lte('next_action_at', new Date().toISOString())
      .order('next_action_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (due) {
      // Répondu ? → stop.
      if (due.chat_id) {
        try {
          const msgs = await getChatMessages(due.chat_id, 5)
          const last = msgs[0]
          if (last && !(last.is_sender === 1 || last.is_sender === true)) {
            await db.from('outreach_targets').update({ status: 'replied' }).eq('id', due.id)
            return { sent: 0, step: 'stop-reply', target: due.name }
          }
        } catch { /* on tente le follow-up quand même */ }
      }
      const g = await guard(db, accountId, 'dm')
      if (!g.allowed) return { sent: 0, skipped_reason: g.reason }
      try {
        const text = personalize(campaign.msg2, due.name)
        if (due.chat_id) await sendMessage(due.chat_id, text)
        else await startNewChat(accountId, due.provider_id!, text)
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

  // Priorité 2 : 1er message aux approuvés.
  const { data: appr } = await db
    .from('outreach_targets')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('status', 'approved')
    .order('score', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!appr) return { sent: 0, skipped_reason: 'Aucun approuvé en attente' }

  const g = await guard(db, accountId, 'dm')
  if (!g.allowed) return { sent: 0, skipped_reason: g.reason }
  try {
    const text = personalize(campaign.msg1, appr.name)
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
