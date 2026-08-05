import { generateWelcomeMessage } from '@/lib/gemini'

export const maxDuration = 60

const DEFAULT_CONTEXT =
  process.env.SIGNAL_BUSINESS_CONTEXT || 'Agence/freelance SEO et acquisition B2B.'

// Génère un premier message de bienvenue (voix soft Nathan) pour une invitation.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  try {
    const text = await generateWelcomeMessage({
      name: body.name || '',
      headline: body.headline || null,
      invitationText: body.invitation_text || null,
      myBusinessContext: DEFAULT_CONTEXT,
    })
    return Response.json({ text })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
