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

function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string }
    return [e.message, e.details, e.hint, e.code ? `(code ${e.code})` : '']
      .filter(Boolean)
      .join(' · ')
  }
  return String(err)
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
    console.error('GET /api/competitor/targets failed:', err)
    return Response.json({ error: errorMessage(err) }, { status: 500 })
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
    console.error('POST /api/competitor/targets failed:', err)
    return Response.json({ error: errorMessage(err) }, { status: 500 })
  }
}
