import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

// Lance la SESSION de publication (poste les brouillons restants un par un,
// espacés) sans que l'utilisateur ait à ouvrir GitHub : on déclenche le workflow
// GitHub Actions via l'API (workflow_dispatch). Réactive la campagne au passage
// (la session ne poste QUE pour les campagnes actives, donc publier une campagne
// en pause ne ferait rien). Nécessite GITHUB_TOKEN (Actions: Read and write).
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
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
    // Réactive la campagne : "Publier tout" doit poster même si elle était en
    // pause (sinon la session, qui filtre active=true, ne la traiterait pas).
    const db = getServerSupabase()
    await db.from('comment_campaigns').update({ active: true }).eq('id', id)

    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      // post_only: la session poste UNIQUEMENT les brouillons existants (déjà
      // relus), sans en générer de nouveaux non validés.
      body: JSON.stringify({ ref: process.env.GITHUB_REF || 'main', inputs: { post_only: 'true' } }),
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
