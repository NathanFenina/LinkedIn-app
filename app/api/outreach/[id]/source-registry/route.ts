import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountId } from '@/lib/account'
import { lookupSearchParameter, searchLinkedIn } from '@/lib/unipile'
import { errMsg } from '@/lib/utils'

// Sourcing GRATUIT depuis le registre officiel des entreprises françaises
// (API Recherche d'entreprises, data.gouv, sans clé) :
//   secteur (NAF) × effectif × CA min × départements → entreprises actives
//   → dirigeant nommé au registre (Président / DG / Gérant) → son profil
//   LinkedIn via Unipile (recherche « Prénom Nom » dans l'entreprise)
//   → inséré en 'sourced' (dédup SIREN + provider_id + ne plus contacter).
// Avance par lot (max_companies par appel) et mémorise sa position
// (app_settings.registry_cursor_<campagne>) → rappeler la route continue la liste.
export const maxDuration = 300

const API = 'https://recherche-entreprises.api.gouv.fr/search'
const TRANCHES: Record<string, string> = { '11': '10-19', '12': '20-49', '21': '50-99', '22': '100-199', '31': '200-249' }
const ROLE_OK = /(pr[ée]sident|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|g[ée]rant|associ[ée] g[ée]rant)/i
const ROLE_KO = /(commissaire|suppl[ée]ant|liquidateur|administrateur judiciaire)/i
const ROLE_HEADLINE = /(\bceo\b|fondat|founder|pr[ée]sident|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|\bdg\b|managing director|g[ée]rant|associ[ée] fondat|managing partner)/i
const STOP = new Set(['groupe', 'group', 'conseil', 'consulting', 'france', 'societe', 'services', 'management', 'partners', 'solutions'])

type Dirigeant = { nom?: string; prenoms?: string; qualite?: string; type_dirigeant?: string }
type Entreprise = {
  siren: string; nom_complet?: string; nom_raison_sociale?: string
  tranche_effectif_salarie?: string; activite_principale?: string
  finances?: Record<string, { ca?: number | null; resultat_net?: number | null }>
  dirigeants?: Dirigeant[]; siege?: { libelle_commune?: string; departement?: string }
}
type Person = { provider_id?: string; id?: string; name?: string; first_name?: string; last_name?: string; headline?: string; profile_url?: string; public_identifier?: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const title = (s: string) => s.toLowerCase().replace(/(^|[\s\-'&])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function lastCa(f: Entreprise['finances']): { year: string; ca: number } | null {
  const years = Object.keys(f || {}).filter((y) => f?.[y]?.ca != null).sort()
  if (!years.length) return null
  const y = years[years.length - 1]
  return { year: y, ca: Number(f![y].ca) }
}
function growth(f: Entreprise['finances']): number | null {
  const years = Object.keys(f || {}).filter((y) => f?.[y]?.ca).sort()
  if (years.length < 2) return null
  const a = Number(f![years[years.length - 2]].ca), b = Number(f![years[years.length - 1]].ca)
  return a > 0 ? (b - a) / a : null
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const naf: string[] = (body.naf || ['70.22Z']).map(String)
  const tranches: string[] = (body.tranches || ['12', '21', '22', '31']).map(String)
  const departements: string[] = (body.departements || []).map(String)
  const caMin = Number(body.ca_min ?? 1500000)
  const maxCompanies = Math.min(25, Math.max(1, Number(body.max_companies) || 12))
  const reset = !!body.reset

  try {
    const db = getServerSupabase()
    const { data: campaign, error } = await db.from('outreach_campaigns').select('*').eq('id', id).single()
    if (error) throw error
    let accountId: string
    if (campaign.linkedin_account_id) {
      const { data } = await db.from('linkedin_accounts').select('unipile_account_id').eq('id', campaign.linkedin_account_id).maybeSingle()
      accountId = data?.unipile_account_id || (await getActiveAccountId())
    } else accountId = await getActiveAccountId()

    const cursorKey = `registry_cursor_${id}`
    const { data: cur } = await db.from('app_settings').select('value').eq('key', cursorKey).maybeSingle()
    const sig = JSON.stringify({ naf, tranches, departements, caMin })
    let state: { sig: string; page: number; idx: number } = { sig, page: 1, idx: 0 }
    try { const s = JSON.parse(cur?.value || ''); if (!reset && s.sig === sig) state = s } catch { /* départ */ }

    const params = new URLSearchParams({
      activite_principale: naf.join(','), tranche_effectif_salarie: tranches.join(','),
      etat_administratif: 'A', per_page: '25', page: String(state.page),
    })
    if (departements.length) params.set('departement', departements.join(','))
    if (caMin > 0) params.set('ca_min', String(caMin))
    const res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`API entreprises ${res.status}`)
    const page = (await res.json()) as { results: Entreprise[]; total_results: number; total_pages: number }

    const stats = { companies_seen: 0, skipped_registry: 0, dup: 0, not_found: 0, added: 0 }
    const added: Array<{ name: string; company: string; headline: string | null }> = []
    let idx = state.idx
    while (idx < page.results.length && stats.companies_seen < maxCompanies) {
      const e = page.results[idx++]
      stats.companies_seen++
      const companyName = e.nom_raison_sociale || e.nom_complet || ''
      if (!companyName || /holding|\bsci\b|participations?\b|financi[eè]re/i.test(companyName)) { stats.skipped_registry++; continue }
      const { data: dupSiren } = await db.from('outreach_targets').select('id').eq('siren', e.siren).limit(1)
      if (dupSiren && dupSiren.length) { stats.dup++; continue }
      const dir = (e.dirigeants || []).find((d) => d.type_dirigeant === 'personne physique' && d.nom && d.prenoms && ROLE_OK.test(d.qualite || '') && !ROLE_KO.test(d.qualite || ''))
      const companyTok = norm(companyName).replace(/\(.*?\)/g, ' ').split(' ').filter((w) => w.length > 3 && !STOP.has(w))

      // 1) Page entreprise LinkedIn — gardée seulement si le nom correspond au registre.
      let companyId: string | null = null
      let companyLabel = title(companyName.replace(/\s*\(.*?\)\s*/g, ' ').trim())
      try {
        const m = await lookupSearchParameter(accountId, 'COMPANY', companyName.replace(/\s*\(.*?\)\s*/g, ' ').trim(), 5)
        const hit = m.find((x) => x.id && companyTok.some((w) => norm(x.title || '').includes(w)))
        if (hit) { companyId = hit.id; if (hit.title) companyLabel = hit.title }
      } catch { /* on tente sans */ }
      await sleep(700)

      const search = async (keywords: string, withCompany: boolean): Promise<Person[]> => {
        try {
          const r = await searchLinkedIn<Person>(accountId, { category: 'people', keywords, limit: 10, ...(withCompany && companyId ? { extra: { company: [companyId] } } : {}) })
          await sleep(700)
          return r.items || []
        } catch { return [] }
      }
      const inCompany = (p: Person) => !!companyId || companyTok.some((w) => norm(p.headline || '').includes(w))
      let match: Person | undefined
      let via = ''
      // 2) Le dirigeant nommé au registre
      if (dir) {
        const prenom = (dir.prenoms || '').split(/[\s,]+/)[0]
        const nom = (dir.nom || '').replace(/\(.*?\)/g, '').trim()
        const lastTok = norm(nom).split(' ').pop() || ''
        const nameOk = (p: Person) => { const n = norm(p.name || `${p.first_name || ''} ${p.last_name || ''}`); return n.includes(norm(prenom)) && n.includes(lastTok) }
        let people = await search(`${prenom} ${nom}`, true)
        match = people.find((p) => nameOk(p) && inCompany(p))
        if (!match && companyId) { people = await search(`${prenom} ${nom}`, false); match = people.find((p) => nameOk(p) && companyTok.some((w) => norm(p.headline || '').includes(w))) }
        if (match) via = `dirigeant registre (${dir.qualite})`
      }
      // 3) Sinon : le dirigeant par son titre dans l'entreprise LinkedIn
      if (!match && companyId) {
        for (const kw of ['CEO', 'président', 'directeur général', 'fondateur']) {
          const people = await search(kw, true)
          match = people.find((p) => ROLE_HEADLINE.test(p.headline || ''))
          if (match) { via = `titre LinkedIn (${kw})`; break }
        }
      }
      const pid = match?.provider_id || match?.id
      if (!match || !pid) { stats.not_found++; continue }
      const { data: dup } = await db.from('outreach_targets').select('id').eq('provider_id', pid).limit(1)
      const { data: dnc } = await db.from('do_not_contact').select('provider_id').eq('provider_id', pid).limit(1)
      if ((dup && dup.length) || (dnc && dnc.length)) { stats.dup++; continue }

      const ca = lastCa(e.finances)
      const g = growth(e.finances)
      const reason = [
        `Registre`, `NAF ${e.activite_principale}`,
        TRANCHES[e.tranche_effectif_salarie || ''] ? `${TRANCHES[e.tranche_effectif_salarie || '']} sal.` : null,
        ca ? `CA ${(ca.ca / 1e6).toFixed(1)} M€ (${ca.year})` : null,
        g != null ? `${g >= 0 ? '+' : ''}${Math.round(g * 100)} %` : null,
        via, e.siege?.libelle_commune,
      ].filter(Boolean).join(' · ')
      const score = 7 + (g != null && g > 0.1 ? 2 : g != null && g > 0 ? 1 : 0)
      const { error: insErr } = await db.from('outreach_targets').insert({
        campaign_id: id, provider_id: pid, name: match.name || null,
        headline: match.headline ? `${match.headline} · ${companyLabel}` : companyLabel,
        company: companyLabel, profile_url: match.profile_url || null, public_identifier: match.public_identifier || null,
        score, score_reason: reason, status: 'sourced', siren: e.siren,
      })
      if (!insErr) { stats.added++; added.push({ name: match.name || '', company: companyLabel, headline: match.headline || null }) }
    }

    // Position suivante
    const next = idx >= page.results.length ? { sig, page: state.page + 1, idx: 0 } : { sig, page: state.page, idx }
    const exhausted = idx >= page.results.length && state.page >= (page.total_pages || 1)
    await db.from('app_settings').upsert({ key: cursorKey, value: JSON.stringify(next) }, { onConflict: 'key' })
    return Response.json({ ok: true, total_companies: page.total_results, page: state.page, exhausted, ...stats, added })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
