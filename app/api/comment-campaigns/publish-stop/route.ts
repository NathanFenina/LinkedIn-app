import { errMsg } from '@/lib/utils'

// Arrête la SESSION de publication en cours : annule le run GitHub Actions
// (cron-comments) en cours/queue. Ça coupe l'envoi tout de suite SANS toucher
// au statut "actif" des campagnes → l'auto quotidien reste programmé.
// Nécessite GITHUB_TOKEN (Actions: Read and write).
export async function POST() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'NathanFenina/LinkedIn-app'
  const workflow = process.env.GITHUB_COMMENTS_WORKFLOW || 'cron-comments.yml'
  if (!token) {
    return Response.json({ error: 'GITHUB_TOKEN manquant pour arrêter la session.', need_token: true }, { status: 400 })
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  try {
    // Runs en cours (in_progress) puis en attente (queued).
    const runIds: number[] = []
    for (const status of ['in_progress', 'queued']) {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=10`,
        { headers }
      )
      if (!res.ok) continue
      const data = await res.json()
      for (const run of data.workflow_runs || []) runIds.push(run.id)
    }
    if (runIds.length === 0) {
      return Response.json({ ok: true, cancelled: 0, message: 'Aucune session en cours à arrêter.' })
    }
    let cancelled = 0
    for (const id of runIds) {
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${id}/cancel`, { method: 'POST', headers })
      if (res.status === 202) cancelled++
    }
    return Response.json({
      ok: true,
      cancelled,
      message: `Session arrêtée (${cancelled} run annulé). L'envoi s'arrête dans quelques secondes. L'auto quotidien reste actif.`,
    })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
