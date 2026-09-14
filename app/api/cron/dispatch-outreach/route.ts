// Cron Vercel (précis à la minute, contrairement aux crons GitHub qui ont
// souvent 2-4 h de retard) : déclenche la session d'envoi outbound sur GitHub
// Actions à l'heure voulue. Vercel envoie "Authorization: Bearer CRON_SECRET".
export const maxDuration = 30

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Jamais le dimanche, et uniquement à 14h Paris : le cron Vercel tourne à
  // 12:00 ET 13:00 UTC (été / hiver), seul le tir qui tombe à 14h Paris passe.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date())
  const weekday = parts.find((p) => p.type === 'weekday')?.value
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  if (weekday === 'Sun') return Response.json({ ok: true, skipped: 'dimanche' })
  if (hour !== 14 && !new URL(request.url).searchParams.has('force')) {
    return Response.json({ ok: true, skipped: `il est ${hour}h à Paris, départ prévu à 14h` })
  }
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'NathanFenina/LinkedIn-app'
  const workflow = process.env.GITHUB_OUTREACH_WORKFLOW || 'cron-outreach.yml'
  if (!token) return Response.json({ error: 'GITHUB_TOKEN manquant' }, { status: 500 })
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    })
    if (res.status !== 204) {
      const t = await res.text().catch(() => '')
      return Response.json({ error: `GitHub ${res.status}: ${t.slice(0, 200)}` }, { status: 502 })
    }
    return Response.json({ ok: true, dispatched: workflow })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
