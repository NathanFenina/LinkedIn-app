import { getServerSupabase } from '@/lib/supabase'
import { getChatMessages, sendMessage } from '@/lib/unipile'
import { generateReply } from '@/lib/gemini'
import { errMsg } from '@/lib/utils'

export const maxDuration = 60

// Bloc "À traiter maintenant" du Cockpit.
//  GET  ?source=outreach|lead-magnet&id=…  → fil de conversation + réponse
//        pré-rédigée par l'IA (voix de Nathan, objectif : décrocher le RDV,
//        lien Calendly inséré si la personne a dit oui).
//  POST { source, id, text, op:'send'|'skip' } → envoie la réponse dans le
//        fil LinkedIn (ou marque juste "traité") et clôt l'item.
const TABLE = { outreach: 'outreach_targets', 'lead-magnet': 'lead_magnet_sends' } as const
type Source = keyof typeof TABLE

async function setting(db: ReturnType<typeof getServerSupabase>, key: string): Promise<string> {
  const { data } = await db.from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as string) || ''
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const source = url.searchParams.get('source') as Source
  const id = url.searchParams.get('id') || ''
  if (!TABLE[source] || !id) return Response.json({ error: 'source/id manquants' }, { status: 400 })
  try {
    const db = getServerSupabase()
    const { data: t } = await db.from(TABLE[source]).select('*').eq('id', id).maybeSingle()
    if (!t?.chat_id) return Response.json({ error: 'Pas de fil de conversation connu pour cette personne' }, { status: 404 })

    const raw = await getChatMessages(t.chat_id as string, 12)
    // Ordre chronologique, champs normalisés pour l'IA.
    const messages = raw
      .map((m) => ({
        text: (m.text as string) || '',
        is_sender: m.is_sender === 1 || m.is_sender === true,
        created_at: (m.timestamp as string) || new Date().toISOString(),
      }))
      .filter((m) => m.text)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))

    const name = (t.name as string) || (t.commenter_name as string) || ''
    const mode = url.searchParams.get('mode') || 'reply'
    const link = await setting(db, mode === 'webinar' ? 'webinar_url' : 'calendly_url')
    const goal = mode === 'webinar'
      ? `Tu es Nathan (Decupler, SEO & Claude Code). Tu reprends contact avec une personne qui avait déjà échangé avec toi (lis le fil) pour l'inviter à ton WORKSHOP LIVE : tu y montres comment tu produis 10x plus de SEO avec Claude Code (audit GEO, monitoring de prompts, création de contenus, intégration) sans payer 10 abonnements SEO, du concret rejouable le lendemain, et tu réponds à toutes les questions.
Règles : minuscules, direct, chaleureux, 2 à 4 phrases max. Commence par un rappel PRÉCIS de ce qu'on s'était dit (ce qu'il a répondu, sa question, sa situation) — jamais générique. Puis l'invitation, puis le lien tel quel sur sa propre ligne : ${link || '(lien du workshop)'}
Pas de "j'espère que vous allez bien", pas de pitch commercial, pas de point d'exclamation.`
      : `Tu es Nathan (Decupler, SEO & visibilité dans les réponses IA / GEO). La personne a répondu à ta prospection. Objectif : décrocher un échange de 15 min.
Règles : minuscules, direct, chaleureux, 1 à 3 phrases max, pas de pitch, pas de "j'espère que vous allez bien".
- Si elle dit oui / propose une date : confirme avec enthousiasme et donne le lien pour caler le créneau : ${link || '(lien Calendly)'}
- Si elle pose une question : réponds-y simplement puis propose le créneau.
- Si elle hésite / "plus tard" : propose une alternative légère (vidéo de 3 min) sans insister.
- Si elle refuse : remercie, laisse la porte ouverte, une seule phrase.`
    const draft = await generateReply({
      contactName: name,
      jobTitle: (t.headline as string) || null,
      goal,
      template: null,
      // generateReply attend le plus récent en premier (il inverse)
      messages: messages.slice().reverse(),
    })
    return Response.json({ ok: true, name, messages, draft, calendly: link })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { source, id, text, op, mode } = body as { source?: Source; id?: string; text?: string; op?: 'send' | 'skip'; mode?: string }
  if (!source || !TABLE[source] || !id) return Response.json({ error: 'source/id manquants' }, { status: 400 })
  try {
    const db = getServerSupabase()
    if (op === 'send') {
      const { data: t } = await db.from(TABLE[source]).select('chat_id').eq('id', id).maybeSingle()
      if (!t?.chat_id) return Response.json({ error: 'Pas de fil de conversation' }, { status: 404 })
      if (!text?.trim()) return Response.json({ error: 'Message vide' }, { status: 400 })
      await sendMessage(t.chat_id as string, text.trim())
    }
    const now = new Date().toISOString()
    // Mode workshop : on marque "invité" (ou "passé") sans toucher au statut "traité".
    await db.from(TABLE[source]).update(mode === 'webinar' ? { webinar_invited_at: now } : { replied_handled_at: now }).eq('id', id)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
