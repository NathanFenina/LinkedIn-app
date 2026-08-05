import { getServerSupabase } from '@/lib/supabase'
import { searchPeopleBySearchUrl, startNewChat, sendMessage, getChatMessages } from '@/lib/unipile'
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

// ÉTAPE 1 — Source les profils d'une URL, les score (IA vs ICP), et les insère
// en 'sourced' (dédup contre TOUTES les campagnes + les contacts déjà échangés).
export async function sourceCampaign(db: Db, campaign: OutreachCampaign): Promise<{ added: number; total: number; skipped_dup: number }> {
  if (!campaign.search_url) return { added: 0, total: 0, skipped_dup: 0 }
  const accountId = await accountFor(db, campaign.linkedin_account_id)
  const { items } = await searchPeopleBySearchUrl(accountId, campaign.search_url)

  const ids = items.map((p) => p.provider_id).filter(Boolean) as string[]
  // Déjà dans une campagne outreach (n'importe laquelle) ?
  const inCampaign = new Set<string>()
  if (ids.length) {
    const { data } = await db.from('outreach_targets').select('provider_id').in('provider_id', ids)
    ;(data || []).forEach((r) => r.provider_id && inCampaign.add(r.provider_id))
  }

  let added = 0
  let skipped = 0
  for (const p of items) {
    if (!p.provider_id) continue
    if (inCampaign.has(p.provider_id)) { skipped++; continue }
    let score = 5
    let reason = ''
    try {
      const s = await scoreProfile({ name: p.name || '', jobTitle: p.headline || null, myBusinessContext: DEFAULT_CONTEXT })
      score = s.score; reason = s.reason
    } catch { /* score par défaut */ }
    const { error } = await db.from('outreach_targets').insert({
      campaign_id: campaign.id,
      provider_id: p.provider_id,
      name: p.name,
      headline: p.headline,
      profile_url: p.profile_url,
      public_identifier: p.public_identifier,
      score,
      score_reason: reason,
      status: 'sourced',
    })
    if (!error) added++
    else skipped++
  }
  return { added, total: items.length, skipped_dup: skipped }
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
        await db.from('outreach_targets').update({ status: 'done', last_sent_at: new Date().toISOString() }).eq('id', due.id)
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
    const res = (await startNewChat(accountId, appr.provider_id!, text)) as { id?: string }
    const nextAt = new Date(Date.now() + (campaign.followup_days || 3) * 86400000).toISOString()
    await db.from('outreach_targets').update({
      status: campaign.msg2 ? 'msg1_sent' : 'done',
      chat_id: res?.id || null,
      last_sent_at: new Date().toISOString(),
      next_action_at: campaign.msg2 ? nextAt : null,
    }).eq('id', appr.id)
    return { sent: 1, step: 'msg1', target: appr.name }
  } catch (err) {
    await db.from('outreach_targets').update({ status: 'error', error: String(err).slice(0, 300) }).eq('id', appr.id)
    return { sent: 0, error: String(err) }
  }
}
