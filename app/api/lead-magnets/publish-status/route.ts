// État de la dernière session d'envoi lead-magnets (GitHub Actions) — pour
// afficher "en cours / terminée" dans l'app sans ouvrir GitHub. Lecture seule.
export async function GET() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'NathanFenina/LinkedIn-app'
  const workflow = process.env.GITHUB_LEAD_MAGNETS_WORKFLOW || 'cron-lead-magnets.yml'
  if (!token) return Response.json({ available: false })
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )
    if (!res.ok) return Response.json({ available: false })
    const data = await res.json()
    const run = (data.workflow_runs || [])[0]
    if (!run) return Response.json({ available: true, none: true })
    return Response.json({
      available: true,
      status: run.status, // queued | in_progress | completed
      conclusion: run.conclusion, // success | failure | null
      started_at: run.run_started_at,
      html_url: run.html_url,
    })
  } catch {
    return Response.json({ available: false })
  }
}
