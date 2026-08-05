import { getReceivedInvitations } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'

export const maxDuration = 60

// Liste les invitations LinkedIn REÇUES (en attente) du compte actif.
export async function GET() {
  try {
    const accountId = await getActiveAccountId()
    const { items } = await getReceivedInvitations(accountId)
    return Response.json(items)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
