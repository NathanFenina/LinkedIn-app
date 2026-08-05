# Roadmap — LinkedIn CRM & automatisations

Suivi partagé de tout ce qu'on construit. ✅ fait · 🔧 en cours · ⬜ à faire.

## Principe transverse (validé)
- **Générer** commentaires / DM / réponses **à l'unité OU en bulk**.
- **Valider / éditer TOUJOURS à la main** avant envoi (rien ne part tout seul).
- **UX claire** : chaque écran dit *quelles actions sont à faire*, avec une petite explication.
- Style : skill **impeccable** appliqué (design cohérent, anti « tells » d'IA).

---

## ✅ Livré — Commentaires auto (`/comments`)
- Feed = membres LinkedIn (fusion de plusieurs recherches) **+** URLs de posts précis
- Génération des brouillons (unité ou batch), **éditables / passables**
- Posting **espacé 3–4 min**, plafond/jour, via **session GitHub Actions** (sans serveur)
- Mode **full auto** (génère+poste le matin) ou **revue manuelle**
- Anti-doublon garanti (base), **suivi en direct** des postés
- **Amélioration continue** : feedback 👍/👎 → les 👎 deviennent contre-exemples pour l'IA
- Prompt : reste sur le sujet, apporte un avis, pas de flatterie/jargon, gère les posts courts+image

## ✅ Livré — Boîte « À répondre » (`/inbox`)
- Liste les conversations où la personne a écrit en dernier
- L'IA **pré-rédige** une réponse par convo (unité ou batch), **éditable**
- **Envoi manuel** + **maj auto du statut CRM**

## ✅ Livré — Skills & outils
- Skill **`setting-messages`** (voix Nathan : invitation, like, commentaire, objection, RDV, relances, nurturing, partenaire)
- Skill **`impeccable`** installé (design)
- Connecteur **Supabase** branché (migrations gérées directement)

---

## 🔧 / ⬜ À construire (ordre proposé)

### B. ⬜ Onglet Invitations reçues (`/invitations`)
Lister les invitations reçues → **accepter** (unité ou bulk) → **envoyer un message** (généré, éditable, validé). Endpoints Unipile confirmés.

### C. ⬜ Génération + validation UNITÉ **ou** BULK partout
Pattern commun réutilisable : sélection multiple → générer pour tous → **revue en liste** → valider/envoyer à l'unité ou en bulk. À câbler sur : réponses inbox, invitations, outreach concurrent.

### D. ⬜ Navigation claire + « actions à faire »
Réorganiser la sidebar en onglets nets (voir ci-dessous) + un point d'entrée qui montre *ce qu'il y a à faire aujourd'hui*.

### E. ⬜ Jobs (`/jobs`) — refonte UX
Mot-clé → trouve les offres → sort **le responsable à contacter** + **un message à valider**. UX au top (1 écran, clair).

### F. ⬜ Polish design global (impeccable)
Passe `impeccable` sur chaque écran + petites explications/aides contextuelles.

---

## Navigation cible proposée
```
CRM
  • Conversations      (tableau)
  • À répondre         (inbox — réponses IA)   ✅
  • Invitations        (accepter + message)    ⬜ B
  • Connexions         (annuaire)
  • Visiteurs          (scoring + invite)
PIPELINE
  • CRM par statut     (tableau des statuts)
OUTREACH
  • Signaux · Jobs · Lead magnets · Commentaires auto · Outreach concurrent
CONFIG
  • Templates · Automations
```
