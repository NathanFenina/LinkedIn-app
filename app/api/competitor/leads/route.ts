import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccount } from '@/lib/account'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const targetId = searchParams.get('target_id')
  const status = searchParams.get('status')
  const minScore = searchParams.get('min_score')
  try {
    const db = getServerSupabase()

    // Leads inherit their account from their target. Resolve allowed target ids first.
    let allowedTargetIds: string[] | null = null
    try {
      const account = await getActiveAccount()
      if (account.id) {
        const { data: targets } = await db
          .from('competitor_targets')
          .select('id, linkedin_account_id')
        allowedTargetIds = (targets || [])
          .filter((t) => {
            if (account.is_default) {
              return t.linkedin_account_id === account.id || t.linkedin_account_id === null
            }
            return t.linkedin_account_id === account.id
          })
          .map((t) => t.id)
      }
    } catch {
      // no account configured → leave allowedTargetIds = null (unfiltered)
    }

    let query = db.from('competitor_leads').select('*')
    if (allowedTargetIds !== null) {
      if (allowedTargetIds.length === 0) return Response.json([])
      query = query.in('target_id', allowedTargetIds)
    }
    if (targetId) query = query.eq('target_id', targetId)
    if (status) query = query.eq('status', status)
    if (minScore) query = query.gte('score', Number(minScore))
    const { data, error } = await query.order('score', { ascending: false }).limit(500)
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
