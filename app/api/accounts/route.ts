import { getServerSupabase } from '@/lib/supabase'

export async function GET() {
  const db = getServerSupabase()
  const { data, error } = await db
    .from('linkedin_accounts')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data || [])
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const label: string | undefined = body.label?.trim()
  const unipile_account_id: string | undefined = body.unipile_account_id?.trim()
  const is_default = !!body.is_default

  if (!label || !unipile_account_id) {
    return Response.json(
      { error: 'label et unipile_account_id requis' },
      { status: 400 }
    )
  }

  const db = getServerSupabase()

  if (is_default) {
    await db.from('linkedin_accounts').update({ is_default: false }).neq('id', '')
  }

  const { data, error } = await db
    .from('linkedin_accounts')
    .insert({ label, unipile_account_id, is_default })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
