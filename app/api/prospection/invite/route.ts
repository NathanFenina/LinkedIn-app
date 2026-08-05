import { getServerSupabase } from '@/lib/supabase'
import { sendLinkedInInvitation } from '@/lib/unipile'
import { generateColdInviteNote } from '@/lib/gemini'
import { getActiveAccountId } from '@/lib/account'
import { guard } from '@/lib/limits'

export const maxDuration = 60

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT || 'Agence/freelance SEO et acquisition B2B.'

// preview:true → génère la note sans envoyer. Sinon → invitation (garde-fou).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const providerId: string | undefined = body.provider_id?.trim() || undefined
  const preview: boolean = !!body.preview
  let message: string | undefined = body.message?.trim() || undefined

  try {
    if (preview) {
      if (!message) {
        message = await generateColdInviteNote({
          name: body.name || '',
          headline: body.headline || null,
          myBusinessContext: DEFAULT_CONTEXT,
        })
      }
      return Response.json({ preview_message: message || '' })
    }

    if (!providerId) return Response.json({ error: 'provider_id requis' }, { status: 400 })
    const db = getServerSupabase()
    const accountId = await getActiveAccountId()
    const g = await guard(db, accountId, 'invite')
    if (!g.allowed) return Response.json({ error: g.reason, limited: true }, { status: 429 })
    await sendLinkedInInvitation(accountId, providerId, message)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
