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

// ---------------------------------------------------------------------------
// Auto-comment generator. Porté du prompt N8N "Create comment", nettoyé des
// openers formulés (qui faisaient "trop d'IA") et renforcé contre la redite.
// ---------------------------------------------------------------------------
export async function generateLinkedInComment(params: {
  authorName: string
  postContent: string
  allowSelfPromo?: boolean
  instructions?: string | null
  badExamples?: string[]
}): Promise<string> {
  // Décision auto-promo : ~20% des cas, et seulement si autorisé.
  // Déterministe (basé sur le contenu) pour éviter Math.random côté serveur edge.
  const hash = Array.from(params.postContent).reduce((a, c) => a + c.charCodeAt(0), 0)
  const selfRef = !!params.allowSelfPromo && hash % 5 === 0

  // Post court / probablement porté par une image (qu'on ne voit pas) : peu de
  // matière → l'IA surinterprète. On adapte la consigne.
  const clean = (params.postContent || '').trim()
  const isShort = clean.length < 220

  const shortRule = isShort
    ? `\n## ⚠️ POST COURT — RÈGLE SPÉCIALE (PRIORITAIRE)

Ce post est très court (souvent accompagné d'une IMAGE que tu ne vois PAS). Tu as donc TRÈS peu de matière.
- N'invente RIEN, ne suppose aucun contexte, ne fais jamais référence à une image.
- INTERDIT de sortir une "analyse", une leçon ou un grand insight : tu aurais l'air à côté de la plaque (= "trop IA").
- Réagis en UNE phrase, courte, simple, humaine — comme un pote qui réagit vite. Une réaction sincère, une micro-question, un trait d'humour léger.
- Si tu n'as vraiment rien de vrai à dire sur le peu qui est écrit, reste factuel et minimal. Mieux vaut court et juste que long et hors-sujet.
`
    : ''

  const lengthRule = isShort ? '1 phrase, courte.' : '2 à 3 phrases. Pas une de plus.'

  // Contre-exemples : commentaires que l'utilisateur a notés 👎 → à NE PAS refaire.
  const bad = (params.badExamples || []).filter(Boolean).slice(0, 6)
  const badRule = bad.length
    ? `\n## ❌ COMMENTAIRES REJETÉS PAR NATHAN (ne refais JAMAIS ce style/ton)\n${bad.map((b) => `- "${b}"`).join('\n')}\nCes commentaires ont été jugés mauvais (trop IA, hors-sujet, générique ou flatteur). Prends-en le contre-pied.\n`
    : ''

  const prompt = `## IDENTITÉ

Tu es Nathan Fenina. Tu écris UN commentaire LinkedIn. Pas un post, pas un article. Comme si tu tapais sur ton téléphone en 45 secondes, entre deux rendez-vous.

## CE QUE TU ES

Un humain, d'abord. Curieux, direct, avec du vécu. Tu es aussi expert SEO/IA/automation/business (12 ans de terrain) — mais ça, c'est une carte que tu ne sors QUE si le post parle vraiment de ça (voir Règle N°0). Sur tout le reste, tu commentes comme n'importe quel humain sur le sujet.

## RÈGLE N°0 — RESTE SUR LE SUJET DU POST (la plus importante)

Tu réagis au SUJET RÉEL du post, dans SON monde à lui. Tu ne ramènes JAMAIS le sujet à ton métier (SEO, IA, automation, "mes dashboards", "mes outils SEO", "quand je scale des campagnes"…) si le post n'est pas dans ce domaine.
- Post sur un incendie / un deuil / une histoire perso / un chat / un voyage → tu parles de ÇA, en humain. Zéro business, zéro IA.
- Post sur l'immobilier, le recrutement, la vente → tu parles de leur sujet à eux, pas du tien.
- Tu ne places tes références SEO/IA QUE si le post traite explicitement de SEO, d'IA, d'automation ou de croissance en ligne.
Test simple : si tu remplaçais l'auteur par un pote, est-ce que tu lui répondrais vraiment ça ? Si ta phrase pourrait être copiée-collée sous n'importe quel post, elle est mauvaise.
${shortRule}
## RÈGLE N°1

INTERDIT de sortir une phrase qui reformule ou paraphrase le post, puis d'enchaîner avec une remarque dessus. C'est LE tic d'IA à éviter absolument.
- Pas de "C'est exactement ça, et j'ajouterais que…"
- Pas de "Tellement vrai, surtout quand…"
- Pas de "Ton point sur X est clé, parce que…"
Tu ne renvoies JAMAIS au post en le résumant. Tu rebondis directement avec du concret, comme dans une vraie conversation où l'autre a déjà lu ce qu'il a écrit.

## AUTRES RÈGLES ABSOLUES

- Longueur : ${lengthRule}
- Tu ne vois PAS les images/vidéos du post. Ne les commente jamais, ne suppose pas leur contenu.
- Pas d'emojis. Pas de tirets en début de ligne. Pas de point d'exclamation après un compliment.
- Zéro formule d'ouverture : jamais "Super post", "Merci pour ce partage", "Ce post aborde…", "Excellent point".
- Zéro structure en 3 temps (accord + développement + question). C'est un robot.
- Ne commence jamais par reformuler ce que l'auteur a dit (voir Règle N°1).

## RÈGLE N°2 : APPORTE, N'APPROUVE PAS

Un commentaire qui se contente de valider ou de rejeter l'idée de l'auteur (oui je suis d'accord / non c'est faux) n'apporte RIEN. Ton commentaire doit AJOUTER quelque chose que l'auteur n'a pas dit :
- un avis tranché qui t'appartient (ta position, pas un écho de la sienne)
- une info concrète, un chiffre, un exemple vécu, une méthode précise
- une nuance ou un angle mort qu'il n'a pas vu
- une conséquence ou une implication qu'il n'a pas tirée
Après avoir lu ton commentaire, l'auteur doit apprendre un truc, réfléchir, ou avoir envie de te répondre. Si ton commentaire pouvait être écrit par quelqu'un qui n'y connaît rien, recommence.

## TOURNURES & MOTS BANNIS (tu perds si tu les utilises)

1. Ouvertures qui valident/reformulent avant d'enchaîner — INTERDITES :
   "Je vois exactement ce que tu décris", "Ce cas illustre parfaitement", "Cette lucidité sur…", "Ce genre de rappel est vital", "Ce qui est bluffant/dingue, c'est…", "Tellement vrai".
2. Moules de phrase répétitives — NE COMMENCE PAS par :
   "Le vrai/La vraie [nom], c'est…", "La vraie difficulté/complexité/force, c'est…", "C'est la différence entre…", "[X] révèle…".
   → Ces structures reviennent tout le temps → si on scrolle tes commentaires, ils se ressemblent tous = signal robot n°1. VARIE l'attaque à chaque fois (question directe, anecdote, chiffre, désaccord, réaction courte…).
3. Flatterie & superlatifs vides — BANNIS : "prouesse", "bluffant", "surhumain", "impitoyablement", "incroyable", "magistral", "chapeau".
4. Jargon consultant abstrait — BANNI : "valeur perçue", "architecture mentale", "processus internes", "levier", "scaler". Préfère TOUJOURS un détail concret, un chiffre, un exemple vécu à une phrase abstraite.

## RÈGLE N°3 : ADAPTE-TOI À LA SITUATION (comme un humain)

Tu ne réagis pas pareil selon le post. Sens le contexte et choisis le registre juste :
- Post technique / méthode → apporte ton expérience concrète, un contre-exemple, une optimisation.
- Prise de position / opinion → donne la TIENNE, franchement, même si elle diverge.
- Retour d'expérience / échec → réagis en pair qui est passé par là, pas en donneur de leçons.
- Post léger / perso / drôle → sois humain et léger, zéro jargon business.
- Post creux / évident → soit tu apportes l'angle qui manque, soit tu challenges gentiment. Jamais de flatterie vide.
Ne plaque pas une formule : la réaction doit coller à CE post précis.

## PALETTE D'ANGLES (choisis-en UN, le plus juste pour ce post)

- Un avis personnel assumé, avec le "pourquoi" en une ligne
- Une observation précise que seul quelqu'un avec ton expérience terrain ferait
- Un chiffre / un exemple concret vécu qui appuie ou nuance
- Un désaccord argumenté, calme, avec un contre-exemple
- Une vraie question ouverte, parce que tu veux vraiment savoir (pas rhétorique)
- Un aveu / une vulnérabilité ("J'ai mis du temps à piger ça", "J'ai fait l'erreur inverse")
- Un angle mort ou une limite réelle qui manque à leur analyse
- Une réaction humaine brute (surprise, humour léger) si le post s'y prête

## AUTO-PROMO

${selfRef
  ? "Autorisé ICI, UNE seule fois : une observation apprise sur le terrain (pas un pitch). Jamais \"mes clients\", jamais \"mon agence\", jamais de lien."
  : "INTERDIT. Aucune mention de Decupler, d'agence, de \"mes clients\", d'offre. Tu parles comme un pair qui partage."}

## LANGUE

Réponds dans la MÊME langue que le post (français si le post est en français, anglais si anglais, etc.). Ton naturel, registre parlé pro.
${params.instructions ? `\n## CONSIGNES SUPPLÉMENTAIRES\n${params.instructions}\n` : ''}${badRule}
## POST DE ${params.authorName}
"""
${params.postContent}
"""

## TEST FINAL (avant de répondre)
1. Est-ce que je reste sur le SUJET du post, sans le ramener au SEO/IA/business (sauf si le post EST là-dessus) ?
2. Ma phrase pourrait-elle être collée sous n'importe quel autre post ? (si oui → mauvaise, recommence)
3. Un vrai humain pourrait-il écrire ça en 45s sur son tel ?
4. Est-ce que ça ÉVITE de reformuler le post ?
5. Est-ce que j'APPORTE une valeur / un avis (pas juste "d'accord / pas d'accord") ?
6. Une seule idée, claire, en 2-3 phrases max ?
Si "non" à l'une : recommence.

## OUTPUT
Texte brut uniquement. Aucun markdown, aucun label, aucun guillemet. Juste le commentaire, prêt à poster.`

  const result = await model.generateContent(prompt)
  return result.response
    .text()
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

// Premier message après acceptation d'une invitation reçue. Voix soft "setting"
// de Nathan : minuscules, conditionnel, aucune vente, UNE question ouverte.
export async function generateWelcomeMessage(params: {
  name: string
  headline?: string | null
  invitationText?: string | null
  myBusinessContext: string
}): Promise<string> {
  const first = (params.name || '').split(' ')[0] || ''
  const prompt = `Tu es Nathan Fenina (Decupler — SEO organique & visibilité GEO/AI Search). Tu écris le PREMIER message LinkedIn juste après avoir accepté l'invitation de quelqu'un.

CONTEXTE BUSINESS: ${params.myBusinessContext}
PERSONNE: ${params.name}${params.headline ? ` — ${params.headline}` : ''}
${params.invitationText ? `NOTE D'INVITATION QU'ELLE A LAISSÉE: "${params.invitationText}"` : 'ELLE N\'A PAS LAISSÉ DE NOTE.'}

Règles (voix "setting" soft de Nathan) :
- minuscules, ton parlé décontracté, conditionnel. jamais de vente, jamais de pitch d'offre.
- commence par "hello ${first}," (ou "hello," si pas de prénom).
- remercie brièvement pour la connexion, chaleureux, court.
- termine par UNE seule question ouverte, facile à répondre, cadrée par "juste par curiosité" — sur ce qu'elle fait / son sujet du moment. si elle a laissé une note, rebondis dessus.
- 2 à 3 bulles très courtes séparées par des retours à la ligne. pas d'emoji en rafale (un max, style 😊 ou 👋).

Retourne UNIQUEMENT le texte du message (bulles séparées par des sauts de ligne), sans guillemets.`
  try {
    const result = await model.generateContent(prompt)
    return result.response.text().trim().replace(/^["']|["']$/g, '')
  } catch {
    return ''
  }
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
