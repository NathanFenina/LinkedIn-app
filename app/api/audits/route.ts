import { getServerSupabase } from '@/lib/supabase'
import { getActiveAccountRowId } from '@/lib/account'

// GET : liste des cibles d'audit (avec compteur d'envoyés implicite via status).
export async function GET() {
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('audit_targets')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) throw error
    return Response.json(data || [])
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// POST : création en masse depuis une liste collée.
// Body: { text: "Nom<TAB|;|2+ espaces>url\n..." }  OU  { items: [{company, audit_url}] }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  try {
    const db = getServerSupabase()
    const accountRowId = await getActiveAccountRowId().catch(() => null)

    let items: Array<{ company: string; audit_url: string | null }> = []
    if (Array.isArray(body.items)) {
      items = body.items
        .map((it: { company?: string; audit_url?: string }) => ({
          company: (it.company || '').trim(),
          audit_url: (it.audit_url || '').trim() || null,
        }))
        .filter((it: { company: string }) => it.company)
    } else if (typeof body.text === 'string') {
      items = (body.text as string)
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => {
          // Sépare sur tabulation, point-virgule, ou 2+ espaces.
          const parts = line.split(/\t|;|\s{2,}/).map((p) => p.trim()).filter(Boolean)
          // Si pas de séparateur clair mais une URL en fin de ligne, on la capte.
          if (parts.length === 1) {
            const m = line.match(/^(.*?)\s+(https?:\/\/\S+)$/)
            if (m) return { company: m[1].trim(), audit_url: m[2].trim() }
            return { company: parts[0], audit_url: null }
          }
          const urlPart = parts.find((p) => /^https?:\/\//i.test(p)) || null
          const company = parts.find((p) => !/^https?:\/\//i.test(p)) || parts[0]
          return { company, audit_url: urlPart }
        })
        .filter((it) => it.company)
    }

    if (!items.length) {
      return Response.json({ error: 'Aucune ligne exploitable' }, { status: 400 })
    }

    const rows = items.map((it) => ({
      company: it.company,
      audit_url: it.audit_url,
      status: 'pending',
      linkedin_account_id: accountRowId,
    }))
    const { data, error } = await db.from('audit_targets').insert(rows).select()
    if (error) throw error
    return Response.json({ ok: true, created: data?.length || 0, items: data })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
