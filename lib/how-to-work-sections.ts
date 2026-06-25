import {
  MessageSquare,
  Users,
  Eye,
  Target,
  Briefcase,
  Magnet,
  UserPlus2,
  FileText,
  BookOpen,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react'

export interface HowToSection {
  icon: LucideIcon
  title: string
  goal: string
  steps: string[]
  tips?: string[]
}

// ──────────────────────────────────────────────────────────────────────────
// LA ROUTINE — ce qui doit sauter aux yeux. À lire en premier.
// ──────────────────────────────────────────────────────────────────────────

// L'idée directrice de tout l'outil, en une phrase.
export const GOLDEN_RULE =
  "Tu ne parles PAS à tout le monde. L'IA note chaque conversation à ta place ; tu ne traites que ce qui remonte dans la Boîte priorisée. Le reste attend qu'une personne réponde."

// À faire une seule fois, au tout début (ou quand on branche un nouveau compte).
export const FIRST_TIME_STEPS: string[] = [
  "Branche ton compte LinkedIn : barre de gauche, en haut, sélecteur de compte → « Ajouter un compte ».",
  "Va dans « Conversations » et clique « Charger +500 conversations ». Laisse tourner (ça avance par paquets de 50), reste sur la page.",
  "Clique « Scorer non scorées » : l'IA lit chaque conversation et lui donne une note sur 10. Laisse tourner 5 à 10 min.",
]

// À faire chaque jour. 5-10 minutes.
export const DAILY_STEPS: string[] = [
  "Ouvre « Conversations » : tu arrives direct sur la Boîte priorisée 📥 — tes leads les plus chauds (note ≥ 6, message récent).",
  "Traite-les un par un : clique pour lire le fil, réponds ou relance, puis choisis un statut (En cours / Chaud / archive).",
  "Clique « Sync rapide » pour récupérer tes nouveaux messages : ils sont notés automatiquement et les chauds remontent tout seuls.",
]

// À faire ~1×/semaine pour alimenter le haut du tunnel.
export const WEEKLY_STEPS: string[] = [
  "Publie un post LinkedIn avec un Lead magnet (onglet « Lead magnets ») : les gens commentent et reçoivent ta ressource en DM automatiquement.",
  "C'est la bonne façon de faire venir des prospects chauds — LinkedIn n'aime plus le démarchage à froid, qui peut faire restreindre ton compte.",
]

// Explication du score, écrite pour quelqu'un qui découvre l'outil.
export const SCORING_FAQ: { q: string; a: string }[] = [
  {
    q: "C'est quoi le score ?",
    a: "Une note de 1 à 10 que l'IA donne à chaque conversation. 8-10 = très chaud (la personne est intéressée, pose des questions). 1-3 = froid / pas de réponse.",
  },
  {
    q: "Je dois scorer quoi, et quand ?",
    a: "Une seule fois au début, clique « Scorer non scorées » : ça note d'un coup toutes celles qui n'ont pas encore de note. Ce n'est pas à refaire en boucle.",
  },
  {
    q: "Et les nouvelles conversations ?",
    a: "Quand tu fais « Sync rapide », les nouveaux messages sont notés automatiquement. Tu n'as rien à faire de plus.",
  },
  {
    q: "Je peux re-scorer une conversation ?",
    a: "Oui, c'est optionnel. Si une conversation a évolué, clique le bouton « IA » sur sa ligne : la note se met à jour. Sinon, laisse — l'ancienne note reste valable.",
  },
  {
    q: "Pourquoi ma Boîte priorisée est vide ?",
    a: "Parce que rien n'est encore noté, ou rien n'atteint le seuil chaud. Clique « Scorer non scorées » : les leads chauds vont apparaître. Sinon, vue « Tous » pour tout voir.",
  },
]

// Les 3 statuts (+ archive), en clair.
export const STATUS_GUIDE: { emoji: string; label: string; meaning: string }[] = [
  { emoji: '📥', label: 'À traiter', meaning: "Lead chaud, tu n'as pas encore agi dessus." },
  { emoji: '💬', label: 'En cours', meaning: 'Vous échangez activement.' },
  { emoji: '🔥', label: 'Chaud', meaning: 'Très intéressé — à pousser vers un RDV / une vente.' },
  { emoji: '✅', label: 'Client (archive)', meaning: 'A signé / est déjà client.' },
  { emoji: '✔', label: 'Traité (archive)', meaning: 'Réglé, plus rien à faire.' },
  { emoji: '🚫', label: 'Ne pas contacter (archive)', meaning: "Refus clair, on le laisse tranquille." },
]

// ──────────────────────────────────────────────────────────────────────────
// COMPTES (multi-compte)
// ──────────────────────────────────────────────────────────────────────────

export const ACCOUNT_SECTION: HowToSection = {
  icon: BookOpen,
  title: 'Comptes LinkedIn (multi-compte)',
  goal: 'Brancher plusieurs comptes LinkedIn et basculer entre eux. Chaque compte a ses propres conversations et données.',
  steps: [
    'Dans la barre de gauche (en haut), clique le sélecteur de compte → « Ajouter un compte ».',
    'Donne un nom au compte (ex: « Nathan », « Lucas ») + son identifiant Unipile (account_id).',
    'Bascule d\'un compte à l\'autre avec le même sélecteur. Tout ce que tu vois (conversations, leads…) appartient au compte actif.',
  ],
  tips: [
    "Pour récupérer l'account_id : dashboard Unipile → ajoute un provider LinkedIn → copie l'account_id.",
    'Astuce sécurité : garde ton compte principal (réseau établi) pour les échanges, et utilise un compte « satellite » pour les tests d\'outreach plus risqués.',
  ],
}

// ──────────────────────────────────────────────────────────────────────────
// DÉTAIL PAR ONGLET
// ──────────────────────────────────────────────────────────────────────────

export const HOW_TO_SECTIONS: Record<string, HowToSection> = {
  conversations: {
    icon: MessageSquare,
    title: 'Conversations',
    goal: "Ton centre de pilotage. L'IA note tes conversations et fait remonter les leads chauds dans la Boîte priorisée — tu te concentres sur eux au lieu de scroller 500 messages.",
    steps: [
      'À l\'ouverture, tu es sur la Boîte priorisée 📥 : les conversations chaudes (note ≥ 6) et récentes. C\'est ta liste du jour.',
      "Si elle est vide : clique « Scorer non scorées » et attends quelques minutes que l'IA note tout.",
      "Clique une conversation pour lire le fil complet et répondre / relancer (un message peut être proposé par l'IA).",
      'Après ton échange, range la personne avec son statut : À traiter → En cours → Chaud, ou archive (Client / Traité / Ne pas contacter).',
      "Vue « 📊 Pipeline » : tes conversations en colonnes par statut (façon tableau Kanban), pour voir ton pipeline d'un coup d'œil.",
    ],
    tips: [
      'Les 3 statuts (+ archive) suffisent : ne te perds pas à tout classer. Ne classe quelqu\'un qu\'après lui avoir parlé.',
      '« Sync rapide » = récupère les derniers chats ET note les nouveaux automatiquement. À faire chaque jour.',
      '« Charger +500 conversations » = gros import, à faire au début seulement (ça consomme des appels Unipile).',
      'La recherche (en haut) filtre par nom et par poste, dans toutes les vues.',
    ],
  },
  connections: {
    icon: Users,
    title: 'Connexions',
    goal: "L'annuaire de tes relations LinkedIn (1er degré). Utile pour retrouver quelqu'un et repérer les profils qui collent à ta cible.",
    steps: [
      'Synchronise depuis le bouton en haut à droite.',
      "Clique « Scorer » : l'IA évalue, à partir du poste/titre, qui ressemble à un bon prospect pour toi.",
      'Filtre par statut ou cherche par nom / poste, puis envoie un message à ceux qui valent le coup.',
    ],
  },
  visitors: {
    icon: Eye,
    title: 'Visiteurs',
    goal: 'Les personnes qui ont consulté ton profil. Par définition, des gens déjà curieux de toi — donc chauds.',
    steps: [
      'Synchronise depuis le bouton en haut à droite.',
      "L'IA note chaque visiteur selon son profil ; les meilleurs apparaissent en premier.",
      'Invite / contacte les plus pertinents, puis marque « Contacté » pour ne pas les relancer deux fois.',
    ],
  },
  signals: {
    icon: Target,
    title: 'Signaux',
    goal: "Trouver des posts LinkedIn récents où quelqu'un exprime un besoin d'achat (ex: « je cherche un consultant SEO »).",
    steps: [
      'Ajoute des mots-clés dans « Mots-clés actifs » (ex: « consultant SEO », « cherche freelance »).',
      'Clique « Rechercher » : récupère les posts récents contenant ces mots.',
      "Clique « Qualifier (IA) » : l'IA garde les vraies intentions d'achat et écarte le bruit (posts conseils, etc.).",
      "Sur un vrai signal : commente le post ou écris directement à l'auteur.",
    ],
    tips: [
      'Un robot quotidien tourne tout seul et qualifie les nouveaux posts.',
    ],
  },
  jobs: {
    icon: Briefcase,
    title: 'Jobs',
    goal: "Repérer des entreprises qui recrutent sur ta thématique, puis trouver les décideurs à contacter chez elles.",
    steps: [
      'Recherche par mot-clé (ex: « SEO Manager »).',
      "Sur une offre intéressante, clique « Trouver des contacts » : l'outil identifie les décideurs de la boîte (CMO, Founder, Head of…).",
      'Contacte-les directement depuis la liste.',
    ],
  },
  'lead-magnets': {
    icon: Magnet,
    title: 'Lead magnets',
    goal: "Envoyer automatiquement une ressource (PDF, lien Notion…) à tous ceux qui commentent ton post avec un mot-clé. La meilleure façon d'attirer des prospects chauds sans démarchage à froid.",
    steps: [
      'Crée une campagne : lien du post + mot-clé déclencheur (ex: « +1 », « moi ») + le message à envoyer (utilise {name} et {magnet_url}).',
      'Optionnel : un nombre minimum de commentaires avant de lancer.',
      'Clique « Aperçu » pour voir qui sera contacté, SANS rien envoyer.',
      'Clique « Envoyer » quand tu es sûr.',
    ],
    tips: [
      "Personne n'est jamais contacté deux fois sur la même campagne.",
      'Active « auto_run » pour que la campagne relance toute seule les nouveaux commentateurs.',
    ],
  },
  'auto-comments': {
    icon: MessageCircle,
    title: 'Auto-comment IA',
    goal: "Commenter automatiquement les posts d'un feed/recherche LinkedIn, dans ta persona, sans jamais re-commenter deux fois le même post. Reprise de l'automatisation n8n « Auto Comments ».",
    steps: [
      "Renseigne d'abord la « Persona du compte actif » (nom + identité/expertise + marque) : c'est elle qui écrit les commentaires.",
      'Crée un job avec une URL de feed ou de recherche LinkedIn (ex: /search/results/content/…).',
      'Clique « Simuler » : l\'IA génère les commentaires SANS rien poster, pour que tu vérifies le ton.',
      'Clique « Lancer » quand tu es sûr : l\'app like + commente, et logge chaque post dans l\'historique.',
    ],
    tips: [
      'Un post déjà commenté sur ce compte ne sera jamais re-commenté (dédup par compte).',
      'Chaque compte LinkedIn a sa propre persona et son propre historique.',
      'Active « auto-run » pour laisser le cron quotidien traiter le job tout seul. Garde un max de posts/run raisonnable pour rester sous le radar.',
    ],
  },
  competitor: {
    icon: UserPlus2,
    title: 'Outreach concurrent',
    goal: "Récupérer les gens qui ont commenté un post (souvent d'un concurrent), les noter, et soit les ajouter à ton CRM, soit les inviter.",
    steps: [
      'Crée une cible : lien du post + un nom + tes mots-clés idéaux (CEO, Founder, SEO…).',
      'Clique « Récup commentaires » : tous les commentateurs sont récupérés.',
      "Clique « Scorer IA en masse » : chaque personne reçoit une note de 1 à 10.",
      'Trie par score, puis « → CRM » pour l\'ajouter à tes Conversations, OU « Inviter (IA) » pour une invitation personnalisée.',
    ],
    tips: [
      "Vérifie bien que tu es sur le bon compte LinkedIn (sélecteur en haut à gauche) avant de lancer.",
      '« → CRM » ajoute la personne dans Conversations avec son commentaire en note.',
    ],
  },
  templates: {
    icon: FileText,
    title: 'Templates',
    goal: 'Tes messages tout prêts, réutilisables en un clic au moment de répondre.',
    steps: [
      'Crée un template : un nom + le texte.',
      "Au moment d'envoyer un message, choisis un template pour pré-remplir, puis adapte avant d'envoyer.",
    ],
  },
}
