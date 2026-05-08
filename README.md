# LinkedIn CRM

CRM personnel pour LinkedIn : conversations, connexions, signaux d'achat, jobs, lead magnets sur commentaires, outreach concurrent. Tout passe par [Unipile](https://unipile.com) (LinkedIn API), [Supabase](https://supabase.com) (DB) et [Gemini](https://ai.google.dev) (scoring IA).

## Features

Voir l'onglet **How to work** dans l'app pour le guide complet. En résumé :

- **CRM** — Conversations, Connexions, Visiteurs (avec scoring IA + génération de réponses)
- **Outreach** — Signaux (mots-clés intent), Jobs (find decision-makers), Lead magnets (DM auto sur commentaires), Outreach concurrent (commentateurs d'un post → invitation ciblée)
- **Multi-comptes LinkedIn** — Branche plusieurs comptes Unipile, switch via le sélecteur en haut de la sidebar

## Setup

1. Copie `.env.example` → `.env.local`, remplis les valeurs.
2. Crée la DB Supabase et exécute `supabase-schema.sql` dans le SQL Editor.
3. `npm install`
4. `npm run dev` → http://localhost:3000
5. Ajoute ton premier compte LinkedIn via le sélecteur de la sidebar.

## Déploiement Vercel

### Repo GitHub privé + auto-deploy

1. `git remote add origin git@github.com:<toi>/linkedin-crm.git` puis `git push -u origin main`.
2. Sur https://vercel.com/new, importe le repo. Choisis le framework **Next.js** (auto-détecté).
3. Configure les env vars depuis `.env.example` dans Vercel → Project → Settings → Environment Variables.
4. Deploy.

### Quotas Vercel Hobby (gratuit)

L'app est conçue pour rester dans les limites du plan Hobby :

| Quota | Limite | Usage attendu |
|---|---|---|
| Bandwidth | 100 GB/mois | Très faible (UI interne, pas de trafic public) |
| Invocations | 1M/mois | OK sauf si tu lances 100 syncs/jour |
| Function duration | 10s par défaut, mais `maxDuration = 300` est utilisé sur les sync/cron | Configuré dans le code |
| Crons | **2 crons max** | Exactement 2 utilisés (`signals` à 9h UTC, `lead-magnets` à 10h UTC) |

**Précautions** :
- Ne lance pas le sync « Charger +500 conversations » plusieurs fois par jour : chaque batch de 50 = ~50 calls Unipile + ~50 inserts.
- Le scoring batch fait 1 call Gemini par conversation. Garde-le à la demande, pas en cron.
- Si tu ajoutes d'autres crons, le plan Hobby ne le permettra pas → passer en Pro ou utiliser GitHub Actions.

### Variables d'env Vercel

Toutes celles de `.env.example`, plus :

- `CRON_SECRET` — Vercel passe automatiquement `Authorization: Bearer ${CRON_SECRET}` sur les crons quand cette var est définie.

## Cron alternatif (sans Vercel)

Voir `CRON.md` — option GitHub Actions ou test manuel.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4
- Supabase (DB) · Unipile (LinkedIn) · Gemini 2.5 Flash (IA)

## Structure

```
app/
  api/             → Route handlers (sync, score, message, cron, accounts…)
  page.tsx         → Conversations
  connections/     → Annuaire des relations
  visitors/        → Visiteurs profil
  signals/         → Posts intent
  jobs/            → Offres + find contacts
  lead-magnets/    → Distribution auto sur commentaires
  competitor/      → Outreach commentateurs concurrents
  templates/       → Templates DM
  how-to-work/     → Guide d'usage
components/
  Sidebar.tsx      → Nav + AccountSwitcher
  AccountSwitcher  → Sélecteur de compte LinkedIn actif
lib/
  unipile.ts       → Client Unipile
  gemini.ts        → IA scoring + génération
  account.ts       → Résolution du compte LinkedIn actif (cookie/DB/env)
  supabase.ts      → Client DB
types/index.ts
supabase-schema.sql → Schéma complet (idempotent)
```
