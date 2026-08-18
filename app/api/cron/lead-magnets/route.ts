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
import { getPostComments, startNewChat, normalizeComment, resolvePostSocialId } from '@/lib/unipile'
import { guard } from '@/lib/limits'
import { extractFirstName } from '@/lib/gemini'

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

// Envoie AU PLUS UN DM sur l'ensemble des campagnes candidates. Renvoie
// { sent, campaign?, name? } — sent=0 signifie "plus rien à envoyer" (fin de
// session pour la boucle GitHub Actions).
async function sendOne(
  db: ReturnType<typeof getServerSupabase>,
  campaignId: string | null
): Promise<{ sent: number; campaign?: string; name?: string | null; reason?: string }> {
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

        const g = await guard(db, ACCOUNT_ID, 'dm')
        if (!g.allowed) return { sent: 0, reason: g.reason || 'Plafond messages atteint' }

        const personalised = await personalize(campaign.message_template, n.commenter_name, campaign.magnet_url)
        try {
          await startNewChat(ACCOUNT_ID, providerId, personalised)
          await db.from('lead_magnet_sends').insert({
            campaign_id: campaign.id,
            commenter_provider_id: providerId,
            commenter_name: n.commenter_name,
            commenter_profile_url: n.commenter_profile_url,
            comment_text: n.comment_text,
            message_sent: personalised,
          })
          await db.from('lead_magnet_campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', campaign.id)
          return { sent: 1, campaign: campaign.name, name: n.commenter_name }
        } catch (err) {
          // Erreur d'envoi sur ce commentateur : on le note comme traité pour
          // ne pas boucler dessus, et on rendra la main (sent=0 → la boucle
          // réessaiera au prochain tour avec le suivant).
          return { sent: 0, reason: `${n.commenter_name}: ${String(err)}` }
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
