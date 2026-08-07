import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccount, getActiveAccountRowId, scopeQueryToAccount } from '@/lib/account'
import { errMsg } from '@/lib/utils'

// Liste des campagnes outbound (séquenceur) + un compteur de cibles par statut.
export async function GET() {
  try {
    const db = getServerSupabase()
    let query = db.from('outreach_campaigns').select('*')
    try {
      const account = await getActiveAccount()
      query = scopeQueryToAccount(query, account)
    } catch {}
    const { data: campaigns, error } = await query.order('created_at', { ascending: false })
    if (error) throw error

    // Comptage des cibles par statut (une seule requête, agrégée côté serveur).
    const ids = (campaigns || []).map((c) => c.id)
    const counts: Record<string, Record<string, number>> = {}
    if (ids.length) {
      const { data: targets } = await db
        .from('outreach_targets')
        .select('campaign_id, status')
        .in('campaign_id', ids)
      for (const t of targets || []) {
        counts[t.campaign_id] ||= {}
        counts[t.campaign_id][t.status] = (counts[t.campaign_id][t.status] || 0) + 1
      }
    }

    return Response.json({ campaigns: campaigns || [], counts })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json()
  const name = String(body.name || '').trim()
  const search_url = String(body.search_url || '').trim()
  const msg1 = String(body.msg1 || '').trim()

  if (!name) return Response.json({ error: 'name requis' }, { status: 400 })
  if (!search_url) return Response.json({ error: 'URL de recherche LinkedIn requise' }, { status: 400 })
  if (!msg1) return Response.json({ error: 'Message initial requis' }, { status: 400 })

  try {
    const db = getServerSupabase()
    const accountRowId = await getActiveAccountRowId().catch(() => null)
    const { data, error } = await db
      .from('outreach_campaigns')
      .insert({
        name,
        search_url,
        msg1,
        msg2: String(body.msg2 || '').trim() || null,
        followup_days: Math.max(1, Number(body.followup_days) || 3),
        daily_cap: Math.max(1, Number(body.daily_cap) || 15),
        active_hour_start: body.active_hour_start == null ? 9 : Number(body.active_hour_start),
        active_hour_end: body.active_hour_end == null ? 18 : Number(body.active_hour_end),
        active: body.active !== false,
        linkedin_account_id: accountRowId,
      })
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
