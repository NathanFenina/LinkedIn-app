import { getServerSupabase } from '@/lib/supabase'
import { extractPostIdFromUrl } from '@/lib/unipile'
import { getActiveAccountRowId } from '@/lib/account'

function parseList(input: unknown): string[] | null {
  if (!input) return null
  if (Array.isArray(input)) {
    const cleaned = input
      .map((s) => String(s).trim())
      .filter(Boolean)
    return cleaned.length ? cleaned : null
  }
  if (typeof input === 'string') {
    const cleaned = input
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    return cleaned.length ? cleaned : null
  }
  return null
}

export async function GET() {
  try {
    const db = getServerSupabase()
    const { data, error } = await db
      .from('competitor_targets')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { label, post_url, notes, job_title_keywords, company_size_tags } = body
  if (!post_url?.trim()) {
    return Response.json({ error: 'post_url requis' }, { status: 400 })
  }
  try {
    const db = getServerSupabase()
    const social_id = extractPostIdFromUrl(post_url)
    const accountRowId = await getActiveAccountRowId().catch(() => null)
    const { data, error } = await db
      .from('competitor_targets')
      .insert({
        label: label?.trim() || null,
        post_url: post_url.trim(),
        social_id,
        notes: notes?.trim() || null,
        active: true,
        job_title_keywords: parseList(job_title_keywords),
        company_size_tags: parseList(company_size_tags),
        linkedin_account_id: accountRowId,
      })
      .select()
      .single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
