import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'

// Cockpit — agrégation LECTURE SEULE (aucune écriture ici, ne touche à aucun
// cron/runner). Tunnel par campagne (Envoyés → Retours → Succès), semaine par
// semaine, moteurs de fond, et leads chauds à traiter.
export const maxDuration = 60

export async function GET() {
  try {
    const db = getServerSupabase()
    const accountId = await getActiveAccountId().catch(() => '')
    const now = Date.now()
    const day = 86400000
    const w0 = new Date(now - 7 * day).toISOString() // il y a 7j
    const w1 = new Date(now - 14 * day).toISOString() // il y a 14j

    const cnt = async (builder: PromiseLike<{ count: number | null }>) => (await builder).count || 0

    // ---- Campagnes : tunnel Envoyés → Retours → Succès ----
    const { data: outCampaigns } = await db.from('outreach_campaigns').select('id,name,active')
    const outreach = await Promise.all(
      (outCampaigns || []).map(async (c) => {
        const [envoyes, retours, succes] = await Promise.all([
          cnt(db.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).in('status', ['msg1_sent', 'msg2_sent', 'done', 'replied'])),
          cnt(db.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'replied')),
          cnt(db.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('rdv', true)),
        ])
        return { type: 'Outreach', name: c.name, active: c.active, envoyes, retours, succes }
      })
    )

    const { data: lmCampaigns } = await db.from('lead_magnet_campaigns').select('id,name,active')
    const leadmagnets = await Promise.all(
      (lmCampaigns || []).map(async (c) => {
        const [envoyes, retours, succes] = await Promise.all([
          cnt(db.from('lead_magnet_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).not('message_sent', 'ilike', '[%')),
          cnt(db.from('lead_magnet_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('replied', true)),
          cnt(db.from('lead_magnet_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('rdv', true)),
        ])
        return { type: 'Lead-magnet', name: c.name, active: c.active, envoyes, retours, succes }
      })
    )

    // ---- Semaine par semaine (2 dernières) ----
    const dmWeek = async (since: string, until?: string) => {
      let q = db.from('linkedin_actions').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('type', 'dm').gte('created_at', since)
      if (until) q = q.lt('created_at', until)
      return cnt(q)
    }
    const repliesWeek = async (since: string, until?: string) => {
      const one = async (table: 'outreach_targets' | 'lead_magnet_sends') => {
        let q = db.from(table).select('id', { count: 'exact', head: true }).not('replied_at', 'is', null).gte('replied_at', since)
        if (until) q = q.lt('replied_at', until)
        return cnt(q)
      }
      const [a, b] = await Promise.all([one('outreach_targets'), one('lead_magnet_sends')])
      return a + b
    }
    const [dmThis, dmPrev, repThis, repPrev] = await Promise.all([
      dmWeek(w0), dmWeek(w1, w0), repliesWeek(w0), repliesWeek(w1, w0),
    ])

    // ---- Moteurs de fond (pas des campagnes, juste "ça tourne") ----
    const { data: commentCampaigns } = await db.from('comment_campaigns').select('id,active')
    const commentsActive = (commentCampaigns || []).some((c) => c.active)
    const commentsPosted7j = await cnt(
      db.from('comment_sends').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('posted_at', w0)
    )
    const { data: autoCfg } = await db.from('auto_accept_config').select('enabled').limit(1).maybeSingle()
    const accepted7j = await cnt(db.from('accepted_invites').select('id', { count: 'exact', head: true }).gte('accepted_at', w0))

    // ---- Leads chauds (ont répondu) ----
    const outMap = new Map((outCampaigns || []).map((c) => [c.id, c.name]))
    const lmMap = new Map((lmCampaigns || []).map((c) => [c.id, c.name]))
    const { data: outReplied } = await db
      .from('outreach_targets')
      .select('id,name,provider_id,chat_id,campaign_id,replied_at,rdv')
      .eq('status', 'replied')
      .order('replied_at', { ascending: false, nullsFirst: false })
      .limit(40)
    const { data: lmReplied } = await db
      .from('lead_magnet_sends')
      .select('id,commenter_name,commenter_provider_id,commenter_profile_url,campaign_id,replied_at,rdv')
      .eq('replied', true)
      .order('replied_at', { ascending: false, nullsFirst: false })
      .limit(40)

    const hot = [
      ...(outReplied || []).map((r) => ({
        id: r.id as string, source: 'outreach' as const,
        name: r.name as string | null, campaign: outMap.get(r.campaign_id) || null,
        provider_id: r.provider_id as string | null, profile_url: null as string | null,
        when: r.replied_at as string | null, rdv: !!r.rdv,
      })),
      ...(lmReplied || []).map((r) => ({
        id: r.id as string, source: 'lead-magnet' as const,
        name: r.commenter_name as string | null, campaign: lmMap.get(r.campaign_id) || null,
        provider_id: r.commenter_provider_id as string | null, profile_url: r.commenter_profile_url as string | null,
        when: r.replied_at as string | null, rdv: !!r.rdv,
      })),
    ].sort((a, b) => (b.when || '').localeCompare(a.when || ''))

    return Response.json({
      campaigns: [...outreach, ...leadmagnets],
      weekly: {
        this: { dm: dmThis, replies: repThis },
        prev: { dm: dmPrev, replies: repPrev },
      },
      engines: {
        comments: { active: commentsActive, posted_7j: commentsPosted7j },
        autoAccept: { active: !!autoCfg?.enabled, accepted_7j: accepted7j },
      },
      hot: { count: hot.length, items: hot.slice(0, 40) },
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
