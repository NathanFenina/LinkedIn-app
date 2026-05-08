# Cron — Automatiser la recherche de signaux

L'endpoint `/api/cron/signals` lance automatiquement :
1. Recherche LinkedIn pour chaque mot-clé actif (last 24h)
2. Qualification IA (vrai signal vs bruit)

## Configuration

Ajoute dans `.env.local` :
```
CRON_SECRET=un-secret-aleatoire-genere
```

## Option A — Vercel Cron (déploiement Vercel)

Crée `vercel.json` à la racine :
```json
{
  "crons": [{ "path": "/api/cron/signals", "schedule": "0 9 * * *" }]
}
```
Schedule cron = `0 9 * * *` → tous les jours à 9h.

Vercel passe automatiquement un header `Authorization` quand tu configures `CRON_SECRET` dans les env vars du projet.

## Option B — GitHub Actions (gratuit, sans déploiement)

Crée `.github/workflows/cron-signals.yml` :
```yaml
name: Cron Signals
on:
  schedule:
    - cron: '0 9 * * *'  # 9h UTC tous les jours
  workflow_dispatch:      # déclenchable manuellement
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Hit cron endpoint
        run: |
          curl -fsSL -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_URL }}/api/cron/signals"
```

Ajoute dans GitHub repo Settings → Secrets:
- `CRON_SECRET` : la même valeur que dans ton `.env.local`
- `APP_URL` : l'URL publique de ton app (ex: `https://ton-app.vercel.app`)

## Option C — Test manuel local

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/signals
```

Ça lance immédiatement le job et te renvoie `{ found, qualified, real, keywords }`.
