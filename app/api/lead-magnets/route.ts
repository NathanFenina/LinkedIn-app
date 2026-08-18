import { getServerSupabase } from '@/lib/supabase'
import { extractPostIdFromUrl, resolvePostSocialId } from '@/lib/unipile'
import { getActiveAccount, getActiveAccountId, getActiveAccountRowId, scopeQueryToAccount } from '@/lib/account'

export async function GET() {
  try {
    const db = getServerSupabase()
    let query = db.from('lead_magnet_campaigns').select('*')
    try {
      const account = await getActiveAccount()
      query = scopeQueryToAccount(query, account)
    } catch {}
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw error

    // Nombre de DM déjà envoyés par campagne (pour la barre de progression /
    // l'état de la distribution dans l'app).
    const campaigns = data || []
    const withCounts = await Promise.all(
      campaigns.map(async (c: { id: string }) => {
        const { count } = await db
          .from('lead_magnet_sends')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', c.id)
        return { ...c, sent_count: count || 0 }
      })
    )
    return Response.json(withCounts)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, post_url, trigger_keyword, message_template, magnet_url } = body
  const min_comments = Math.max(0, Number(body.min_comments) || 0)
  const auto_run = !!body.auto_run

  if (!name?.trim() || !post_url?.trim() || !message_template?.trim()) {
    return Response.json(
      { error: 'name, post_url, message_template requis' },
      { status: 400 }
    )
  }
  try {
    const db = getServerSupabase()
    // Résout directement le social_id canonique (urn:li:activity:...) via getPost.
    // Fallback sur l'extraction brute si l'API échoue — le run/cron re-résoudra.
    const social_id = await getActiveAccountId()
      .then((accId) => resolvePostSocialId(accId, null, post_url))
      .catch(() => extractPostIdFromUrl(post_url))
    const accountRowId = await getActiveAccountRowId().catch(() => null)
    const { data, error } = await db
      .from('lead_magnet_campaigns')
      .insert({
        name: name.trim(),
        post_url: post_url.trim(),
        social_id,
        trigger_keyword: trigger_keyword?.trim() || null,
        message_template: message_template.trim(),
        magnet_url: magnet_url?.trim() || null,
        min_comments,
        auto_run,
        active: true,
        linkedin_account_id: accountRowId,
      })
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
