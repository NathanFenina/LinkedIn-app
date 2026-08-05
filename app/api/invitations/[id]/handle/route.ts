import { handleInvitation, startNewChat } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'

export const maxDuration = 60

// Accepte ou décline une invitation reçue. Si accept + message + provider_id,
// envoie le premier message dans la foulée.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const action: 'accept' | 'decline' = body.action === 'decline' ? 'decline' : 'accept'
  const sharedSecret: string | null = body.shared_secret || null
  const message: string | undefined = body.message?.trim() || undefined
  const providerId: string | undefined = body.provider_id || undefined

  try {
    const accountId = await getActiveAccountId()
    await handleInvitation(accountId, id, action, sharedSecret)

    let messaged = false
    let messageError: string | null = null
    if (action === 'accept' && message && providerId) {
      try {
        await startNewChat(accountId, providerId, message)
        messaged = true
      } catch (err) {
        messageError = String(err)
      }
    }
    return Response.json({ ok: true, action, messaged, message_error: messageError })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
