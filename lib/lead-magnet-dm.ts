import { getServerSupabase } from '@/lib/supabase'
import { pickVariant } from '@/lib/outreach-runner'
import { extractFirstName } from '@/lib/gemini'

type Db = ReturnType<typeof getServerSupabase>

export const WEBINAR_LINK = /linkedin\.com\/events\//i

// {prenom} = prénom nettoyé par l'IA (si utilisé), {name} = 1er mot, {magnet_url} = ressource.
export async function personalizeLM(template: string, commenterName: string | null, magnetUrl: string | null): Promise<string> {
  const quickFirst = (commenterName || '').split(' ')[0] || ''
  let prenom = quickFirst
  if (/\{prenom\}/i.test(template)) prenom = (await extractFirstName(commenterName || '')) || quickFirst
  return template
    .replace(/\{prenom\}/gi, prenom)
    .replace(/\{name\}/gi, quickFirst)
    .replace(/\{magnet_url\}/gi, magnetUrl || '')
}

// La personne a-t-elle déjà reçu l'invitation au workshop (lead-magnet ou outbound) ?
export async function alreadyWorkshopInvited(db: Db, providerId: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    db.from('lead_magnet_sends').select('id').eq('commenter_provider_id', providerId).not('webinar_invited_at', 'is', null).limit(1),
    db.from('outreach_targets').select('id').eq('provider_id', providerId).not('webinar_invited_at', 'is', null).limit(1),
  ])
  return !!(a.data && a.data.length) || !!(b.data && b.data.length)
}

export async function isDoNotContact(db: Db, providerId: string): Promise<boolean> {
  const { data } = await db.from('do_not_contact').select('provider_id').eq('provider_id', providerId).limit(1)
  return !!(data && data.length)
}

export type LMDmCampaign = { message_template: string; magnet_url: string | null; workshop_ps?: string | null }

// DM lead-magnet : 1 variante de la ressource + (si workshop_ps) 1 variante du PS
// workshop, UNIQUEMENT si la personne n'a jamais été invitée au workshop.
export async function buildLeadMagnetDM(db: Db, campaign: LMDmCampaign, name: string | null, providerId: string): Promise<{ text: string; webinar: boolean }> {
  let tpl = pickVariant(campaign.message_template).text
  if (campaign.workshop_ps?.trim() && !(await alreadyWorkshopInvited(db, providerId))) {
    tpl = `${tpl}\n\n${pickVariant(campaign.workshop_ps).text}`
  }
  const text = await personalizeLM(tpl, name, campaign.magnet_url)
  return { text, webinar: WEBINAR_LINK.test(text) }
}
