import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountRowId } from '@/lib/account'

function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string }
    return [e.message, e.details, e.hint, e.code ? `(code ${e.code})` : '']
      .filter(Boolean)
      .join(' · ')
  }
  return String(err)
}

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()

    const { data: lead, error: leadErr } = await db
      .from('competitor_leads')
      .select('*')
      .eq('id', id)
      .single()
    if (leadErr || !lead) {
      console.error('save-to-crm: lead lookup failed', leadErr)
      return Response.json({ error: 'Lead non trouvé' }, { status: 404 })
    }
    if (!lead.commenter_provider_id) {
      return Response.json({ error: 'provider_id manquant' }, { status: 400 })
    }

    // Fetch target separately (avoids PostgREST relationship cache issues).
    let targetLabel: string | null = null
    if (lead.target_id) {
      const { data: target } = await db
        .from('competitor_targets')
        .select('label')
        .eq('id', lead.target_id)
        .maybeSingle()
      targetLabel = target?.label || null
    }

    // Tag the new contact with the CURRENTLY ACTIVE account so it shows up in
    // the user's CRM right away (rather than the target's original account,
    // which may belong to a different LinkedIn login).
    const activeAccountId = await getActiveAccountRowId().catch(() => null)

    const noteBlock = [
      `Source: commentaire sur ${targetLabel || 'post concurrent'}`,
      lead.comment_text ? `Commentaire: "${lead.comment_text}"` : null,
      lead.score_reason ? `Score IA: ${lead.score}/10 — ${lead.score_reason}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    // Upsert into contacts (unique by linkedin_id).
    const { data: contact, error: upErr } = await db
      .from('contacts')
      .upsert(
        {
          linkedin_id: lead.commenter_provider_id,
          name: lead.commenter_name || 'Inconnu',
          profile_url: lead.commenter_profile_url,
          job_title: lead.commenter_headline,
          status: 'to_contact',
          notes: noteBlock,
          score: lead.score || 0,
          score_reason: lead.score_reason,
          linkedin_account_id: activeAccountId,
        },
        { onConflict: 'linkedin_id' }
      )
      .select()
      .single()
    if (upErr) {
      console.error('save-to-crm: upsert failed', upErr)
      throw upErr
    }

    // Mark the competitor_lead as saved (status: qualified if it wasn't already).
    if (lead.status === 'new') {
      await db
        .from('competitor_leads')
        .update({ status: 'qualified' })
        .eq('id', id)
    }

    return Response.json({ ok: true, contact })
  } catch (err) {
    console.error('save-to-crm failed:', err)
    return Response.json({ error: errorMessage(err) }, { status: 500 })
  }
}
