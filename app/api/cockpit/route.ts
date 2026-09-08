import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'

// Cockpit : agrégation LECTURE SEULE des données existantes (aucune écriture,
// ne touche à aucun cron/runner). Renvoie : leads chauds (répondu), stats 7j
// glissants vs 7j précédents, et l'état de toutes les campagnes.
export const maxDuration = 60

type Db = ReturnType<typeof getServerSupabase>

async function countActions(db: Db, accountId: string, type: string, sinceISO: string, untilISO?: string): Promise<number> {
  let q = db.from('linkedin_actions').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('type', type).gte('created_at', sinceISO)
  if (untilISO) q = q.lt('created_at', untilISO)
  const { count } = await q
  return count || 0
}

async function countReplies(db: Db, table: 'outreach_targets' | 'lead_magnet_sends', sinceISO: string, untilISO?: string): Promise<number> {
  let q = db.from(table).select('id', { count: 'exact', head: true }).not('replied_at', 'is', null).gte('replied_at', sinceISO)
  if (untilISO) q = q.lt('replied_at', untilISO)
  const { count } = await q
  return count || 0
}

export async function GET() {
  try {
    const db = getServerSupabase()
    const accountId = await getActiveAccountId().catch(() => '')
    const now = Date.now()
    const day = 86400000
    const week = new Date(now - 7 * day).toISOString()
    const prevWeek = new Date(now - 14 * day).toISOString()

    // ---- Stats 7j vs 7j précédents ----
    const types = ['dm', 'comment', 'invite', 'accept', 'profile_view'] as const
    const [wk, pv] = await Promise.all([
      Promise.all(types.map((t) => countActions(db, accountId, t, week))),
      Promise.all(types.map((t) => countActions(db, accountId, t, prevWeek, week))),
    ])
    const mk = (arr: number[]) => ({ dm: arr[0], comment: arr[1], invite: arr[2], accept: arr[3], profile_view: arr[4] })
    const [repOutW, repLmW, repOutP, repLmP] = await Promise.all([
      countReplies(db, 'outreach_targets', week),
      countReplies(db, 'lead_magnet_sends', week),
      countReplies(db, 'outreach_targets', prevWeek, week),
      countReplies(db, 'lead_magnet_sends', prevWeek, week),
    ])

    // ---- Leads chauds (ont répondu) ----
    const { data: outCampaigns } = await db.from('outreach_campaigns').select('id,name,active,daily_cap')
    const outMap = new Map((outCampaigns || []).map((c) => [c.id, c.name]))
    const { data: outReplied } = await db
      .from('outreach_targets')
      .select('id,name,provider_id,chat_id,campaign_id,replied_at,last_sent_at')
      .eq('status', 'replied')
      .order('replied_at', { ascending: false, nullsFirst: false })
      .limit(40)
    const { data: lmCampaigns } = await db.from('lead_magnet_campaigns').select('id,name,active,auto_run')
    const lmMap = new Map((lmCampaigns || []).map((c) => [c.id, c.name]))
    const { data: lmReplied } = await db
      .from('lead_magnet_sends')
      .select('id,commenter_name,commenter_profile_url,campaign_id,replied_at')
      .eq('replied', true)
      .order('replied_at', { ascending: false, nullsFirst: false })
      .limit(40)

    const hot = [
      ...(outReplied || []).map((r) => ({
        source: 'outreach' as const,
        name: r.name as string | null,
        campaign: outMap.get(r.campaign_id) || null,
        link: null as string | null,
        when: r.replied_at as string | null,
      })),
      ...(lmReplied || []).map((r) => ({
        source: 'lead-magnet' as const,
        name: r.commenter_name as string | null,
        campaign: lmMap.get(r.campaign_id) || null,
        link: r.commenter_profile_url as string | null,
        when: r.replied_at as string | null,
      })),
    ].sort((a, b) => (b.when || '').localeCompare(a.when || ''))

    // ---- État des campagnes ----
    const { data: commentCampaigns } = await db.from('comment_campaigns').select('id,name,active,auto_generate,daily_cap')
    const commentsOverview = await Promise.all(
      (commentCampaigns || []).map(async (c) => {
        const [{ count: drafts }, { count: total }, { count: postedToday }] = await Promise.all([
          db.from('comment_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'draft'),
          db.from('comment_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'sent'),
          db.from('comment_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'sent').gte('posted_at', new Date(now - day).toISOString()),
        ])
        return { name: c.name, active: c.active, auto: c.auto_generate, drafts: drafts || 0, posted_total: total || 0, posted_24h: postedToday || 0 }
      })
    )

    const outreachOverview = await Promise.all(
      (outCampaigns || []).map(async (c) => {
        const [{ count: enFile }, { count: enSeq }, { count: repl }, { count: done }] = await Promise.all([
          db.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'approved'),
          db.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'msg1_sent'),
          db.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'replied'),
          db.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).in('status', ['msg2_sent', 'done']),
        ])
        return { name: c.name, active: c.active, en_file: enFile || 0, en_sequence: enSeq || 0, replied: repl || 0, done: done || 0 }
      })
    )

    const leadmagnetsOverview = await Promise.all(
      (lmCampaigns || []).map(async (c) => {
        const [{ count: sent }, { count: replied }] = await Promise.all([
          db.from('lead_magnet_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).not('message_sent', 'ilike', '[ÉCHEC]%').not('message_sent', 'ilike', '[INVITÉ]%').not('message_sent', 'ilike', '[COMMENT]%'),
          db.from('lead_magnet_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('replied', true),
        ])
        return { name: c.name, active: c.active, auto: c.auto_run, sent: sent || 0, replied: replied || 0 }
      })
    )

    const { data: autoCfg } = await db.from('auto_accept_config').select('enabled').limit(1).maybeSingle()
    const { count: acceptedWeek } = await db.from('accepted_invites').select('id', { count: 'exact', head: true }).gte('accepted_at', week)

    return Response.json({
      hot: { count: hot.length, items: hot.slice(0, 30) },
      stats: {
        week: { ...mk(wk), replies: repOutW + repLmW },
        prev: { ...mk(pv), replies: repOutP + repLmP },
      },
      campaigns: {
        comments: commentsOverview,
        outreach: outreachOverview,
        leadmagnets: leadmagnetsOverview,
        autoAccept: { enabled: !!autoCfg?.enabled, accepted_7j: acceptedWeek || 0 },
      },
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
