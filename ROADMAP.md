# Roadmap — LinkedIn CRM & automatisations (plan figé)

Suivi partagé. ✅ fait · 🔧 en cours · ⬜ à faire.

## Décisions cadres (validées)
- **Générer** commentaires / DM / réponses **à l'unité OU en bulk** ; **valider/éditer TOUJOURS à la main** avant envoi.
- **Deux écrans distincts** : un **CRM** (tableau clair de leads + statuts) ET une **Messagerie** (conversations).
- **« Marquer comme lu »** = sort juste de la to-do (local, aucune action LinkedIn).
- **Garde-fous LinkedIn = blocage dur** au plafond (rien ne part au-delà).
- **Caps** : démarrage conservateur + **montée douce**. Commentaires : jusqu'à **30/j**.
- **UX** : chaque écran montre *les actions à faire*, avec une petite explication. Style : skill **impeccable**.

## 🛡️ Limites LinkedIn à respecter (garde-fous, chantier G)
| Action | Limite sûre / jour | Valeur app (départ) |
|---|---|---|
| **Total actions / 24h** | ~150 tout confondu | **budget global 150 (blocage dur)** |
| DM / messages | ≤ 50 (démarrer 15-20) | **20/j** (montée douce) |
| Invitations envoyées | 60-100 / semaine | **15/j** |
| Acceptations d'invitations | — | **20/j** |
| Commentaires | 30-50 | **30/j** |
| Vues profil / fetch | < 250 (gratuit) | throttlé + délais aléatoires |
- Délais **aléatoires** entre chaque action (jamais de rafale). Unipile gère file/retry.
- Compteur **partagé par compte** (24h glissantes) ; au plafond → **blocage**.

---

## ✅ Livré
- **Commentaires auto** (`/comments`) — feed membres + posts précis, brouillons éditables, posting espacé, full-auto/revue, feedback 👍/👎, anti-doublon, suivi live. Fix : génère jusqu'au plafond (plus de 15 codé en dur).
- **Boîte « À répondre »** (`/inbox`) — deviendra **Messagerie**.
- **Invitations reçues** (`/invitations`) — accepter + message, unité/bulk.
- **Skills** : `setting-messages` (voix Nathan), `impeccable` (design). Connecteur **Supabase**.

---

## ⬜ Chantiers à attaquer (dans cet ordre)

### G. 🛡️ Garde-fous LinkedIn (FONDATION — d'abord)
Module de limites + compteur d'actions par compte + **blocage dur** au plafond + délais aléatoires. Câblé sur **tous** les envois (commentaires, DM, invitations, acceptations) et fetchs. Petit indicateur d'usage du jour dans l'UI.

### 1. Messagerie (`/messagerie`, refonte de l'inbox)
**Tableau** : colonnes *contact · dernier message reçu · message proposé (IA, éditable) · statut CRM · actions*. Filtres **important** / **non lus** / tous. Boutons **envoyer** (valide à l'unité ou en bulk) et **marquer comme lu** (local). Respecte les garde-fous DM.

### 2. CRM (tableau leads)
**Tableau clair** de tous les leads/contacts : nom, poste, statut (éditable), score, dernière activité. Filtres par statut, tri, recherche. Séparé de la messagerie.

### C. Outreach concurrent
Générer le message → **éditer → valider avant envoi** (unité + bulk). Respecte les garde-fous invitations/DM.

### D. Navigation claire + « actions à faire du jour »
Sidebar réorganisée en groupes nets. Écran d'accueil / bandeau **« à faire aujourd'hui »** (X à répondre, Y invitations, Z brouillons à valider). Petites explications par écran.

### E. Jobs (`/jobs`) — refonte UX
Mot-clé → trouve les offres → sort **le responsable à contacter** + **un message à valider**. Un écran clair, du clic au message prêt.

### F. Polish design global (impeccable)
Passe `impeccable` sur chaque écran + aides contextuelles + cohérence visuelle.

---

## Navigation cible
```
FAIRE AUJOURD'HUI   • Tableau de bord (à répondre / invitations / brouillons)
MESSAGES            • Messagerie (table + réponses IA)
CRM                 • Leads (tableau + statuts) • Connexions • Visiteurs • Invitations
OUTREACH            • Commentaires auto • Signaux • Jobs • Lead magnets • Outreach concurrent
CONFIG              • Garde-fous LinkedIn • Templates • Automations
```
