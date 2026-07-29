import { getServerSupabase } from '@/lib/supabase'
import { generateDrafts } from '@/lib/comment-runner'

export const maxDuration = 300

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const { limit } = await request.json().catch(() => ({}))

  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db
      .from('comment_campaigns')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !campaign) {
      return Response.json({ error: 'Campagne non trouvée' }, { status: 404 })
    }
    const result = await generateDrafts(db, campaign, { limit: Number(limit) || undefined })

    // Renvoie les brouillons créés (pour affichage immédiat).
    const { data: drafts } = await db
      .from('comment_sends')
      .select('*')
      .eq('campaign_id', id)
      .eq('status', 'draft')
      .order('created_at', { ascending: true })

    return Response.json({ ...result, drafts: drafts || [] })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
