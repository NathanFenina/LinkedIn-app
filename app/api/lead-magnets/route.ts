import { getServerSupabase } from '@/lib/supabase'
import { extractPostIdFromUrl } from '@/lib/unipile'
import { getActiveAccountRowId } from '@/lib/account'

export async function GET() {
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('lead_magnet_campaigns')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return Response.json(data)
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
    const social_id = extractPostIdFromUrl(post_url)
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
