import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

// Lance la SESSION d'envoi outbound (poste les msg1/relances de la file, un par
// un, espacés 4-6 min) sans ouvrir GitHub : déclenche le workflow via l'API.
// Réactive la campagne au passage (le cron n'avance QUE les campagnes actives,
// donc lancer une campagne en pause ne ferait rien). Nécessite GITHUB_TOKEN.
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'NathanFenina/LinkedIn-app'
  const workflow = process.env.GITHUB_OUTREACH_WORKFLOW || 'cron-outreach.yml'

  if (!token) {
    return Response.json(
      {
        error:
          'Ajoute un token GitHub (GITHUB_TOKEN, Actions: Read and write) dans Vercel pour lancer l’envoi depuis l’app. Sinon : GitHub → Actions → Outbound Sequencer Session → Run workflow.',
        need_token: true,
      },
      { status: 400 }
    )
  }
  try {
    // Réactive la campagne : "Lancer l'envoi" doit repartir même si elle était
    // en pause (sinon le cron, qui filtre active=true, ne l'avancerait pas).
    const db = getServerSupabase()
    await db.from('outreach_campaigns').update({ active: true }).eq('id', id)

    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: process.env.GITHUB_REF || 'main' }),
    })
    if (res.status === 204) {
      return Response.json({ ok: true, message: 'Session d’envoi lancée. Les messages partent un par un, espacés (4-6 min), dans ta plage horaire et jusqu’au plafond du jour.' })
    }
    const txt = await res.text()
    return Response.json({ error: `GitHub ${res.status}: ${txt.slice(0, 200)}` }, { status: 500 })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
