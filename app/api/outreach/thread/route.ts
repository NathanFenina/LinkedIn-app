import { getChatMessages } from '@/lib/unipile'
import { errMsg } from '@/lib/utils'

// Fil d'une conversation LinkedIn par chat_id — utilisé par le séquenceur pour
// afficher l'historique d'un prospect "déjà échangé" même s'il n'est pas dans le CRM.
export async function GET(request: Request) {
  const chatId = new URL(request.url).searchParams.get('chat_id')
  if (!chatId) return Response.json({ error: 'chat_id requis' }, { status: 400 })
  try {
    const msgs = await getChatMessages(chatId, 20)
    // Ordre chronologique (Unipile renvoie souvent le plus récent d'abord).
    const items = [...msgs]
      .reverse()
      .map((m) => ({ text: m.text || '', is_sender: m.is_sender === 1 || m.is_sender === true }))
      .filter((m) => m.text)
    return Response.json(items)
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
