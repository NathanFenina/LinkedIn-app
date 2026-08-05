import { getServerSupabase } from '@/lib/supabase'
import { getChatMessages } from '@/lib/unipile'
import { generateReply } from '@/lib/gemini'

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/contacts/[id]/generate-message'>
) {
  const { id } = await ctx.params
  const { goal, template_id } = await request.json().catch(() => ({}))

  if (!goal?.trim()) {
    return Response.json({ error: 'goal requis' }, { status: 400 })
  }

  try {
    const db = getServerSupabase()
    const { data: contact, error } = await db
      .from('contacts')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !contact) {
      return Response.json({ error: 'Contact non trouvé' }, { status: 404 })
    }

    let templateContent: string | null = null
    if (template_id) {
      const { data: tpl } = await db
        .from('message_templates')
        .select('content')
        .eq('id', template_id)
        .single()
      templateContent = tpl?.content ?? null
    }

    let messages: Array<{ text: string; is_sender: boolean; created_at: string }> = []
    if (contact.chat_id) {
      const raw = await getChatMessages(contact.chat_id, 25)
      messages = raw.map((m) => ({
        text: m.text,
        is_sender: m.is_sender === 1 || m.is_sender === true,
        created_at: m.timestamp,
      }))
    }

    const text = await generateReply({
      contactName: contact.name,
      jobTitle: contact.job_title,
      goal: goal.trim(),
      template: templateContent,
      messages,
    })

    return Response.json({ text })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
