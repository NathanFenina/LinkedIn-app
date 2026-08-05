import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'
import { usageToday } from '@/lib/limits'

// Usage LinkedIn du jour (pour l'indicateur de garde-fous dans l'UI).
export async function GET() {
  try {
    const db = getServerSupabase()
    const accountId = await getActiveAccountId()
    const usage = await usageToday(db, accountId)
    return Response.json(usage)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
