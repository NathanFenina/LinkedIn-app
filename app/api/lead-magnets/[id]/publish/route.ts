import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

// Lance la SESSION d'envoi des lead-magnets pour UNE campagne (poste les DM aux
// commentateurs, un par un, espacés 2-3 min) sans ouvrir GitHub : déclenche le
// workflow via l'API. Réactive la campagne au passage (pour qu'un "Arrêter"
// précédent ne bloque pas). Nécessite GITHUB_TOKEN (Actions: Read and write).
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'NathanFenina/LinkedIn-app'
  const workflow = process.env.GITHUB_LEAD_MAGNETS_WORKFLOW || 'cron-lead-magnets.yml'

  if (!token) {
    return Response.json(
      {
        error:
          'Ajoute un token GitHub (GITHUB_TOKEN, Actions: Read and write) dans Vercel pour lancer l’envoi depuis l’app. Sinon : GitHub → Actions → Lead Magnets Session → Run workflow.',
        need_token: true,
      },
      { status: 400 }
    )
  }

  try {
    // On réactive la campagne : "Lancer l'envoi" doit repartir même si on avait
    // cliqué "Arrêter" avant.
    const db = getServerSupabase()
    await db.from('lead_magnet_campaigns').update({ active: true }).eq('id', id)

    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: process.env.GITHUB_REF || 'main', inputs: { campaign_id: id } }),
    })
    if (res.status === 204) {
      return Response.json({
        ok: true,
        message:
          'Session d’envoi lancée. Les DM partent un par un, espacés (2-3 min). Clique « Arrêter » pour couper : l’envoi s’interrompt au tour suivant.',
      })
    }
    const txt = await res.text()
    return Response.json({ error: `GitHub ${res.status}: ${txt.slice(0, 200)}` }, { status: 500 })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
