import { getServerSupabase } from '@/lib/supabase'

// Charge en une fois un lot d'actions PLUG préparées et validées par Nathan
// (ex. campagne post Opus 5.5). Rien n'est envoyé ici : le cron plug-send les
// envoie ensuite une par une, espacées, dans la limite des plafonds.
// Auth : ?token=CRON_SECRET. Body : { rows: plug_actions[] } (dedupe_key requis).
export const maxDuration = 120

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (process.env.CRON_SECRET && url.searchParams.get('token') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { rows } = (await request.json().catch(() => ({}))) as { rows?: Array<Record<string, unknown>> }
  if (!rows?.length) return Response.json({ error: 'rows requis' }, { status: 400 })
  if (rows.some((r) => !r.dedupe_key)) return Response.json({ error: 'dedupe_key requis sur chaque ligne' }, { status: 400 })
  const db = getServerSupabase()
  let inserted = 0
  for (let i = 0; i < rows.length; i += 100) {
    const { data, error } = await db.from('plug_actions').upsert(rows.slice(i, i + 100), { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id')
    if (error) return Response.json({ error: error.message, inserted }, { status: 500 })
    inserted += data?.length || 0
  }
  return Response.json({ ok: true, inserted })
}
