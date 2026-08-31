import { getServerSupabase } from '@/lib/supabase'
import { startNewChat } from '@/lib/unipile'
import { getActiveAccountId } from '@/lib/account'
import { checkLimit, logAction } from '@/lib/limits'
import { extractFirstName } from '@/lib/gemini'

async function resolveAccountId(
  db: ReturnType<typeof getServerSupabase>,
  linkedin_account_id: string | null
): Promise<string> {
  if (linkedin_account_id) {
    const { data } = await db
      .from('linkedin_accounts')
      .select('unipile_account_id')
      .eq('id', linkedin_account_id)
      .maybeSingle()
    if (data?.unipile_account_id) return data.unipile_account_id
  }
  return getActiveAccountId()
}

// POST : envoie le DM d'audit à la personne choisie.
// Body: { template } — message avec {prenom} et {lien}.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const template: string = (body.template || '').trim()
  if (!template) return Response.json({ error: 'Message vide' }, { status: 400 })

  try {
    const db = getServerSupabase()
    const { data: target, error } = await db.from('audit_targets').select('*').eq('id', id).single()
    if (error || !target) return Response.json({ error: 'Cible non trouvée' }, { status: 404 })
    if (!target.provider_id) return Response.json({ error: 'Aucun contact choisi pour cette boîte' }, { status: 400 })
    if (target.status === 'sent') return Response.json({ error: 'Déjà envoyé' }, { status: 400 })

    const ACCOUNT_ID = await resolveAccountId(db, target.linkedin_account_id)

    // Plafond DM en lecture seule (on log seulement si l'envoi passe).
    const chk = await checkLimit(db, ACCOUNT_ID, 'dm')
    if (!chk.allowed) return Response.json({ error: chk.reason || 'Plafond messages atteint' }, { status: 429 })

    // Personnalisation : {prenom} nettoyé par IA si présent, {lien} = URL d'audit.
    const quickFirst = (target.contact_name || '').split(' ')[0] || ''
    const prenom = /\{prenom\}/i.test(template)
      ? (await extractFirstName(target.contact_name || '')) || quickFirst
      : quickFirst
    const message = template
      .replace(/\{prenom\}/gi, prenom)
      .replace(/\{lien\}/gi, target.audit_url || '')
      .replace(/\{boite\}/gi, target.company || '')
      .replace(/\{name\}/gi, quickFirst)

    try {
      await startNewChat(ACCOUNT_ID, target.provider_id, message)
      await logAction(db, ACCOUNT_ID, 'dm')
      await db
        .from('audit_targets')
        .update({ status: 'sent', message_sent: message, error: null, updated_at: new Date().toISOString() })
        .eq('id', id)
      return Response.json({ ok: true, message })
    } catch (err) {
      await db
        .from('audit_targets')
        .update({ status: 'error', error: String(err).slice(0, 300), updated_at: new Date().toISOString() })
        .eq('id', id)
      return Response.json({ error: String(err) }, { status: 500 })
    }
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
