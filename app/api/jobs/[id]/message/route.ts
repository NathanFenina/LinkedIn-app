import { getServerSupabase } from '@/lib/supabase'
import { generateJobOutreachMessage } from '@/lib/gemini'

export const maxDuration = 60

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT || 'Agence/freelance SEO et acquisition B2B.'

// Génère un message d'approche pour un décideur repéré sur une offre.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  try {
    const db = getServerSupabase()
    const { data: job } = await db.from('job_postings').select('title, company').eq('id', id).maybeSingle()
    const text = await generateJobOutreachMessage({
      name: body.name || '',
      headline: body.headline || null,
      jobTitle: job?.title || body.job_title || null,
      company: job?.company || body.company || null,
      myBusinessContext: DEFAULT_CONTEXT,
    })
    return Response.json({ text })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
