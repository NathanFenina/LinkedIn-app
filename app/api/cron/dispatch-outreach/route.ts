// Cron Vercel : déclenche la session d'envoi outbound sur GitHub Actions.
// Vercel (plan Hobby) tire "dans l'heure" (10:xx et 11:xx UTC), donc on accepte
// 12h ET 13h Paris, et on n'ouvre JAMAIS deux sessions : si une session est
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
    // Une session déjà ouverte aujourd'hui ? (en cours ou en file) → rien à faire.
    const today = new Date().toISOString().slice(0, 10)
    const runs = await fetch(`${GH}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=5&created=>=${today}`, { headers }).then((r) => r.json()).catch(() => null)
    const open = (runs?.workflow_runs || []).filter((r: { status: string }) => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(r.status))
    if (open.length && !force) return Response.json({ ok: true, skipped: 'session déjà ouverte aujourd’hui', run: open[0].html_url })

    const res = await fetch(`${GH}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST', headers, body: JSON.stringify({ ref: 'main' }),
    })
    if (res.status !== 204) {
      const t = await res.text().catch(() => '')
      return Response.json({ error: `GitHub ${res.status}: ${t.slice(0, 200)}` }, { status: 502 })
    }
    return Response.json({ ok: true, dispatched: workflow, at: `${hour}h Paris` })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
