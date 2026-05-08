import { getServerSupabase } from '@/lib/supabase'
import { getConnections } from '@/lib/unipile'
import { getActiveAccount } from '@/lib/account'

export const maxDuration = 300

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const pageSize = Math.min(Math.max(Number(body.pageSize) || 200, 1), 500)
  const cursor: string | undefined = typeof body.cursor === 'string' && body.cursor ? body.cursor : undefined

  try {
    const db = getServerSupabase()
    const account = await getActiveAccount()
    const ACCOUNT_ID = account.unipile_account_id
    const { items: connections, cursor: nextCursor } = await getConnections(ACCOUNT_ID, pageSize, cursor)

    let synced = 0
    let skipped = 0
    const errors: string[] = []
    const sample: unknown[] = []

    if (connections.length > 0 && sample.length === 0) {
      sample.push(connections[0])
    }

    for (const conn of connections) {
      try {
        const linkedinId = conn.provider_id || conn.id
        const name = conn.name || `${conn.first_name || ''} ${conn.last_name || ''}`.trim()
        if (!name || !linkedinId) {
          skipped++
          continue
        }

        const { data: existing } = await db
          .from('contacts')
          .select('id')
          .eq('linkedin_id', linkedinId)
          .single()

        if (!existing) {
          const { error: insErr } = await db.from('contacts').insert({
            linkedin_id: linkedinId,
            name,
            profile_url: conn.profile_url || null,
            avatar_url: conn.picture_url || null,
            job_title: conn.headline || null,
            status: 'not_contacted',
            score: 0,
            linkedin_account_id: account.id,
          })
          if (insErr) {
            errors.push(`insert ${linkedinId}: ${insErr.message}`)
          } else {
            synced++
          }
        } else {
          skipped++
        }
      } catch (err) {
        errors.push(`Connection ${conn.id}: ${String(err)}`)
      }
    }

    return Response.json({
      synced,
      skipped,
      total: connections.length,
      nextCursor: nextCursor || null,
      done: !nextCursor || connections.length === 0,
      errors: errors.slice(0, 5),
      sample: sample[0] || null,
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
