import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountRowId } from '@/lib/account'

// Actions sur un lead chaud depuis le Cockpit :
//  - op='rdv'  : marque un RDV (succès) sur la cible (outreach ou lead-magnet)
//  - op='crm'  : envoie la personne dans le CRM (table contacts)
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { op, source, id, name, provider_id, profile_url } = body as {
    op?: string; source?: string; id?: string; name?: string | null; provider_id?: string | null; profile_url?: string | null
  }
  try {
    const db = getServerSupabase()

    if (op === 'rdv') {
      const table = source === 'lead-magnet' ? 'lead_magnet_sends' : 'outreach_targets'
      if (!id) return Response.json({ error: 'id manquant' }, { status: 400 })
      const { error } = await db.from(table).update({ rdv: true, rdv_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return Response.json({ ok: true })
    }

    if (op === 'crm') {
      if (!provider_id) return Response.json({ error: 'Pas d’identifiant LinkedIn pour cette personne' }, { status: 400 })
      const accountRowId = await getActiveAccountRowId().catch(() => null)
      // Déjà dans le CRM ? on ne duplique pas.
      const { data: existing } = await db.from('contacts').select('id').eq('linkedin_id', provider_id).maybeSingle()
      if (existing) return Response.json({ ok: true, already: true })
      const { error } = await db.from('contacts').insert({
        linkedin_id: provider_id,
        name: name || null,
        profile_url: profile_url || null,
        status: 'to_contact',
        linkedin_account_id: accountRowId,
      })
      if (error) throw error
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
