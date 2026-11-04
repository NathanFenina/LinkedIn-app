import { getServerSupabase } from '@/lib/supabase'
import { errMsg } from '@/lib/utils'

// PLUG — import d'images et de vidéos pour les posts.
// POST { name, type } → URL d'envoi signée (valable 2 h) vers le bucket public « plug-media ».
// Le navigateur envoie ensuite le fichier directement à Supabase (PUT) : pas de limite de taille Vercel,
// jusqu'à 50 Mo par fichier. Renvoie aussi l'URL publique à mettre dans le post.
const TYPES = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|quicktime))$/

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { name?: string; type?: string }
  if (!b.type || !TYPES.test(b.type)) return Response.json({ error: 'Formats acceptés : PNG, JPG, GIF, WebP, MP4, MOV' }, { status: 400 })
  try {
    const db = getServerSupabase()
    const clean = String(b.name || 'fichier').normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-60)
    const path = `plug/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${clean}`
    const { data, error } = await db.storage.from('plug-media').createSignedUploadUrl(path)
    if (error) throw error
    const { data: pub } = db.storage.from('plug-media').getPublicUrl(path)
    return Response.json({ upload_url: data.signedUrl, path, url: pub.publicUrl, kind: b.type.startsWith('video') ? 'video' : 'image' })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
