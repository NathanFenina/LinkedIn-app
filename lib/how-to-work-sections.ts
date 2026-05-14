import {
  MessageSquare,
  Users,
  Eye,
  Target,
  Briefcase,
  Magnet,
  UserPlus2,
  FileText,
  type LucideIcon,
} from 'lucide-react'

export interface HowToSection {
  icon: LucideIcon
  title: string
  goal: string
  steps: string[]
  tips?: string[]
}

export const HOW_TO_SECTIONS: Record<string, HowToSection> = {
  conversations: {
    icon: MessageSquare,
    title: 'Conversations',
    goal: "Voir toutes tes conversations LinkedIn dans un seul tableau, scorer par IA, filtrer par statut, et répondre / relancer.",
    steps: [
      'Synchronise tes chats avec « Charger +500 conversations ». Ça part par lots de 50 ; reste sur la page.',
      'Filtre via « À répondre » (le contact a écrit en dernier) ou « À relancer » (toi en dernier).',
      "Sélectionne une ou plusieurs conversations et clique « Scorer sélection » → l'IA score 1-10 et propose un statut.",
      "Clique sur une ligne pour voir l'historique complet et envoyer un message (génération IA dispo).",
    ],
    tips: [
      'Le score se met à jour à chaque re-scoring : il s\'enrichit au fur et à mesure de la conversation.',
      "Les statuts « Traité » et « Ne pas contacter » retirent la conversation des vues actives.",
    ],
  },
  connections: {
    icon: Users,
    title: 'Connexions',
    goal: "Tout l'annuaire de tes relations LinkedIn 1er degré, avec scoring IA basé sur le titre / poste.",
    steps: [
      'Sync depuis le bouton de la barre du haut.',
      "Score les profils en batch — l'IA évalue si chaque personne matche ton ICP business.",
    ],
  },
  visitors: {
    icon: Eye,
    title: 'Visiteurs',
    goal: 'Liste des personnes qui ont consulté ton profil. Cible chaude par définition.',
    steps: [
      'Sync depuis le bouton de la barre du haut.',
      'Marque comme « Contacté » au fur et à mesure des prises de contact.',
    ],
  },
  signals: {
    icon: Target,
    title: 'Signaux',
    goal: "Trouver des posts LinkedIn récents qui contiennent un mot-clé d'intention d'achat (ex: « cherche consultant SEO »), puis qualifier vrai signal vs bruit.",
    steps: [
      'Crée des mots-clés dans la liste « Mots-clés actifs ».',
      'Lance « Rechercher » : récupère les posts < 7 jours pour chaque mot-clé.',
      "Clique « Qualifier (IA) » : Gemini distingue intention réelle vs simple post sur le sujet.",
      'Sur les vrais signaux : commenter le post ou DM directement l\'auteur.',
    ],
    tips: [
      'Un cron quotidien tourne en auto et récupère + qualifie les nouveaux posts.',
      "Définit ton ICP dans la var d'env `SIGNAL_BUSINESS_CONTEXT` pour adapter la qualification.",
    ],
  },
  jobs: {
    icon: Briefcase,
    title: 'Jobs',
    goal: "Trouver des offres récentes liées à ton ICP, puis identifier les décideurs de la boîte qui recrute.",
    steps: [
      'Recherche par mot-clé (ex: « SEO Manager »).',
      "Sur une offre intéressante, clique « Trouver des contacts » → Unipile résout l'entreprise et cherche les décideurs (CMO / Founder / Head of…).",
      'Contacte directement depuis la liste de contacts trouvés.',
    ],
  },
  'lead-magnets': {
    icon: Magnet,
    title: 'Lead magnets',
    goal: "Distribuer une ressource (PDF, Notion, etc.) automatiquement aux personnes qui commentent un post avec un mot-clé donné.",
    steps: [
      'Crée une campagne : URL du post + mot-clé déclencheur + template du DM (avec {name} et {magnet_url}).',
      'Optionnel : seuil minimum de commentaires.',
      'Clique « Aperçu » (dry-run) pour voir qui sera ciblé sans envoyer.',
      'Clique « Envoyer » pour distribuer en réel.',
    ],
    tips: [
      "Anti-doublon : un commentateur n'est jamais relancé deux fois sur la même campagne.",
      'Si `auto_run` actif, le cron relance la campagne aux nouveaux commentateurs.',
      "Une auto N8N externe est aussi en place (voir l'onglet Automations).",
    ],
  },
  competitor: {
    icon: UserPlus2,
    title: 'Outreach concurrent',
    goal: 'Récupérer les commentateurs d\'un post concurrent, scorer, contacter.',
    steps: [
      'Crée un target : URL du post concurrent + label + mots-clés cible (CEO, Founder, SEO…).',
      'Clique « Récup commentaires » : tous les commentateurs stockés.',
      "Lance « Scorer IA en masse » : score 1-10 par lead.",
      "Filtre les leads (par score + recherche texte) et clique « → CRM » pour les pousser dans Conversations.",
      "Ou clique « Inviter (IA) » pour envoyer une invitation LinkedIn ciblée.",
    ],
    tips: [
      'Le scoring combine IA + critères déterministes (mots-clés du target).',
      'Le bouton « → CRM » importe le lead dans la table contacts avec son commentaire en notes.',
    ],
  },
  templates: {
    icon: FileText,
    title: 'Templates',
    goal: 'Bibliothèque de messages réutilisables.',
    steps: [
      'Crée des templates avec un nom + contenu.',
      "Dans le dialog d'envoi, sélectionne un template pour le pré-remplir, puis adapte.",
    ],
  },
}
