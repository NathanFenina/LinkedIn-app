// Cron X : appelé aux 3 créneaux du jour (vercel.json). À chaque passage :
//   1. au 1er créneau, importe les nouveaux posts LinkedIn en brouillon (à valider) ;
//   2. publie le prochain post VALIDÉ si le plafond du jour n'est pas atteint
//      (nouveaux d'abord, puis archive). Jamais de publication non validée.
// Auth: header "Authorization: Bearer ${CRON_SECRET}".

import { getServerSupabase } from '@/lib/supabase'
import { importLinkedInPosts, nextApproved, publishXPost, publishedToday, xAccount, xSettings, autoQuotes, autoReplyMentions } from '@/lib/x'

export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = getServerSupabase()
  const out: Record<string, unknown> = {}
  try {
    if (new URL(request.url).searchParams.get('import') === '1') {
      out.import = await importLinkedInPosts(db, { archive: false }).catch((e) => ({ error: String(e) }))
    }
    if (!(await xAccount(db)).connected) return Response.json({ ...out, published: 0, reason: 'Compte X non connecté' })
    // Les 10 posts X à commenter sont préparés 1 fois/semaine par la routine du lundi (mail récap), plus ici.
    // Engagement automatique (sans Nathan) : réponses aux mentions + citations commentées.
    out.mentions = await autoReplyMentions(db, 5).catch((e) => ({ error: String(e) }))
    out.quotes = await autoQuotes(db, 2).catch((e) => ({ error: String(e) }))
    const { max_per_day } = await xSettings(db)
    const today = await publishedToday(db)
    if (today >= max_per_day) return Response.json({ ...out, published: 0, reason: `Plafond du jour atteint (${today}/${max_per_day})` })
    const id = await nextApproved(db)
    if (!id) return Response.json({ ...out, published: 0, reason: 'Aucun post validé en attente' })
    const r = await publishXPost(db, id)
    return Response.json({ ...out, published: 1, id, ...r })
  } catch (err) {
    return Response.json({ ...out, error: String(err) }, { status: 500 })
  }
}
