import { createMessagingWebhook, listWebhooks } from '@/lib/unipile'
import { errMsg } from '@/lib/utils'

// Déclare (une seule fois, idempotent) le webhook Unipile "messaging" qui
// pointe vers cette app → réponses détectées en temps réel.
// POST /api/webhooks/unipile/register  (bouton "Activer le temps réel" du Cockpit)
export async function POST(request: Request) {
  try {
    const secret = process.env.CRON_SECRET || ''
    const origin = process.env.APP_URL || new URL(request.url).origin
    const target = `${origin}/api/webhooks/unipile?token=${encodeURIComponent(secret)}`
    // Déjà déclaré ? On ne crée pas de doublon.
    try {
      const existing = await listWebhooks()
      const dup = existing.find((w) => (w.request_url || '').startsWith(`${origin}/api/webhooks/unipile`))
      if (dup) return Response.json({ ok: true, already: true, webhook_id: dup.id })
    } catch { /* liste indisponible → on tente la création */ }
    const res = await createMessagingWebhook(target, 'linkedin-app réponses temps réel')
    return Response.json({ ok: true, created: true, unipile: res })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const existing = await listWebhooks()
    return Response.json({ ok: true, webhooks: existing.filter((w) => (w.request_url || '').includes('/api/webhooks/unipile')) })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
