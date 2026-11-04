import { getServerSupabase } from './supabase'
import { getUserProfile, unipileFetch } from './unipile'
import { sourceLinkedInAccount } from './crosspost'
import { geminiCall, parseJson } from './plug'

// ---------------------------------------------------------------------------
// PLUG Veille : les meilleurs posts des créateurs suivis (lecture seule).
// Pour chaque profil LinkedIn de plug_watch_sources (le plus ancien d'abord) :
// les 20 derniers posts via Unipile → plug_watch_posts, score = réactions + 3×commentaires + 2×partages.
// Puis Gemini explique en une phrase pourquoi les meilleurs posts récents marchent (accroche, format, sujet).
// Espacé : quelques profils par appel, une consultation de profil seulement la première fois.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getServerSupabase>

function slug(url: string) {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : url.trim()
}

export async function fetchWatch(db: Db, maxSources = 4): Promise<{ sources: number; posts: number; explained: number; errors: string[] }> {
  const acc = await sourceLinkedInAccount(db)
  const { data: sources } = await db.from('plug_watch_sources').select('*').eq('active', true)
    .order('last_fetched_at', { ascending: true, nullsFirst: true }).limit(maxSources)
  let posts = 0
  const errors: string[] = []
  for (const s of sources || []) {
    try {
      let pid = s.provider_id as string | null
      let name = s.name as string | null
      if (!pid) {
        const prof = await getUserProfile(acc, slug(s.url))
        pid = prof.provider_id || null
        name = name || [prof.first_name, prof.last_name].filter(Boolean).join(' ') || null
        if (!pid) throw new Error('profil introuvable')
        await db.from('plug_watch_sources').update({ provider_id: pid, name }).eq('id', s.id)
      }
      const data = await unipileFetch(`/users/${encodeURIComponent(pid)}/posts?account_id=${encodeURIComponent(acc)}&limit=20`)
      const rows = ((data.items || []) as Array<Record<string, unknown>>)
        .filter((p) => !p.is_repost && p.share_url)
        .map((p) => {
          const reactions = Number(p.reaction_counter || 0), comments = Number(p.comment_counter || 0), reposts = Number(p.repost_counter || 0)
          const d = Date.parse(String(p.parsed_datetime || p.date || ''))
          return {
            source_id: s.id, author: name, url: String(p.share_url), text: String(p.text || '').slice(0, 3000),
            posted_at: isNaN(d) ? null : new Date(d).toISOString(), reactions, comments, reposts,
            score: reactions + comments * 3 + reposts * 2, fetched_at: new Date().toISOString(),
          }
        })
      if (rows.length) {
        const { error } = await db.from('plug_watch_posts').upsert(rows, { onConflict: 'url' })
        if (error) throw error
        posts += rows.length
      }
    } catch (err) {
      errors.push(`${s.name || s.url} : ${String(err).slice(0, 120)}`)
    }
    await db.from('plug_watch_sources').update({ last_fetched_at: new Date().toISOString() }).eq('id', s.id)
  }

  // « Pourquoi ça marche » pour les meilleurs posts des 14 derniers jours qui n'ont pas encore d'explication.
  let explained = 0
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  const { data: top } = await db.from('plug_watch_posts').select('id, author, text, reactions, comments')
    .is('why', null).gte('posted_at', since).order('score', { ascending: false }).limit(8)
  if (top?.length) {
    try {
      const list = top.map((p, i) => `#${i} | ${p.author || '?'} | ${p.reactions} réactions, ${p.comments} commentaires\n${String(p.text).slice(0, 700).replace(/\n+/g, ' / ')}`).join('\n\n')
      const out = parseJson<Array<{ i: number; why: string }>>(await geminiCall(`Tu fais de la veille LinkedIn pour Nathan Fenina (agence SEO/GEO). Pour chaque post, explique en UNE phrase pourquoi il performe (accroche, format, sujet, émotion) et ce que Nathan peut en reprendre pour ses propres posts. Français, concret, aucun chiffre inventé.
Réponds UNIQUEMENT en JSON : [{"i":0,"why":"..."}]
${list}`)) || []
      for (const o of out) {
        const p = top[o.i]
        if (p && o.why) { await db.from('plug_watch_posts').update({ why: o.why.slice(0, 500) }).eq('id', p.id); explained++ }
      }
    } catch (err) { errors.push(`Gemini : ${String(err).slice(0, 120)}`) }
  }
  return { sources: (sources || []).length, posts, explained, errors }
}
