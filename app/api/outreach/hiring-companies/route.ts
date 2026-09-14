import { searchLinkedIn } from '@/lib/unipile'
import { getActiveAccount } from '@/lib/account'
import { errMsg } from '@/lib/utils'

export const maxDuration = 300

// « Boîtes qui recrutent » : cherche les offres d'emploi LinkedIn (France) pour
// des rôles donnés (SEO, growth, acquisition…) et renvoie les ENTREPRISES qui
// recrutent — signal budget + intention — à coller dans « Sourcer par entreprises ».
// Écarte les agences de recrutement / cabinets / job boards / agences SEO (concurrents).
const NOISE = /(recrut|talent|staffing|intérim|interim|jobgether|mantra jobs|bettingjobs|confidential|hays|michael page|robert half|adecco|manpower|randstad|expectra|fed\b|lynx rh|approach people|walters|conseil|consulting|cabinet|freelance|malt|indeed|welcome to the jungle|\bagence\b|agency|publicis|havas|dentsu|wpp|omnicom|eskimoz|primelis|hyffen|smartkeyword|cybercité|cybercite|botify|numberly|converteo|jakala|ey\b|kpmg|deloitte|capgemini|accenture|sopra|aubay|talan|sia partners|synchrone|crit\b|ad's up|yuri & neil|heroiks|methodeweb|jalis|darwin|axess|mintense|asight|d-impulse|genius|the genius|monolith)/i

type RawJob = { id?: string; company?: { name?: string } | string; company_name?: string }

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const keywords: string[] = Array.isArray(body.keywords) ? body.keywords.map((k: unknown) => String(k || '').trim()).filter(Boolean).slice(0, 12) : []
  const days = Math.max(1, Math.min(60, Number(body.days) || 30))
  if (!keywords.length) return Response.json({ error: 'Donne au moins un rôle (ex: SEO, growth, acquisition)' }, { status: 400 })
  try {
    const account = await getActiveAccount()
    const counts = new Map<string, { offres: number; roles: Set<string> }>()
    let jobs = 0
    for (const kw of keywords) {
      try {
        const { items } = await searchLinkedIn<RawJob>(account.unipile_account_id, { category: 'jobs', keywords: kw, limit: 50, extra: { date_posted: days } })
        for (const j of items) {
          jobs++
          const name = (typeof j.company === 'string' ? j.company : j.company?.name || j.company_name || '').trim()
          if (!name || NOISE.test(name)) continue
          const e = counts.get(name) || { offres: 0, roles: new Set<string>() }
          e.offres++; e.roles.add(kw); counts.set(name, e)
        }
      } catch { /* mot-clé suivant */ }
    }
    const companies = Array.from(counts.entries())
      .sort((a, b) => b[1].offres - a[1].offres)
      .map(([name, e]) => ({ name, offres: e.offres, roles: Array.from(e.roles) }))
    return Response.json({ ok: true, keywords, jobs, companies })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
