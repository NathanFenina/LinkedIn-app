import { ExternalLink, Zap, FileSpreadsheet, MessageCircle, Magnet } from 'lucide-react'

interface Automation {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  status: 'live' | 'draft'
  description: string
  why: string
  links: { label: string; url: string; icon?: React.ComponentType<{ className?: string }> }[]
  tips?: string[]
}

const AUTOMATIONS: Automation[] = [
  {
    id: 'lead-magnet-n8n',
    title: 'Distribution lead magnet (N8N)',
    icon: Magnet,
    status: 'live',
    description:
      "Workflow N8N qui distribue automatiquement une ressource (lead magnet) suite à un formulaire. Les envois sont loggés dans une Google Sheet.",
    why: "Quand l'app interne n'est pas le bon canal (ex: demande hors LinkedIn, distribution suite à inscription web), N8N prend le relais.",
    links: [
      {
        label: 'Lancer le formulaire (prod)',
        url: 'https://n8n.decupler.com/form/c6d17172-0c62-40ae-a7c5-20f461ccc071',
        icon: Zap,
      },
      {
        label: 'Tracking Google Sheets',
        url: 'https://docs.google.com/spreadsheets/d/1lwSc1Dom3EDpnb2Z9k4SyhKmyVRAR6CMBdYk5LX2OcQ/edit?gid=1055237727#gid=1055237727',
        icon: FileSpreadsheet,
      },
      {
        label: 'Éditeur du workflow N8N',
        url: 'https://n8n.decupler.com/workflow/6k22tVKiTf83k0OQ',
      },
    ],
  },
  {
    id: 'linkedin-comments-n8n',
    title: 'Commentaires LinkedIn par IA (N8N)',
    icon: MessageCircle,
    status: 'live',
    description:
      "Tu colles l'URL d'un (ou plusieurs) post LinkedIn dans le formulaire et l'IA génère + poste un commentaire. Deux ressorts disponibles : humour ou valeur.",
    why: "Outil de secours quand tu n'as pas le temps de commenter à la main. Le commentaire manuel reste préférable, mais ça vaut mieux que de zapper un post à haut reach.",
    links: [
      {
        label: 'Lancer le formulaire',
        url: 'https://n8n.decupler.com/form/76e77597-ce07-4878-9e96-84c2eb2aca88',
        icon: Zap,
      },
      {
        label: 'Éditeur du workflow N8N',
        url: 'https://n8n.decupler.com/workflow/1DQ7AvwZ4AQWKdQV',
      },
    ],
    tips: [
      "Cibler en priorité : posts SEO + posts lead magnet avec haut reach (> 50 commentaires, > 500 reactions).",
      'Mix recommandé : 70% humour pour la visibilité, 30% valeur pour la crédibilité.',
      "Ne pas spammer : 3-5 commentaires/jour max pour rester sous le radar LinkedIn.",
    ],
  },
]

export default function AutomationsPage() {
  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3">
          <h1 className="font-semibold text-gray-900 text-base leading-tight">
            Automations externes
          </h1>
          <p className="text-xs text-gray-500">
            Workflows N8N et outils tiers qui complètent l&apos;app. Liens rapides pour les
            lancer / consulter le tracking / éditer la logique.
          </p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        {AUTOMATIONS.map(({ id, title, icon: Icon, status, description, why, links, tips }) => (
          <section
            key={id}
            className="bg-white border border-gray-200 rounded-lg p-5"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
                  <p className="text-xs text-gray-600 mt-0.5">{description}</p>
                </div>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                  status === 'live'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}
              >
                {status === 'live' ? 'Live' : 'Draft'}
              </span>
            </div>

            <p className="text-[11px] text-gray-500 italic mb-3 pl-11">{why}</p>

            <div className="pl-11 space-y-1.5">
              <div className="text-[10px] font-bold uppercase text-gray-400 mb-1">
                Liens
              </div>
              <div className="flex flex-wrap gap-2">
                {links.map(({ label, url, icon: LinkIconComp }) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 hover:border-blue-300 rounded transition-colors"
                  >
                    {LinkIconComp && <LinkIconComp className="w-3 h-3" />}
                    <span>{label}</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                  </a>
                ))}
              </div>

              {tips && tips.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] font-bold uppercase text-gray-400 mb-1">
                    Astuces
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-gray-600">
                    {tips.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        ))}

        <div className="text-[11px] text-gray-400 text-center py-2">
          Pour ajouter une nouvelle automation ici, édite{' '}
          <code className="bg-gray-100 px-1 rounded">app/automations/page.tsx</code> → tableau{' '}
          <code className="bg-gray-100 px-1 rounded">AUTOMATIONS</code>.
        </div>
      </div>
    </>
  )
}
