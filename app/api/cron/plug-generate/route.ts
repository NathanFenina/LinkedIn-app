// Cron PLUG : remplit la file d'actions à valider, une partie par appel
// (chaque partie tient dans la limite de durée). ?part=
//   engagers   → engageurs dans la cible, question ChatGPT + concurrents (Gemini + recherche Google)
//   accepted   → invitations PLUG acceptées → message personnalisé prêt
//   convs      → relances (mon message sans réponse) + réponses reçues à traiter
//   x          → posts X à commenter
//   missions   → posts LinkedIn de missions freelance
//   jobs       → offres : LinkedIn Jobs, Free-Work (100 % télétravail), Collective.work
//   comments   → posts LinkedIn à commenter (visibilité)
//   fb         → posts de groupes Facebook BTP qui expriment un besoin (Apify, lecture seule)
//   stats      → statistiques des posts publiés via PLUG Publish
//   report_week / report_month → bilan KPI (notification dans PLUG)
// Chaque partie qui ajoute des éléments crée une notification dans PLUG (cloche).
// Rien n'est envoyé ici. Auth: header "Authorization: Bearer ${CRON_SECRET}".

import { getServerSupabase } from '@/lib/supabase'
import { generateConversations, generateEngagers, generateJobBoards, generateLinkedInPosts, generateXReplies, promoteAcceptedInvites } from '@/lib/plug'
import { findReplyTargets } from '@/lib/x'
import { generateFbGroups, refreshStats } from '@/lib/plug-publish'
import { kpiReport, notifyPart } from '@/lib/plug-notify'

export const maxDuration = 300

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const part = new URL(request.url).searchParams.get('part') || ''
  const db = getServerSupabase()
  try {
    let out: Record<string, unknown>
    switch (part) {
      case 'engagers': out = { ...(await generateEngagers(db, 8)) }; break
      case 'accepted': out = { promoted: await promoteAcceptedInvites(db) }; break
      case 'convs': out = { ...(await generateConversations(db)) }; break
      case 'x': {
        const found = await findReplyTargets(db, { count: 10 }).catch((e) => ({ error: String(e) }))
        out = { found, added: await generateXReplies(db) }; break
      }
      case 'missions': out = { added: await generateLinkedInPosts(db, 'missions') }; break
      case 'jobs': out = { ...(await generateJobBoards(db)) }; break
      case 'comments': out = { added: await generateLinkedInPosts(db, 'comments') }; break
      case 'fb': out = { ...(await generateFbGroups(db)) }; break
      case 'stats': out = { refreshed: await refreshStats(db) }; break
      case 'report_week': out = { note: await kpiReport(db, 'week') }; break
      case 'report_month': out = { note: await kpiReport(db, 'month') }; break
      default: return Response.json({ error: 'part inconnue' }, { status: 400 })
    }
    await notifyPart(db, part, out)
    return Response.json({ part, ...out })
  } catch (err) {
    return Response.json({ part, error: String(err).slice(0, 400) }, { status: 500 })
  }
}

export const GET = POST
