import { errMsg } from '@/lib/utils'

// Lance MAINTENANT une session d'acceptation des invitations existantes
// (déclenche le workflow GitHub Actions). Nécessite GITHUB_TOKEN.
export async function POST() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'NathanFenina/LinkedIn-app'
  const workflow = process.env.GITHUB_ACCEPT_WORKFLOW || 'cron-accept-invites.yml'
  if (!token) {
    return Response.json(
      {
        error:
          'Ajoute un token GitHub (GITHUB_TOKEN, Actions: Read and write) dans Vercel. Sinon : GitHub → Actions → Auto-Accept Invitations → Run workflow.',
        need_token: true,
      },
      { status: 400 }
    )
  }
  try {
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
      return Response.json({ ok: true, message: 'Session lancée. Les invitations sont acceptées une par une, espacées (2-3 min), avec ton message de bienvenue.' })
    }
    const txt = await res.text()
    return Response.json({ error: `GitHub ${res.status}: ${txt.slice(0, 200)}` }, { status: 500 })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
