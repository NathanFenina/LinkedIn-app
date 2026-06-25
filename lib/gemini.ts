import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

export type SuggestedStatus =
  | 'to_contact'
  | 'in_progress'
  | 'do_not_contact'
  | 'prospect'
  | 'client'

export interface ScoringResult {
  score: number
  reason: string
  summary: string
  suggested_status: SuggestedStatus
}

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first >= 0 && last > first) return cleaned.slice(first, last + 1)
  return cleaned
}

export async function scoreConversation(
  contactName: string,
  messages: Array<{ text: string; is_sender: boolean; created_at: string }>
): Promise<ScoringResult> {
  const messagesText = messages
    .map(
      (m) =>
        `[${m.is_sender ? 'MOI' : contactName}] ${new Date(m.created_at).toLocaleDateString('fr-FR')}: ${m.text}`
    )
    .join('\n')

  const prompt = `Tu es un expert en prospection LinkedIn / setting B2B. Analyse cette conversation et retourne un JSON.

CONVERSATION avec ${contactName}:
${messagesText}

Retourne UNIQUEMENT ce JSON (sans markdown, sans backticks):
{
  "score": <nombre entre 1 et 10, où 10 = très chaud/intéressé, 1 = froid/pas intéressé>,
  "reason": "<explication courte du score en 1 phrase>",
  "summary": "<résumé de la conversation en 1-2 phrases>",
  "suggested_status": "<un de: to_contact | in_progress | do_not_contact | prospect | client>"
}

Critères de scoring:
- 8-10: Prospect très chaud, a exprimé de l'intérêt, pose des questions, souhaite en savoir plus
- 5-7: Conversation active, quelques échanges, potentiel moyen
- 3-4: Peu d'engagement, réponses courtes ou neutres
- 1-2: Pas de réponse depuis longtemps, ou refus clair

Critères de statut:
- to_contact: conversation jamais vraiment lancée, à initier
- in_progress: échange en cours, pas encore qualifié
- prospect: intérêt clair, devrait déboucher sur un RDV
- client: a signé / est déjà client
- do_not_contact: refus explicite, pas intéressé, agressif`

  const result = await model.generateContent(prompt)
  const text = result.response.text().trim()

  try {
    const parsed = JSON.parse(extractJson(text))
    const allowed: SuggestedStatus[] = ['to_contact', 'in_progress', 'do_not_contact', 'prospect', 'client']
    const suggested = allowed.includes(parsed.suggested_status) ? parsed.suggested_status : 'in_progress'
    return {
      score: Math.max(1, Math.min(10, Math.round(parsed.score))),
      reason: parsed.reason || '',
      summary: parsed.summary || '',
      suggested_status: suggested,
    }
  } catch {
    return { score: 5, reason: 'Score par défaut', summary: text, suggested_status: 'in_progress' }
  }
}

export interface SignalQualification {
  is_real_signal: boolean
  reason: string
}

export async function qualifySignalPost(params: {
  authorName: string
  authorHeadline?: string | null
  content: string
  matchedKeyword: string
  context: string
}): Promise<SignalQualification> {
  const prompt = `Tu es un expert en setting B2B. Tu dois qualifier si un post LinkedIn est un VRAI signal d'intention d'achat ou juste du bruit.

CONTEXTE BUSINESS DE L'UTILISATEUR: ${params.context}

POST DE: ${params.authorName}${params.authorHeadline ? ` — ${params.authorHeadline}` : ''}
MOT-CLÉ DÉCLENCHEUR: ${params.matchedKeyword}
CONTENU DU POST:
"""
${params.content}
"""

Vraie intention = la personne CHERCHE ACTIVEMENT à acheter/embaucher dans le sujet (ex: "je cherche un consultant SEO pour ma boîte").
Bruit = la personne PARLE DU SUJET sans intention d'achat (ex: "10 conseils pour faire du SEO", "merci à mon consultant SEO", critique générale, post inspirationnel).

Retourne UNIQUEMENT ce JSON (sans markdown, sans backticks):
{
  "is_real_signal": <true|false>,
  "reason": "<1 phrase courte expliquant>"
}`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const parsed = JSON.parse(extractJson(text))
    return {
      is_real_signal: !!parsed.is_real_signal,
      reason: parsed.reason || '',
    }
  } catch {
    return { is_real_signal: false, reason: 'Échec qualification IA' }
  }
}

export interface ProfileScoreResult {
  score: number
  reason: string
}

export async function scoreProfile(params: {
  name: string
  jobTitle: string | null
  myBusinessContext: string
}): Promise<ProfileScoreResult> {
  const prompt = `Tu es un expert en setting B2B. Tu dois scorer si une personne LinkedIn est un PROSPECT POTENTIEL pour notre business, basé uniquement sur son nom et son intitulé de poste (pas de conversation).

CONTEXTE BUSINESS: ${params.myBusinessContext}

PERSONNE: ${params.name}
INTITULÉ DE POSTE: ${params.jobTitle || '(non renseigné)'}

Critères de scoring (1-10):
- 9-10: Profil idéal (poste de décideur dans une cible parfaite : CMO/Founder/Head of dans une boîte qui aurait clairement ce besoin)
- 7-8: Profil cible (rôle pertinent OU industrie pertinente)
- 5-6: Profil neutre, possiblement pertinent
- 3-4: Profil pas vraiment cible
- 1-2: Pas du tout cible (étudiant, retraité, secteur incompatible)

Retourne UNIQUEMENT ce JSON (sans markdown, sans backticks):
{
  "score": <nombre 1-10>,
  "reason": "<1 phrase courte>"
}`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const parsed = JSON.parse(extractJson(text))
    return {
      score: Math.max(1, Math.min(10, Math.round(parsed.score))),
      reason: parsed.reason || '',
    }
  } catch {
    return { score: 5, reason: 'Échec scoring profil' }
  }
}

export interface CompetitorLeadScore {
  score: number
  reason: string
}

export async function scoreCompetitorLead(params: {
  commenterName: string
  commenterHeadline?: string | null
  commentText: string
  postContext?: string
  myBusinessContext: string
}): Promise<CompetitorLeadScore> {
  const prompt = `Tu es un expert en setting B2B. Tu dois scorer un commentaire trouvé sous un post LinkedIn (généralement le post d'un concurrent).
Le but est de qualifier si le commentateur est un PROSPECT POTENTIEL pour notre business.

CONTEXTE BUSINESS: ${params.myBusinessContext}

POST CONTEXT: ${params.postContext || '(non fourni)'}

COMMENTATEUR: ${params.commenterName}${params.commenterHeadline ? ` — ${params.commenterHeadline}` : ''}
COMMENTAIRE:
"""
${params.commentText}
"""

Critères de scoring (1-10):
- 9-10: Profil idéal qui exprime un besoin / pose une question / cherche une solution dans le commentaire
- 7-8: Profil cible (rôle / industrie pertinents) qui montre de l'engagement / curiosité
- 5-6: Profil cible mais commentaire neutre ("intéressant", "merci pour le partage")
- 3-4: Profil hors cible mais commentaire engagé
- 1-2: Hors cible total / spam / influenceur qui se met en avant

Retourne UNIQUEMENT ce JSON (sans markdown, sans backticks):
{
  "score": <nombre 1-10>,
  "reason": "<1 phrase courte expliquant le score>"
}`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const parsed = JSON.parse(extractJson(text))
    return {
      score: Math.max(1, Math.min(10, Math.round(parsed.score))),
      reason: parsed.reason || '',
    }
  } catch {
    return { score: 5, reason: 'Échec scoring IA' }
  }
}

export async function generateInvitationMessage(params: {
  commenterName: string
  commenterHeadline?: string | null
  commentText: string
  myBusinessContext: string
}): Promise<string> {
  const prompt = `Tu rédiges un message d'invitation LinkedIn (300 caractères max) à envoyer à quelqu'un qui a commenté un post.

CONTEXTE BUSINESS: ${params.myBusinessContext}
PERSONNE: ${params.commenterName}${params.commenterHeadline ? ` — ${params.commenterHeadline}` : ''}
SON COMMENTAIRE:
"""
${params.commentText}
"""

Règles:
- Tutoiement, ton naturel, max 300 caractères.
- Réfère-toi à son commentaire concret (pas générique).
- Pas de pitch direct. Juste connecter sur l'intérêt commun.
- Pas de "j'espère que vous allez bien".

Retourne UNIQUEMENT le texte du message, sans guillemets.`

  try {
    const result = await model.generateContent(prompt)
    return result.response
      .text()
      .trim()
      .replace(/^["']|["']$/g, '')
      .slice(0, 300)
  } catch {
    return ''
  }
}

// ===========================================================================
// Auto-comment pipeline (port of the n8n "Auto Comments" workflow)
//   1. detectLanguageAndMood  → langue + humeur du post
//   2. chooseCommentStrategy  → choisit UNE stratégie + angle + self_reference
//   3. generateLinkedInComment → rédige le commentaire dans la persona du compte
// ===========================================================================

export interface LanguageMood {
  language: string
  mood: string
}

export async function detectLanguageAndMood(text: string): Promise<LanguageMood> {
  const prompt = `You are an assistant for language and mood detection.

Analyze the text below and return two things: the primary written language and the overall mood/tone.

Rules:
- Language: ignore emojis, symbols and flags. If multiple languages, use the first full natural sentence. Return a lowercase language name (e.g. english, german, french). If only emojis/symbols, return "unknown".
- Mood: general tone (e.g. enthusiastic, neutral, critical, reflective, playful, formal). Base it on text only. If unclear, return "neutral".

TEXT:
"""
${text}
"""

Return ONLY this JSON (no markdown, no backticks):
{ "language": "<lowercase language>", "mood": "<mood>" }`

  try {
    const result = await model.generateContent(prompt)
    const parsed = JSON.parse(extractJson(result.response.text().trim()))
    return {
      language: (parsed.language || 'french').toString().toLowerCase(),
      mood: (parsed.mood || 'neutral').toString(),
    }
  } catch {
    return { language: 'french', mood: 'neutral' }
  }
}

export interface CommentStrategy {
  strategy: string
  description: string
  self_reference: boolean
}

export async function chooseCommentStrategy(params: {
  personaName: string
  brand: string
  postText: string
}): Promise<CommentStrategy> {
  const prompt = `{
  "Role": "Tu es ${params.personaName}, expert SEO & IA. Tu écris comme un humain qui a une vraie conversation, pas comme un marketeur. Direct, parfois blunt, vulnérable quand c'est naturel.",
  "Core Philosophy": "Un bon commentaire apporte UNE seule chose : une observation concrète, une vraie question, ou une réaction humaine authentique. Si t'as rien d'unique à dire, tu ne commentes pas.",
  "Task": "Lis ce post LinkedIn. Choisis UNE stratégie, la plus naturelle pour ce post précis.",
  "Strategies": [
    "add_field_insight → Observation concrète depuis ton expérience SEO/IA/automation qui enrichit le point de l'auteur avec quelque chose de précis et non-obvious.",
    "share_vulnerability → Tu t'es retrouvé dans la même situation, t'as galéré, et tu le dis sans fioritures.",
    "challenge_with_nuance → Tu questionnes doucement une prémisse avec un contre-exemple précis. Pas pour avoir raison, pour ouvrir le débat.",
    "ask_genuine_question → Une vraie question que tu te poses sur leur process. Pas rhétorique. Parce que tu veux vraiment savoir.",
    "offer_alternative_angle → Une approche différente que t'as testée, avec honnêteté sur les trade-offs.",
    "highlight_practical_gap → Un problème réel, une limite, un edge case que t'as rencontré qui manque dans leur analyse.",
    "pure_human_reaction → Réaction humaine brute : surprise, reconnaissance, humour léger. Zéro lien avec le boulot.",
    "share_parallel_experience → Une expérience similaire dans un contexte différent qui éclaire leur point autrement.",
    "ask_about_context → Tu veux comprendre les contraintes cachées qui ont conduit à leur choix."
  ],
  "Self-Promotion Constraint": "80% des commentaires sans mention de ${params.brand}. Quand self_reference=yes, c'est une observation apprise, pas une pub.",
  "Red flags à éviter": ["Reformuler ce que l'auteur vient de dire", "Enchaîner agree + expand + question comme une formule", "Forcer un lien avec ton domaine si le post n'est pas dans ta zone"]
}

POST:
"""
${params.postText}
"""

Retourne UNIQUEMENT ce JSON (sans markdown, sans backticks):
{
  "strategy": "<nom de la stratégie choisie>",
  "description": "<Pourquoi cette stratégie est la plus naturelle pour CE post, et quel angle précis tu vas prendre>",
  "self_reference": "<yes|no>"
}`

  try {
    const result = await model.generateContent(prompt)
    const parsed = JSON.parse(extractJson(result.response.text().trim()))
    const sr = String(parsed.self_reference || 'no').toLowerCase().trim()
    return {
      strategy: parsed.strategy || 'add_field_insight',
      description: parsed.description || '',
      self_reference: sr === 'yes' || sr === 'true',
    }
  } catch {
    return { strategy: 'add_field_insight', description: '', self_reference: false }
  }
}

export async function generateLinkedInComment(params: {
  personaName: string
  personaIdentity?: string | null
  brand: string
  postText: string
  language: string
  mood: string
  strategy: string
  strategyDescription: string
  selfReference: boolean
}): Promise<string> {
  const prompt = `## IDENTITÉ

Tu es ${params.personaName}. Tu écris un commentaire LinkedIn. Pas un post, pas un article, un commentaire, comme si tu tapais sur ton téléphone en 45 secondes.

## CE QUE TU ES

${params.personaIdentity?.trim() || `Expert SEO, IA, automation, business en ligne. 12 ans de terrain. T'as vu des trucs, t'as merdé des trucs, et t'assumes les deux. Tu n'es pas un compte corporate.`}

## RÈGLES ABSOLUES

- Longueur stricte : 2 à 3 phrases. Pas une de plus.
- Pas d'emojis. Pas de tirets. Pas de points d'exclamation après un compliment.
- Zéro formule : pas de "Super post", "Merci pour ce partage", "Ce post aborde...".
- Zéro structure en 3 parties : agree + expand + question. C'est le signe d'un robot.
- Jamais commencer par reformuler ce que l'auteur a dit.

## CE QUI EST AUTORISÉ (et souhaitable)

- Une observation précise que seul quelqu'un avec ton expérience ferait
- Une vraie question parce que tu veux vraiment savoir
- Un moment de vulnérabilité ou d'aveu
- Un truc drôle ou inattendu si le post s'y prête
- Dire que tu n'es pas d'accord, calmement, avec un exemple

## CONTRAINTE AUTO-PROMO

self_reference = ${params.selfReference ? 'yes' : 'no'}
Si "no" : aucune mention de ${params.brand}, "mes clients", "notre agence". Tu parles comme un pro qui partage, pas comme un fondateur qui pitch.
Si "yes" : une seule mention, naturelle, sur ce que t'as observé ou appris, pas sur ce que tu vends.

## STRATÉGIE À IMPLÉMENTER

${params.strategy} : ${params.strategyDescription}

## LANGUE & HUMEUR

Langue : ${params.language}
Longueur : 2 sentences (about 20 words)
Mood : ${params.mood}

## POST AUQUEL TU RÉPONDS
"""
${params.postText}
"""

## OUTPUT

Texte brut uniquement. Aucun markdown, aucun label, aucun guillemet. Juste le commentaire, prêt à copier.`

  const result = await model.generateContent(prompt)
  return result.response.text().trim().replace(/^["']|["']$/g, '')
}

export async function generateReply(params: {
  contactName: string
  jobTitle: string | null
  goal: string
  template?: string | null
  messages: Array<{ text: string; is_sender: boolean; created_at: string }>
}): Promise<string> {
  const { contactName, jobTitle, goal, template, messages } = params

  const history = messages
    .slice()
    .reverse()
    .map(
      (m) =>
        `[${m.is_sender ? 'MOI' : contactName}] ${m.text}`
    )
    .join('\n')

  const prompt = `Tu es un expert en setting B2B sur LinkedIn. Tu rédiges un message court, humain, direct, sans baratin marketing, pour avancer vers un RDV.

CIBLE: ${contactName}${jobTitle ? ` (${jobTitle})` : ''}
OBJECTIF DE CE MESSAGE: ${goal}

${template ? `TEMPLATE À ADAPTER (garde le ton mais personnalise, ne copie pas):\n${template}\n` : ''}
${history ? `HISTORIQUE (du plus ancien au plus récent):\n${history}\n` : 'PAS D\'HISTORIQUE — c\'est le premier message.'}

Règles:
- Tutoiement, ton naturel, pas d'emoji sauf si la conversation en contient déjà.
- Max 4 phrases courtes.
- Pas de "J'espère que vous allez bien", pas de "Je me permets de".
- Si tu poses une question, une seule, concrète.

Retourne UNIQUEMENT le texte du message, sans guillemets, sans préfixe.`

  const result = await model.generateContent(prompt)
  return result.response.text().trim().replace(/^["']|["']$/g, '')
}
