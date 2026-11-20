# The product's words, in English and French

One file a screen. Each key holds its English and its French on one line:

```ts
export const TASKS = say({
  noAssignee: ['No assignee', 'Sans responsable'],
  dueIn: [(n: number) => `Due in ${n} days`, (n: number) => `Échéance dans ${n} jours`],
})
```

The English is the product's own and is not changed here. The French is
read against it by us.

## The glossary

Taken from what Slack, Asana, Notion, Todoist, Trello, monday.com, Google,
Microsoft and Apple say in their French interfaces, so that nothing here
reads as a translation. One word for one thing, everywhere.

| English | French | Taken from |
| --- | --- | --- |
| Sign in / Sign out | Se connecter / Se déconnecter | Slack, Microsoft |
| Sign up / Create an account | S’inscrire / Créer un compte | Asana, Trello |
| Password · Forgot your password? | Mot de passe · Mot de passe oublié ? | Slack |
| Two-factor authentication | Authentification à deux facteurs | Slack |
| Verification code · code | Code de validation · code | Slack |
| Recovery codes | Codes de secours | Slack, Google, Notion |
| Passkey | Clé d’accès | Google, Apple |
| Account · Settings | Compte · Paramètres | Slack, Notion |
| Workspace | Espace de travail | Slack, Notion |
| Owner · Admin · Member · Guest · Client | Propriétaire · Administrateur · Membre · Invité · Client | Slack, Notion |
| People & Agents (the place) | Personnes et agents | Slack's People & user groups |
| People (a project's) | Personnes | — |
| Invite · Invitation | Inviter · Invitation | Asana |
| Project · Projects | Projet · Projets | all |
| My Tasks | Mes tâches | Asana |
| Task · Sub-task | Tâche · Sous-tâche | Asana, Todoist |
| Assignee · Assign · Unassigned | Responsable · Attribuer · Non attribuée | Asana, Todoist, Microsoft |
| Subscribe / Unsubscribe · Subscribed | Suivre / Ne plus suivre · Suivie | Slack, Asana |
| Mention · @everyone | Mention · @tous | Slack |
| List · Board · Column · Card | Liste · Tableau · Colonne · Carte | Trello |
| Label | Étiquette | Asana, Todoist |
| Priority | Priorité | Todoist |
| Due · Due date · Starts | Échéance · Date d’échéance · Début | Microsoft, Asana |
| Done · Finish · Reopen | Terminée · Terminer · Rouvrir | Microsoft, Notion |
| Overdue | En retard | — |
| Repeat · Doesn’t repeat · Every day · Every weekday · Every Friday | Répéter · Ne se répète pas · Tous les jours · Tous les jours ouvrés · Tous les vendredis | Google Calendar, Todoist |
| Sprint | Sprint | — |
| Archive / Unarchive · Restore | Archiver / Désarchiver · Restaurer | Notion, Gmail |
| Bin · Delete forever | Corbeille · Supprimer définitivement | Google Drive, Notion |
| Notifications · Mark all as read | Notifications · Tout marquer comme lu | Microsoft |
| Activity | Activité | Slack, Microsoft |
| Chat (the place, every room) | Discussions | — |
| Chat (a project's tab) | Discussion | — |
| Channel · Direct message | Canal (canaux) · Message direct | Slack |
| Thread · Reply · Replies | Fil de discussion · Répondre · Réponses | Slack, Microsoft |
| Pin / Unpin | Épingler / Désépingler | Slack |
| Message · Send | Message · Envoyer | Slack |
| Reaction · Comment | Réaction · Commentaire | Slack, Notion |
| Announcements · Announcement · Post (verb) | Annonces · Annonce · Publier | Microsoft |
| Files (the tab) · Docs · Images · Uploads · Links (its kinds) | Fichiers · Documents · Images · Importations · Liens | Google Drive, Slack |
| Recent · My documents · Shared with me | Récents · Mes documents · Partagés avec moi | Google Drive |
| Recently Deleted (a project's Files) · 30 days left | Suppressions récentes · Il reste 30 jours | Apple (Files, Photos, Notes) |
| Document · Folder · File · Link | Document · Dossier · Fichier · Lien | — |
| Upload | Importer (a button) · Ajouter un fichier | Slack |
| Download | Télécharger | — |
| Search | Rechercher | Todoist, Notion |
| Keyboard shortcuts | Raccourcis clavier | Todoist |
| Undo | Annuler (name the action where Cancel is beside it: *Annuler le déplacement*) | Slack, Gmail |
| Copy link | Copier le lien | Google, Todoist |
| Plan · Free plan · Upgrade | Forfait · Forfait gratuit · Passer à un forfait supérieur | Slack, Notion, monday.com |
| Billing · Seat | Facturation · Place | Notion |
| Token | Jeton | Asana |
| Agent · MCP server | Agent · Serveur MCP | Notion, monday.com |
| Offline | Hors ligne | Notion, Apple |
| Theme · Light · Dark · System | Thème · Clair · Sombre · Système | Apple |
| Time · Log time | Temps · Saisir du temps | — |
| Today · Tomorrow · Yesterday | Aujourd’hui · Demain · Hier | Todoist |
| Just now · 5m ago · 2h ago | À l’instant · Il y a 5 min · Il y a 2 h | CLDR |
| Load more · Show all | Afficher plus · Tout afficher | Slack, Notion |
| Cancel · Save · Close · Done · Continue · Back · Next | Annuler · Enregistrer · Fermer · Terminé · Continuer · Retour · Suivant | Slack, Google, Microsoft |
| Delete · Remove · Edit · Duplicate | Supprimer · Retirer · Modifier · Dupliquer | — |
| Leave (a project, a channel) | Quitter (*Quitter le projet*) | Slack, Asana |
| Try again | Réessayez. | Google, Microsoft |
| Version · Release notes · Security update | Version · Notes de version · Mise à jour de sécurité | Apple, Microsoft |
| Backup · Dismiss (a notice) | Sauvegarde · Ignorer | Apple, Microsoft |

## How it is written

- **Vous**, always.
- **Buttons are infinitives** — *Enregistrer*, *Ajouter une tâche*,
  *Marquer comme lu*. **Instructions are imperatives** — *Choisissez une
  conversation.*, *Saisissez le code.*
- **Sentence case**, as in English.
- **Empty states**: *Aucune tâche pour l’instant*, *Aucun message*.
- **Errors** say what happened and what to do, and end with a full stop:
  *Impossible d’enregistrer. Vérifiez votre connexion et réessayez.*
- **Agreement**: a task is feminine — *terminée*, *attribuée*, *suivie*;
  a project, a document, a message masculine.
- **Typography**: a narrow no-break space (U+202F, ` `) before `?`, `!`
  and `;`; a no-break space (U+00A0, ` `) before `:` and inside « »;
  the apostrophe `’`; the ellipsis `…`. Numbers and dates from `LOCALE`.
- **Counts**: `one(n)` from `data/words.ts` — French counts 0 and 1 as one.
- Product names and things people type are never translated: Tuff, Slack,
  Claude, ChatGPT, MCP, a task's title.
