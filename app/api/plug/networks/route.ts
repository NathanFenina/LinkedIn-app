import { getServerSupabase } from '@/lib/supabase'
import { getSetting, setSetting, listUnipileAccounts } from '@/lib/crosspost'
import { errMsg } from '@/lib/utils'

// Réseaux de PLUG Publish.
// GET  : comptes Unipile connectés + réglages (Instagram choisi, page Facebook).
// POST { op: 'connect', provider: 'INSTAGRAM' } → lien Unipile pour connecter le compte.
// POST { op: 'settings', instagram_account_id?, fb_page_id?, fb_page_token? }
export async function GET() {
  try {
    const db = getServerSupabase()
    const [accounts, ig, fbPage, fbToken] = await Promise.all([
      listUnipileAccounts(), getSetting(db, 'crosspost_instagram_account_id'), getSetting(db, 'fb_page_id'), getSetting(db, 'fb_page_token'),
    ])
    return Response.json({ accounts, settings: { instagram_account_id: ig, fb_page_id: fbPage, fb_token_set: !!fbToken } })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, string>
  try {
    const db = getServerSupabase()
    if (b.op === 'connect') {
      const provider = (b.provider || 'INSTAGRAM').toUpperCase()
      const dsn = process.env.UNIPILE_DSN!
      const res = await fetch(`https://${dsn}/api/v1/hosted/accounts/link`, {
        method: 'POST', headers: { 'X-API-KEY': process.env.UNIPILE_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'create', providers: [provider], api_url: `https://${dsn}`, expiresOn: new Date(Date.now() + 3600000).toISOString() }),
      })
      if (!res.ok) throw new Error(`Unipile ${res.status} : ${(await res.text()).slice(0, 200)}`)
      return Response.json(await res.json())
    }
    if (b.op === 'settings') {
      if (typeof b.instagram_account_id === 'string') await setSetting(db, 'crosspost_instagram_account_id', b.instagram_account_id)
      if (typeof b.fb_page_id === 'string') await setSetting(db, 'fb_page_id', b.fb_page_id.trim())
      if (typeof b.fb_page_token === 'string' && b.fb_page_token.trim()) await setSetting(db, 'fb_page_token', b.fb_page_token.trim())
      return Response.json({ ok: true })
    }
    return Response.json({ error: 'op inconnue' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
