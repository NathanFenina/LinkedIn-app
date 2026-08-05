import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccount, scopeQueryToAccount } from '@/lib/account'
import { needsReply, isRelanceDue, priorityScore, tier, relanceStep } from '@/lib/scoring'
import type { Contact } from '@/types'

// Cockpit prospection : "à traiter" (P1) + "relances dues" (P2), triés.
export async function GET() {
  try {
    const db = getServerSupabase()
    let query = db.from('contacts').select('*').not('chat_id', 'is', null)
    try {
      const account = await getActiveAccount()
      query = scopeQueryToAccount(query, account)
    } catch {}
    const { data, error } = await query
    if (error) throw error
    const contacts = (data || []) as Contact[]

    const toTreat = contacts
      .filter(needsReply)
      .map((c) => ({ contact: c, tier: tier(c), score: priorityScore(c) }))
      .sort((a, b) => b.score - a.score)

    const relances = contacts
      .filter(isRelanceDue)
      .map((c) => ({ contact: c, tier: tier(c), score: priorityScore(c), step: relanceStep(c.relance_count || 0) }))
      .sort((a, b) => b.score - a.score)

    return Response.json({ toTreat, relances })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
