import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

const EDITABLE = new Set(['name', 'search_url', 'msg1', 'msg2', 'followup_days', 'daily_cap', 'active'])

// Détail campagne + toutes ses cibles (triées : à valider d'abord, meilleur score en haut).
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db.from('outreach_campaigns').select('*').eq('id', id).single()
    if (error) throw error
    const { data: targets } = await db
      .from('outreach_targets')
      .select('*')
      .eq('campaign_id', id)
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })

    // Historique : est-ce qu'on a déjà échangé avec ce profil ? On rapproche du
    // CRM par identifiant LinkedIn (provider_id ↔ contacts.linkedin_id) ET par
    // nom — car la recherche LinkedIn ne renvoie pas toujours le même id que
    // celui stocké dans les contacts, ce qui laissait passer des "déjà échangé"
    // pour des "jamais contacté". Le nom sert de filet de sécurité pour l'affichage.
    type Hist = { contact_id: string; last_message: string | null; last_message_at: string | null; is_sender_last: boolean; status: string }
    const list = (targets || []) as Array<Record<string, unknown>>
    const providerIds = list.map((t) => t.provider_id).filter(Boolean) as string[]
    const names = list.map((t) => (t.name as string | null)?.trim().toLowerCase()).filter(Boolean) as string[]

    const byId: Record<string, Hist> = {}
    const byName: Record<string, Hist> = {}
    const toHist = (c: Record<string, unknown>): Hist => ({
      contact_id: c.id as string,
      last_message: (c.last_message as string) ?? null,
      last_message_at: (c.last_message_at as string) ?? null,
      is_sender_last: !!c.is_sender_last,
      status: c.status as string,
    })

    if (providerIds.length) {
      const { data } = await db
        .from('contacts')
        .select('id, linkedin_id, name, last_message, last_message_at, is_sender_last, status')
        .in('linkedin_id', providerIds)
      for (const c of data || []) if (c.linkedin_id) byId[c.linkedin_id as string] = toHist(c)
    }
    if (names.length) {
      // Match par nom insensible à la casse : la recherche LinkedIn renvoie les
      // noms de famille en MAJUSCULES ("Marc BOIVINEAU") alors que le CRM les
      // garde en casse normale — un .in() exact ratait donc tout. On charge les
      // contacts avec qui il y a vraiment eu un message et on compare en JS.
      const wanted = new Set(names)
      const { data } = await db
        .from('contacts')
        .select('id, linkedin_id, name, last_message, last_message_at, is_sender_last, status')
        .not('last_message_at', 'is', null)
      for (const c of data || []) {
        const key = (c.name as string | null)?.trim().toLowerCase()
        if (key && wanted.has(key)) byName[key] = toHist(c)
      }
    }

    const enriched = list.map((t) => {
      const nameKey = (t.name as string | null)?.trim().toLowerCase() || ''
      const history = (t.provider_id ? byId[t.provider_id as string] : null) || byName[nameKey] || null
      return { ...t, history }
    })

    return Response.json({ campaign, targets: enriched })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json()
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) if (EDITABLE.has(k)) patch[k] = v
  try {
    const db = getServerSupabase()
    const { data, error } = await db.from('outreach_campaigns').update(patch).eq('id', id).select().single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getServerSupabase()
    await db.from('outreach_targets').delete().eq('campaign_id', id)
    const { error } = await db.from('outreach_campaigns').delete().eq('id', id)
    if (error) throw error
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
