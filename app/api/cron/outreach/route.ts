// Cron endpoint du séquenceur outbound. Chaque appel fait UN seul envoi, sur
// la première campagne (ordre aléatoire) qui a quelque chose à faire : d'abord les follow-ups
// dus, sinon le 1er message au meilleur profil approuvé. Le runner GitHub
// Actions rappelle en boucle, espacé de plusieurs minutes, comme un humain.
// Auth: header "Authorization: Bearer ${CRON_SECRET}".

import { getServerSupabase } from '@/lib/supabase'
import { advanceCampaign } from '@/lib/outreach-runner'
import { MIN_GAP_SEC, secondsSinceLastSend } from '@/lib/limits'
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

    // Un envoi vient de partir (autre session : acceptations…) → on attend.
    const gap = await secondsSinceLastSend(db)
    if (gap < MIN_GAP_SEC) {
      return Response.json({ ok: true, sent: 0, wait: true, reason: `Dernier envoi il y a ${Math.round(gap)}s` })
    }

    // UN seul envoi par appel, toutes campagnes confondues (sinon rafale de
    // 5 envois en 45 s). Ordre mélangé pour que les campagnes alternent.
    const shuffled = [...list].sort(() => Math.random() - 0.5)
    const results = []
    let totalSent = 0
    for (const campaign of shuffled) {
      try {
        const r = await advanceCampaign(db, campaign)
        totalSent += r.sent
        results.push({ campaign: campaign.name, ...r })
        if (r.sent > 0) break
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
