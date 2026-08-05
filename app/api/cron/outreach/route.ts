// Cron endpoint du séquenceur outbound. Chaque appel avance CHAQUE campagne
// active d'un seul cran (1 envoi max par campagne) : d'abord les follow-ups
// dus, sinon le 1er message au meilleur profil approuvé. Le runner GitHub
// Actions rappelle en boucle, espacé de plusieurs minutes, comme un humain.
// Auth: header "Authorization: Bearer ${CRON_SECRET}".

import { getServerSupabase } from '@/lib/supabase'
import { advanceCampaign } from '@/lib/outreach-runner'
import type { OutreachCampaign } from '@/types'

export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const db = getServerSupabase()
    const { data: campaigns } = await db.from('outreach_campaigns').select('*').eq('active', true)
    const list = (campaigns || []) as OutreachCampaign[]
    if (!list.length) return Response.json({ ok: true, campaigns: 0, sent: 0, results: [] })

    const results = []
    let totalSent = 0
    for (const campaign of list) {
      try {
        const r = await advanceCampaign(db, campaign)
        totalSent += r.sent
        results.push({ campaign: campaign.name, ...r })
      } catch (err) {
        results.push({ campaign: campaign.name, error: String(err) })
      }
    }
    return Response.json({ ok: true, campaigns: list.length, sent: totalSent, results })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}
