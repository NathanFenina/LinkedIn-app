import { errMsg } from '@/lib/utils'

// Lance la SESSION de publication (poste les brouillons restants un par un,
// espacés) sans que l'utilisateur ait à ouvrir GitHub : on déclenche le workflow
// GitHub Actions via l'API (workflow_dispatch). Nécessite un token GitHub dans
// l'env (GITHUB_TOKEN) avec la permission "actions:write" sur le repo.
export async function POST() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'NathanFenina/LinkedIn-app'
  const workflow = process.env.GITHUB_COMMENTS_WORKFLOW || 'cron-comments.yml'

  if (!token) {
    return Response.json(
      {
        error:
          'Pour publier depuis l’app, ajoute un token GitHub. Dans Vercel → Settings → Environment Variables, crée GITHUB_TOKEN (un fine-grained token avec Actions: Read and write sur le repo). Sinon, publie via GitHub → Actions → Auto-Comments Session → Run workflow.',
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
      return Response.json({ ok: true, message: 'Session de publication lancée. Les commentaires vont partir un par un, espacés (3-4 min).' })
    }
    const txt = await res.text()
    return Response.json({ error: `GitHub ${res.status}: ${txt.slice(0, 200)}` }, { status: 500 })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
