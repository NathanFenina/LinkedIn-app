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
} from 'lucide-react'

interface Section {
  icon: React.ComponentType<{ className?: string }>
  title: string
  goal: string
  steps: string[]
  tips?: string[]
}

const SECTIONS: Section[] = [
  {
    icon: MessageSquare,
    title: 'Conversations',
    goal: 'Voir toutes tes conversations LinkedIn dans un seul tableau, scorer par IA, filtrer par statut, et répondre / relancer.',
    steps: [
      'Synchronise tes chats avec « Charger +500 conversations » (boutons en haut). Ça part par lots de 50 ; reste sur la page.',
      'Filtre via « 🔵 À répondre » (le contact a écrit en dernier) ou « 🔄 À relancer » (toi en dernier).',
      'Sélectionne une ou plusieurs conversations et clique « Scorer sélection » → l\'IA Gemini score 1-10 et propose un statut.',
      'Clique sur une ligne pour voir l\'historique complet et envoyer un message (peut être généré par IA).',
    ],
    tips: [
      'Le score se met à jour à chaque re-scoring : il s\'enrichit au fur et à mesure de la conversation.',
      'Le statut « Traité » et « Ne pas contacter » retire la conversation des vues actives.',
    ],
  },
  {
    icon: Users,
    title: 'Connexions',
    goal: 'Tout l\'annuaire de tes relations LinkedIn 1er degré, avec scoring IA basé sur le titre / poste.',
    steps: [
      'Sync depuis le bouton de la barre du haut.',
      'Score les profils en batch — l\'IA évalue si chaque personne matche ton ICP business.',
    ],
  },
  {
    icon: Eye,
    title: 'Visiteurs',
    goal: 'Liste des personnes qui ont consulté ton profil. Cible chaude par définition.',
    steps: [
      'Sync depuis le bouton de la barre du haut.',
      'Marque comme « Contacté » au fur et à mesure des prises de contact.',
    ],
  },
  {
    icon: Target,
    title: 'Signaux',
    goal: 'Trouver des posts LinkedIn récents qui contiennent un mot-clé d\'intention d\'achat (ex: « cherche consultant SEO »), puis qualifier vrai signal vs bruit.',
    steps: [
      'Crée des mots-clés dans la liste « Mots-clés actifs ».',
      'Lance « Rechercher » : récupère les posts < 7 jours pour chaque mot-clé.',
      'Clique « Qualifier (IA) » : Gemini distingue intention réelle d\'achat vs simple post sur le sujet.',
      'Sur les vrais signaux : commenter le post ou DM directement l\'auteur.',
    ],
    tips: [
      'Un cron quotidien (configurable) tourne automatiquement et récupère + qualifie les nouveaux posts.',
      'Définit ton « business context » dans la variable d\'env SIGNAL_BUSINESS_CONTEXT pour adapter la qualification.',
    ],
  },
  {
    icon: Briefcase,
    title: 'Jobs',
    goal: 'Trouver des offres d\'emploi récentes liées à ton ICP, puis identifier les décideurs de la boîte qui recrute.',
    steps: [
      'Lance une recherche par mot-clé (ex: « SEO Manager »).',
      'Sur une offre intéressante, clique « Trouver des contacts » → Unipile résout l\'entreprise et cherche les décideurs (CMO / Founder / Head of...).',
      'Contacte directement depuis la liste de contacts trouvés.',
    ],
  },
  {
    icon: Magnet,
    title: 'Lead magnets',
    goal: 'Distribuer une ressource (PDF, Notion, etc.) automatiquement aux personnes qui commentent un post avec un mot-clé donné.',
    steps: [
      'Crée une campagne : URL du post + mot-clé déclencheur (ex: « +1 », « moi ») + template du DM (avec {name} et {magnet_url}).',
      'Optionnel : seuil minimum de commentaires (ne lance que si le post a >= N commentaires).',
      'Clique « Aperçu » (dry-run) pour voir qui sera ciblé sans envoyer.',
      'Clique « Envoyer » pour distribuer en réel.',
    ],
    tips: [
      'Anti-doublon : un commentateur n\'est jamais relancé deux fois sur la même campagne.',
      'Si tu actives `auto_run`, le cron lead-magnets relance automatiquement la campagne aux nouveaux commentateurs.',
    ],
  },
  {
    icon: UserPlus2,
    title: 'Outreach concurrent',
    goal: 'Récupérer les commentateurs d\'un post concurrent, les scorer, puis envoyer une invitation personnalisée.',
    steps: [
      'Crée un target : URL du post concurrent + label.',
      'Optionnel : précise des « job_title_keywords » (ex: CEO, Founder, CMO) et des « company_size_tags » (ex: SMB, mid-market) pour booster le scoring.',
      'Clique « Récupérer les commentaires » : tous les commentateurs sont stockés.',
      'Lance « Qualifier (IA) » : score 1-10 par lead. Critères : profil + commentaire + ton ICP (variable SIGNAL_BUSINESS_CONTEXT).',
      'Sur un lead qualifié (score >= 7), clique « Inviter » : message personnalisé généré par IA, ou écris le tien.',
    ],
    tips: [
      'Le scoring déterministe (mots-clés + tags) est combiné au scoring IA pour pousser les profils qui matchent ton ICP.',
    ],
  },
  {
    icon: FileText,
    title: 'Templates',
    goal: 'Bibliothèque de messages réutilisables, accessibles depuis le dialog de réponse.',
    steps: [
      'Crée des templates avec un nom + contenu.',
      'Dans le dialog d\'envoi, sélectionne un template pour le pré-remplir, puis adapte.',
    ],
  },
]

const ACCOUNT_SECTION = {
  icon: BookOpen,
  title: 'Comptes LinkedIn (multi-compte)',
  goal: 'Brancher plusieurs comptes LinkedIn (Unipile) et basculer entre eux.',
  steps: [
    'Dans la sidebar (en haut), clique sur le sélecteur de compte → « Ajouter un compte ».',
    'Renseigne un label (ex: « Pro », « Perso ») + l\'`account_id` Unipile du compte.',
    'Le compte par défaut est utilisé tant que tu ne sélectionnes pas un autre.',
    'Toutes les actions (sync, DM, signal, lead magnet, competitor) utilisent le compte actif.',
  ],
  tips: [
    'Pour brancher un 2ème compte LinkedIn dans Unipile : va dans ton dashboard Unipile, ajoute un nouveau provider LinkedIn, copie l\'account_id, puis colle-le ici.',
    'Le cron tourne sur **tous** les comptes (pas seulement l\'actif) pour ne rater aucun signal.',
  ],
}

export default function HowToWorkPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">How to work</h1>
        <p className="text-sm text-gray-600">
          Guide rapide de chaque feature de l&apos;application. Lis-le en entier la première fois,
          puis reviens ici pour les détails.
        </p>
      </header>

      <section className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
        <h2 className="font-semibold text-blue-900 mb-2 flex items-center gap-2 text-sm">
          <ACCOUNT_SECTION.icon className="w-4 h-4" />
          {ACCOUNT_SECTION.title}
        </h2>
        <p className="text-xs text-blue-900/80 mb-3">{ACCOUNT_SECTION.goal}</p>
        <ol className="list-decimal pl-5 space-y-1 text-xs text-blue-900/90 mb-3">
          {ACCOUNT_SECTION.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <ul className="list-disc pl-5 space-y-1 text-xs text-blue-900/70">
          {ACCOUNT_SECTION.tips?.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </section>

      <div className="space-y-6">
        {SECTIONS.map(({ icon: Icon, title, goal, steps, tips }) => (
          <section key={title} className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2 text-sm">
              <Icon className="w-4 h-4 text-blue-600" />
              {title}
            </h2>
            <p className="text-xs text-gray-600 mb-3">{goal}</p>

            <div className="text-[11px] font-bold uppercase text-gray-400 mb-1.5">
              Comment l&apos;utiliser
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-xs text-gray-700 mb-3">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>

            {tips && tips.length > 0 && (
              <>
                <div className="text-[11px] font-bold uppercase text-gray-400 mb-1.5">Astuces</div>
                <ul className="list-disc pl-5 space-y-1 text-xs text-gray-600">
                  {tips.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>

      <footer className="mt-8 pt-6 border-t border-gray-200 text-xs text-gray-500">
        <p className="mb-1">
          <strong>Variables d&apos;environnement clés</strong> (à mettre dans Vercel ou
          .env.local) :
        </p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>
            <code>UNIPILE_DSN</code>, <code>UNIPILE_API_KEY</code> — accès Unipile
          </li>
          <li>
            <code>LINKEDIN_ACCOUNT_ID</code> — fallback legacy (utilisé si la table
            linkedin_accounts est vide)
          </li>
          <li>
            <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code> — DB
          </li>
          <li>
            <code>GEMINI_API_KEY</code> — scoring & génération de messages
          </li>
          <li>
            <code>SIGNAL_BUSINESS_CONTEXT</code> — décrit ton ICP en langage naturel pour le
            scoring IA
          </li>
          <li>
            <code>CRON_SECRET</code> — protège les endpoints /api/cron/*
          </li>
        </ul>
      </footer>
    </div>
  )
}
