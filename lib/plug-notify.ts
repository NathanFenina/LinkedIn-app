import { getServerSupabase } from './supabase'
import { analytics } from './plug-analytics'

// Notifications PLUG (cloche dans l'app) : stockées dans cockpit_notes,
// déjà lues par le Cockpit. Une notification par passage qui ajoute quelque chose.

type Db = ReturnType<typeof getServerSupabase>

const LABELS: Record<string, { one: string; many: string; link: string }> = {
  engagers: { one: 'nouvel engageur', many: 'nouveaux engageurs', link: '/plug' },
  accepted: { one: 'invitation acceptée — message prêt', many: 'invitations acceptées — messages prêts', link: '/plug' },
  x: { one: 'post X à commenter', many: 'posts X à commenter', link: '/plug' },
  missions: { one: 'mission (posts LinkedIn)', many: 'missions (posts LinkedIn)', link: '/plug' },
  jobs: { one: 'offre de mission', many: 'offres de mission', link: '/plug' },
  comments: { one: 'post LinkedIn à commenter', many: 'posts LinkedIn à commenter', link: '/plug' },
  fb: { one: 'besoin repéré dans un groupe BTP', many: 'besoins repérés dans les groupes BTP', link: '/plug' },
}

export async function notify(db: Db, kind: 'action' | 'info' | 'result' | 'alert', title: string, body?: string | null, link?: string | null) {
  await db.from('cockpit_notes').insert({ kind, title, body: body || null, link: link || null })
}

export async function notifyPart(db: Db, part: string, out: Record<string, unknown>) {
  if (part === 'convs') {
    const r = Number(out.replies || 0), l = Number(out.relances || 0)
    if (r + l > 0) await notify(db, 'action', `PLUG : ${r ? `${r} réponse${r > 1 ? 's' : ''} à traiter` : ''}${r && l ? ' · ' : ''}${l ? `${l} relance${l > 1 ? 's' : ''}` : ''}`, null, '/plug')
    return
  }
  const meta = LABELS[part]
  if (!meta) return
  const n = Number(out.added ?? out.promoted ?? 0)
  if (n > 0) await notify(db, part === 'accepted' ? 'action' : 'info', `PLUG : ${n} ${n > 1 ? meta.many : meta.one}`, null, meta.link)
}

// Bilan KPI (semaine / mois) → notification avec le résumé et l'analyse IA.
export async function kpiReport(db: Db, period: 'week' | 'month'): Promise<string> {
  const a = await analytics(db, period, true)
  const c = a.content.current, pc = a.content.previous, p = a.prospection.current
  const d = (x: number, y: number) => `${x - y >= 0 ? '+' : ''}${x - y}`
  const best = a.content.top[0]
  const body = [
    `Contenu LinkedIn : ${c.posts} posts, ${c.reactions} réactions (${d(c.reactions, pc.reactions)}), ${c.comments} commentaires (${d(c.comments, pc.comments)}), engagement moyen ${c.avg_engagement}.`,
    best ? `Meilleur post : « ${best.text.slice(0, 90).replace(/\n+/g, ' ')}… » (${best.reactions} réactions) ${best.url}` : '',
    `Prospection : ${p.messages} messages, ${p.replies} réponses (${p.reply_rate} %), ${p.invitations} invitations, ${p.accepted} acceptées.`,
    a.insights ? `\n${a.insights}` : '',
  ].filter(Boolean).join('\n')
  const title = `PLUG : bilan ${period === 'week' ? 'de la semaine' : 'du mois'}`
  await notify(db, 'result', title, body, '/plug/analyse')
  return title
}
