import { getServerSupabase } from '@/lib/supabase'
import { sendLinkedInInvitation } from '@/lib/unipile'
import { generateInvitationMessage } from '@/lib/gemini'
import { getActiveAccountId } from '@/lib/account'
import { guard } from '@/lib/limits'

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT ||
  "Agence/freelance SEO et acquisition B2B."

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const customMessage: string | undefined = body.message?.trim() || undefined
  const generateAi: boolean = !!body.generate_ai
  const preview: boolean = !!body.preview // true = génère le message SANS envoyer

  try {
    const db = getServerSupabase()
    const { data: lead, error } = await db
      .from('competitor_leads')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !lead) {
      return Response.json({ error: 'Lead non trouvé' }, { status: 404 })
    }
    if (!lead.commenter_provider_id) {
      return Response.json({ error: 'provider_id manquant' }, { status: 400 })
    }
    if (lead.status === 'invited' || lead.status === 'connected') {
      return Response.json({ error: 'Déjà invité' }, { status: 400 })
    }

    let messageToSend = customMessage
    if (!messageToSend && generateAi && lead.comment_text) {
      messageToSend = await generateInvitationMessage({
        commenterName: lead.commenter_name || 'là',
        commenterHeadline: lead.commenter_headline,
        commentText: lead.comment_text,
        myBusinessContext: DEFAULT_CONTEXT,
      })
    }

    // Mode preview : on renvoie juste le message généré, rien n'est envoyé.
    if (preview) {
      return Response.json({ preview_message: messageToSend || '' })
    }

    // Resolve account_id from the lead's target, fallback to active.
    let ACCOUNT_ID: string
    const { data: targetRow } = await db
      .from('competitor_targets')
      .select('linkedin_account_id')
      .eq('id', lead.target_id)
      .maybeSingle()
    if (targetRow?.linkedin_account_id) {
      const { data: acc } = await db
        .from('linkedin_accounts')
        .select('unipile_account_id')
        .eq('id', targetRow.linkedin_account_id)
        .maybeSingle()
      ACCOUNT_ID = acc?.unipile_account_id || (await getActiveAccountId())
    } else {
      ACCOUNT_ID = await getActiveAccountId()
    }

    // Garde-fou LinkedIn : blocage dur si plafond invitations / global atteint.
    const g = await guard(db, ACCOUNT_ID, 'invite')
    if (!g.allowed) {
      return Response.json({ error: g.reason, limited: true }, { status: 429 })
    }

    await sendLinkedInInvitation(
      ACCOUNT_ID,
      lead.commenter_provider_id,
      messageToSend
    )

    const { data: updated } = await db
      .from('competitor_leads')
      .update({
        status: 'invited',
        invitation_message: messageToSend || null,
        invited_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    return Response.json(updated)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
