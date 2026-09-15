import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'

// Cockpit — agrégation LECTURE SEULE (aucune écriture ici, ne touche à aucun
// cron/runner). Tunnel par campagne (Envoyés → Retours → Succès), semaine par
// semaine, moteurs de fond, et leads chauds à traiter.
export const maxDuration = 60

// Bornes d'une semaine ISO (lundi→dimanche), décalée de `offset` semaines.
function weekBounds(offset: number) {
  const now = new Date()
  const dow = (now.getUTCDay() + 6) % 7 // 0 = lundi
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow - offset * 7))
  const end = new Date(monday.getTime() + 7 * 86400000)
  const sun = new Date(monday.getTime() + 6 * 86400000)
  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return { start: monday.toISOString(), end: end.toISOString(), label: `${fmt(monday)} – ${fmt(sun)}` }
}

export async function GET(request: Request) {
  try {
    const db = getServerSupabase()
    const accountId = await getActiveAccountId().catch(() => '')
    const day = 86400000
    const weekOffset = Math.max(0, Math.min(52, Number(new URL(request.url).searchParams.get('week')) || 0))
    const now = Date.now()
    const w0 = new Date(now - 7 * day).toISOString() // 7 derniers jours (moteurs)

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

    // ---- Semaine sélectionnée (navigation) ----
    const dmIn = async (since: string, until: string) =>
      cnt(db.from('linkedin_actions').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('type', 'dm').gte('created_at', since).lt('created_at', until))
    const commentIn = async (since: string, until: string) =>
      cnt(db.from('linkedin_actions').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('type', 'comment').gte('created_at', since).lt('created_at', until))
    const repliesIn = async (since: string, until: string) => {
      const one = async (table: 'outreach_targets' | 'lead_magnet_sends') =>
        cnt(db.from(table).select('id', { count: 'exact', head: true }).not('replied_at', 'is', null).gte('replied_at', since).lt('replied_at', until))
      const [a, b] = await Promise.all([one('outreach_targets'), one('lead_magnet_sends')])
      return a + b
    }
    const cur = weekBounds(weekOffset)
    const prev = weekBounds(weekOffset + 1)
    const [dmCur, dmPrv, repCur, repPrv, comCur] = await Promise.all([
      dmIn(cur.start, cur.end), dmIn(prev.start, prev.end), repliesIn(cur.start, cur.end), repliesIn(prev.start, prev.end), commentIn(cur.start, cur.end),
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
      .select('id,name,provider_id,chat_id,campaign_id,replied_at,rdv,last_inbound,replied_handled_at,company')
      .eq('status', 'replied')
      .order('replied_at', { ascending: false, nullsFirst: false })
      .limit(60)
    const { data: lmReplied } = await db
      .from('lead_magnet_sends')
      .select('id,commenter_name,commenter_provider_id,commenter_profile_url,campaign_id,replied_at,rdv,last_inbound,replied_handled_at,chat_id')
      .eq('replied', true)
      .order('replied_at', { ascending: false, nullsFirst: false })
      .limit(60)

    // "À traiter" = a répondu et pas encore traité ; les traités restent visibles
    // en dessous (historique), les non-traités d'abord.
    const hot = [
      ...(outReplied || []).map((r) => ({
        id: r.id as string, source: 'outreach' as const,
        name: r.name as string | null, campaign: outMap.get(r.campaign_id) || null,
        company: (r.company as string | null) || null,
        provider_id: r.provider_id as string | null, profile_url: null as string | null,
        when: r.replied_at as string | null, rdv: !!r.rdv,
        last_inbound: (r.last_inbound as string | null) || null,
        handled: !!r.replied_handled_at, has_chat: !!r.chat_id,
      })),
      ...(lmReplied || []).map((r) => ({
        id: r.id as string, source: 'lead-magnet' as const,
        name: r.commenter_name as string | null, campaign: lmMap.get(r.campaign_id) || null,
        company: null as string | null,
        provider_id: r.commenter_provider_id as string | null, profile_url: r.commenter_profile_url as string | null,
        when: r.replied_at as string | null, rdv: !!r.rdv,
        last_inbound: (r.last_inbound as string | null) || null,
        handled: !!r.replied_handled_at, has_chat: !!r.chat_id,
      })),
    ].sort((a, b) => Number(a.handled) - Number(b.handled) || (b.when || '').localeCompare(a.when || ''))

    // ---- Aujourd'hui : ce qui est parti / arrivé depuis minuit (Paris) ----
    const parisDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()) // YYYY-MM-DD
    const todayStart = new Date(`${parisDate}T00:00:00+02:00`).toISOString()
    const { data: sentToday } = await db.from('outreach_targets').select('campaign_id').gte('last_sent_at', todayStart)
    const perCampaign: Record<string, number> = {}
    ;(sentToday || []).forEach((r) => { const n = outMap.get(r.campaign_id) || '?'; perCampaign[n] = (perCampaign[n] || 0) + 1 })
    const [lmToday, invitesToday, acceptedToday, repliesToday] = await Promise.all([
      cnt(db.from('lead_magnet_sends').select('id', { count: 'exact', head: true }).or(`sent_at.gte.${todayStart},followup_sent_at.gte.${todayStart}`)),
      cnt(db.from('outreach_targets').select('id', { count: 'exact', head: true }).gte('invited_at', todayStart)),
      cnt(db.from('outreach_targets').select('id', { count: 'exact', head: true }).gte('connected_at', todayStart)),
      repliesIn(todayStart, new Date(now + day).toISOString()),
    ])

    // ---- À relancer : ont répondu, traités, pas de RDV, silence depuis 3 j+ ----
    const staleBefore = new Date(now - 3 * day).toISOString()
    const { data: stale } = await db
      .from('outreach_targets')
      .select('id,name,company,campaign_id,replied_handled_at,last_inbound')
      .eq('status', 'replied').eq('rdv', false).not('replied_handled_at', 'is', null).lt('replied_handled_at', staleBefore)
      .order('replied_handled_at', { ascending: false }).limit(20)
    const { data: staleLm } = await db
      .from('lead_magnet_sends')
      .select('id,commenter_name,campaign_id,replied_handled_at,last_inbound')
      .eq('replied', true).eq('rdv', false).not('replied_handled_at', 'is', null).lt('replied_handled_at', staleBefore)
      .order('replied_handled_at', { ascending: false }).limit(20)
    const followups = [
      ...(stale || []).map((r) => ({ id: r.id as string, source: 'outreach' as const, name: r.name as string | null, company: (r.company as string | null) || null, campaign: outMap.get(r.campaign_id) || null, since: r.replied_handled_at as string, last_inbound: (r.last_inbound as string | null) || null })),
      ...(staleLm || []).map((r) => ({ id: r.id as string, source: 'lead-magnet' as const, name: r.commenter_name as string | null, company: null as string | null, campaign: lmMap.get(r.campaign_id) || null, since: r.replied_handled_at as string, last_inbound: (r.last_inbound as string | null) || null })),
    ].sort((a, b) => a.since.localeCompare(b.since))

    // ---- Notes du jour (remontées par l'assistant) ----
    const { data: notes } = await db.from('cockpit_notes').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(20)

    return Response.json({
      today: { sent: perCampaign, lead_magnets: lmToday, invites: invitesToday, accepted: acceptedToday, replies: repliesToday },
      followups,
      notes: notes || [],
      campaigns: [...outreach, ...leadmagnets],
      weekly: {
        offset: weekOffset,
        label: cur.label,
        canNext: weekOffset > 0,
        dm: dmCur,
        comment: comCur,
        replies: repCur,
        prev: { dm: dmPrv, replies: repPrv },
      },
      engines: {
        comments: { active: commentsActive, posted_7j: commentsPosted7j },
        autoAccept: { active: !!autoCfg?.enabled, accepted_7j: accepted7j },
      },
      hot: { count: hot.length, todo: hot.filter((h) => !h.handled).length, items: hot.slice(0, 60) },
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
