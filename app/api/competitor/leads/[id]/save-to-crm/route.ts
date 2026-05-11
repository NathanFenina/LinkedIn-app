import { getServerSupabase } from '@/lib/supabase'

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
      .select('*, competitor_targets(linkedin_account_id, label)')
      .eq('id', id)
      .single()
    if (leadErr || !lead) {
      return Response.json({ error: 'Lead non trouvé' }, { status: 404 })
    }
    if (!lead.commenter_provider_id) {
      return Response.json({ error: 'provider_id manquant' }, { status: 400 })
    }

    const targetLabel =
      (lead.competitor_targets as { label?: string | null } | null)?.label || 'post concurrent'
    const accountId =
      (lead.competitor_targets as { linkedin_account_id?: string | null } | null)
        ?.linkedin_account_id || null

    const noteBlock = [
      `Source: commentaire sur ${targetLabel}`,
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
          linkedin_account_id: accountId,
        },
        { onConflict: 'linkedin_id' }
      )
      .select()
      .single()
    if (upErr) throw upErr

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
