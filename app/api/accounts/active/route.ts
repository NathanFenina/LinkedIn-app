import { cookies } from 'next/headers'
import { ACTIVE_ACCOUNT_COOKIE, getActiveAccount } from '@/lib/account'

export async function GET() {
  try {
    const acc = await getActiveAccount()
    return Response.json(acc)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 200 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const id: string | undefined = body.id
  if (!id) return Response.json({ error: 'id requis' }, { status: 400 })

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_ACCOUNT_COOKIE, id, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  })
  return Response.json({ ok: true, id })
}
