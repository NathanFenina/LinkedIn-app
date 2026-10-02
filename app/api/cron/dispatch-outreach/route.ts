// Cron Vercel : déclenche la session d'envoi outbound sur GitHub Actions.
// Vercel (plan Hobby) tire "dans l'heure" (10:xx et 11:xx UTC), donc on accepte
// 12h ET 13h Paris (la session attend ensuite 15h00 pile avant d'envoyer), et on n'ouvre JAMAIS deux sessions : si une session est
// déjà en cours / en attente aujourd'hui, on ne redéclenche pas.
// Vercel envoie "Authorization: Bearer CRON_SECRET".
export const maxDuration = 30

const CRON_SECRET = process.env.CRON_SECRET
const GH = 'https://api.github.com'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const force = new URL(request.url).searchParams.has('force')
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date())
  const weekday = parts.find((p) => p.type === 'weekday')?.value
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  if (weekday === 'Sat' || weekday === 'Sun') return Response.json({ ok: true, skipped: 'week-end' })
  if (!force && (hour < 12 || hour > 13)) {
    return Response.json({ ok: true, skipped: `il est ${hour}h à Paris, départ prévu à 12h` })
  }
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'NathanFenina/LinkedIn-app'
  const workflow = process.env.GITHUB_OUTREACH_WORKFLOW || 'cron-outreach.yml'
  if (!token) return Response.json({ error: 'GITHUB_TOKEN manquant' }, { status: 500 })
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  try {
    // Ouvre les DEUX sessions du jour (outbound + lead-magnets) ; chacune
    // attend 15h00 Paris avant d'envoyer. Jamais deux sessions d'un même
    // workflow le même jour.
    const today = new Date().toISOString().slice(0, 10)
    const results: Record<string, string> = {}
    // ?only=<fichier.yml> : n'ouvre que cette session (ex : rattrapage du jour).
    const only = new URL(request.url).searchParams.get('only')
    const all = [workflow, 'cron-lead-magnets.yml', 'cron-lm-comments.yml', 'cron-accept-invites.yml']
    for (const wf of only ? all.filter((w) => w === only) : all) {
      const runs = await fetch(`${GH}/repos/${repo}/actions/workflows/${wf}/runs?per_page=5&created=>=${today}`, { headers }).then((r) => r.json()).catch(() => null)
      const open = (runs?.workflow_runs || []).filter((r: { status: string }) => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(r.status))
      if (open.length && !force) { results[wf] = 'déjà ouverte'; continue }
      const res = await fetch(`${GH}/repos/${repo}/actions/workflows/${wf}/dispatches`, { method: 'POST', headers, body: JSON.stringify({ ref: 'main' }) })
      results[wf] = res.status === 204 ? 'lancée' : `GitHub ${res.status}`
    }
    return Response.json({ ok: true, at: `${hour}h Paris`, sessions: results })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
