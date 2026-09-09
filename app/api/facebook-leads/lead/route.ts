import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountRowId } from '@/lib/account'

// Actions sur un lead artisan :
//  - status : 'called' | 'not_interested' | 'client' | 'to_call'
//  - crm    : bascule dans le CRM unifié (table contacts)
//  - delete : retire le lead
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { op, id } = body as { op?: string; id?: string }
  if (!id) return Response.json({ error: 'id manquant' }, { status: 400 })
  try {
    const db = getServerSupabase()

    if (op === 'delete') {
      const { error } = await db.from('facebook_leads').delete().eq('id', id)
      if (error) throw error
      return Response.json({ ok: true })
    }

    if (['to_call', 'called', 'not_interested', 'client'].includes(op || '')) {
      const patch: Record<string, unknown> = { status: op }
      if (op === 'called') patch.called_at = new Date().toISOString()
      const { error } = await db.from('facebook_leads').update(patch).eq('id', id)
      if (error) throw error
      return Response.json({ ok: true })
    }

    if (op === 'crm') {
      const { data: lead } = await db.from('facebook_leads').select('*').eq('id', id).maybeSingle()
      if (!lead) return Response.json({ error: 'lead introuvable' }, { status: 404 })
      const linkedinId = `fb:${lead.phone || lead.id}`
      const { data: existing } = await db.from('contacts').select('id').eq('linkedin_id', linkedinId).maybeSingle()
      if (!existing) {
        const accountRowId = await getActiveAccountRowId().catch(() => null)
        const notes = [
          lead.metier ? `Métier : ${lead.metier}` : '',
          lead.zone ? `Zone : ${lead.zone}` : '',
          lead.phone ? `Tél : ${lead.phone}` : '',
          lead.email ? `Email : ${lead.email}` : '',
          lead.group_title ? `Groupe : ${lead.group_title}` : '',
          lead.post_url ? `Post : ${lead.post_url}` : '',
        ].filter(Boolean).join('\n')
        const { error } = await db.from('contacts').insert({
          linkedin_id: linkedinId,
          name: lead.name || 'Artisan (Facebook)',
          profile_url: lead.post_url || null,
          job_title: lead.metier || null,
          status: 'to_contact',
          notes,
          linkedin_account_id: accountRowId,
        })
        if (error) throw error
      }
      await db.from('facebook_leads').update({ status: 'crm' }).eq('id', id)
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
