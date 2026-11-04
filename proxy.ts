import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Protection de toute l'app (pages + API) : sans elle, n'importe qui ayant l'URL
// peut lire le CRM et publier ou envoyer des messages via l'API.
// - Navigateur : mot de passe (authentification HTTP Basic, identifiant libre), variable APP_PASSWORD.
// - Machines (GitHub Actions, Second Brain) : "Authorization: Bearer ${CRON_SECRET}" ou ?token=CRON_SECRET.
// - Ouverts : callbacks et webhooks appelés par X, Google (YouTube) et Unipile, et les routes cron/admin qui vérifient déjà CRON_SECRET.
// Tant que APP_PASSWORD n'est pas défini dans Vercel, rien n'est bloqué (pas de verrouillage par surprise).

const OUVERTS = [/^\/api\/cron\//, /^\/api\/admin\//, /^\/api\/webhooks\//, /^\/api\/x\/callback/, /^\/api\/youtube\/callback/]

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD
  if (!password) return NextResponse.next()
  const { pathname, searchParams } = request.nextUrl
  if (OUVERTS.some((r) => r.test(pathname))) return NextResponse.next()

  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (secret && (auth === `Bearer ${secret}` || searchParams.get('token') === secret)) return NextResponse.next()

  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      if (decoded.slice(decoded.indexOf(':') + 1) === password) return NextResponse.next()
    } catch { /* en-tête invalide */ }
  }
  return new NextResponse('Accès réservé', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="PLUG", charset="UTF-8"' } })
}

export const config = {
  // Tout sauf les fichiers statiques de Next et les images publiques.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)'],
}
