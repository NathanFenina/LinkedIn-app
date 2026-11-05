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
// Rien n'est envoyé ici. Auth: header "Authorization: Bearer ${CRON_SECRET}".

import { getServerSupabase } from '@/lib/supabase'
import { generateConversations, generateEngagers, generateJobBoards, generateLinkedInPosts, generateXReplies, promoteAcceptedInvites } from '@/lib/plug'
import { findReplyTargets } from '@/lib/x'
import { generateFbGroups, refreshStats } from '@/lib/plug-publish'

export const maxDuration = 300

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const part = new URL(request.url).searchParams.get('part') || ''
  const db = getServerSupabase()
  try {
    switch (part) {
      case 'engagers': return Response.json({ part, ...(await generateEngagers(db, 8)) })
      case 'accepted': return Response.json({ part, promoted: await promoteAcceptedInvites(db) })
      case 'convs': return Response.json({ part, ...(await generateConversations(db)) })
      case 'x': {
        const found = await findReplyTargets(db, { count: 10 }).catch((e) => ({ error: String(e) }))
        return Response.json({ part, found, added: await generateXReplies(db) })
      }
      case 'missions': return Response.json({ part, added: await generateLinkedInPosts(db, 'missions') })
      case 'jobs': return Response.json({ part, ...(await generateJobBoards(db)) })
      case 'comments': return Response.json({ part, added: await generateLinkedInPosts(db, 'comments') })
      case 'fb': return Response.json({ part, ...(await generateFbGroups(db)) })
      case 'stats': return Response.json({ part, refreshed: await refreshStats(db) })
      default: return Response.json({ error: 'part inconnue' }, { status: 400 })
    }
  } catch (err) {
    return Response.json({ part, error: String(err).slice(0, 400) }, { status: 500 })
  }
}

export const GET = POST
