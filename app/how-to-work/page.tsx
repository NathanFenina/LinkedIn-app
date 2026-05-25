import { Rocket, CalendarCheck, CalendarRange, Star, HelpCircle, ListChecks } from 'lucide-react'
import {
  HOW_TO_SECTIONS,
  ACCOUNT_SECTION,
  GOLDEN_RULE,
  FIRST_TIME_STEPS,
  DAILY_STEPS,
  WEEKLY_STEPS,
  SCORING_FAQ,
  STATUS_GUIDE,
} from '@/lib/how-to-work-sections'

function RoutineCard({
  icon: Icon,
  badge,
  title,
  subtitle,
  steps,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  badge: string
  title: string
  subtitle: string
  steps: string[]
  accent: string
}) {
  return (
    <div className={`rounded-xl border p-4 ${accent}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">{badge}</span>
      </div>
      <h3 className="font-bold text-base mb-0.5">{title}</h3>
      <p className="text-xs opacity-70 mb-3">{subtitle}</p>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-sm">
            <span className="shrink-0 w-5 h-5 rounded-full bg-white/70 text-current font-bold text-xs flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <span className="leading-snug">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function HowToWorkPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Comment utiliser l&apos;app</h1>
        <p className="text-sm text-gray-600">
          Guide complet. Si tu débutes, lis simplement « Par où commencer » ci-dessous : c&apos;est
          tout ce dont tu as besoin pour démarrer.
        </p>
      </header>

      {/* ── RÈGLE D'OR ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-gray-900 text-white p-4 mb-6 flex gap-3 items-start">
        <Star className="w-5 h-5 shrink-0 mt-0.5 text-yellow-400" />
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-yellow-400 mb-0.5">
            La règle d&apos;or
          </div>
          <p className="text-sm leading-snug">{GOLDEN_RULE}</p>
        </div>
      </div>

      {/* ── PAR OÙ COMMENCER ───────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-3">
          <Rocket className="w-5 h-5 text-blue-600" />
          Par où commencer
        </h2>
        <div className="space-y-3">
          <RoutineCard
            icon={ListChecks}
            badge="Une seule fois — installation"
            title="Première fois"
            subtitle="À faire au tout début, ou quand tu branches un nouveau compte."
            steps={FIRST_TIME_STEPS}
            accent="bg-violet-50 border-violet-200 text-violet-900"
          />
          <RoutineCard
            icon={CalendarCheck}
            badge="Chaque jour — 5 à 10 min"
            title="Ta routine quotidienne"
            subtitle="C'est le cœur de l'outil. Si tu ne fais que ça, c'est déjà très bien."
            steps={DAILY_STEPS}
            accent="bg-emerald-50 border-emerald-200 text-emerald-900"
          />
          <RoutineCard
            icon={CalendarRange}
            badge="~1× par semaine — alimenter"
            title="Pour faire venir de nouveaux prospects"
            subtitle="Attirer des gens chauds plutôt que démarcher à froid."
            steps={WEEKLY_STEPS}
            accent="bg-blue-50 border-blue-200 text-blue-900"
          />
        </div>
      </section>

      {/* ── COMPRENDRE LE SCORE ────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-3">
          <HelpCircle className="w-5 h-5 text-blue-600" />
          Comprendre le score (important)
        </h2>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {SCORING_FAQ.map(({ q, a }, i) => (
            <div key={i} className="p-3.5">
              <p className="text-sm font-semibold text-gray-900 mb-0.5">{q}</p>
              <p className="text-sm text-gray-600 leading-snug">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── LES STATUTS ────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Les statuts, en clair</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-4 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
          {STATUS_GUIDE.map(({ emoji, label, meaning }) => (
            <div key={label} className="flex gap-2.5 text-sm">
              <span className="shrink-0">{emoji}</span>
              <span>
                <span className="font-semibold text-gray-900">{label}</span>
                <span className="text-gray-600"> — {meaning}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── COMPTES ────────────────────────────────────────────── */}
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

      {/* ── DÉTAIL PAR ONGLET ──────────────────────────────────── */}
      <h2 className="text-lg font-bold text-gray-900 mb-3">Chaque onglet en détail</h2>
      <div className="space-y-4">
        {Object.entries(HOW_TO_SECTIONS).map(([key, { icon: Icon, title, goal, steps, tips }]) => (
          <section key={key} className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2 text-sm">
              <Icon className="w-4 h-4 text-blue-600" />
              {title}
            </h3>
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

      <footer className="mt-8 pt-6 border-t border-gray-200 text-xs text-gray-400">
        <p>
          Réglages techniques (clés API, etc.) : voir le fichier <code>.env.example</code> et le{' '}
          <code>README.md</code> du projet.
        </p>
      </footer>
    </div>
  )
}
