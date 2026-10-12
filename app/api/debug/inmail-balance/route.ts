import { getActiveAccountId } from '@/lib/account'
import { unipileFetch } from '@/lib/unipile'

// Lecture seule : solde de crédits InMail du compte LinkedIn. Auth : ?token=CRON_SECRET.
export async function GET(request: Request) {
  const url = new URL(request.url)
  if (process.env.CRON_SECRET && url.searchParams.get('token') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const acc = await getActiveAccountId()
    return Response.json(await unipileFetch(`/linkedin/inmail_balance?account_id=${encodeURIComponent(acc)}`))
  } catch (err) {
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500 })
  }
}
