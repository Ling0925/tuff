import { say } from '../data/words.js'

/**
 * The receiver's own key on a webhook, and a Claude Code routine —
 * `ui/WebhookKey.tsx`, the connect window and the webhooks list.
 */
export const WEBHOOK_KEY = say({
  head: ['Authorization header', 'En-tête Authorization'],
  hint: [
    'For a receiver that asks for its own key. Sent with every delivery and never shown again.',
    'Pour un destinataire qui demande sa propre clé. Envoyé avec chaque envoi et jamais réaffiché.',
  ],
  set: ['Set', 'Défini'],
  notSet: ['Not set', 'Non défini'],
  add: ['Add', 'Ajouter'],
  replace: ['Replace', 'Remplacer'],
  remove: ['Remove', 'Retirer'],
  save: ['Save', 'Enregistrer'],
  cancel: ['Cancel', 'Annuler'],
  placeholder: ['Bearer …', 'Bearer …'],
  bad: ['Use one line of plain text, up to 1 KB.', 'Utilisez une ligne de texte simple, 1 Ko au plus.'],
  couldnt: ['Couldn’t save the header. Try again.', 'Impossible d’enregistrer l’en-tête. Réessayez.'],
  /* A Claude Code routine. */
  routine: ['Claude Code routine', 'Routine Claude Code'],
  routineUrl: ['Routine URL', 'URL de la routine'],
  routineUrlHint: [
    'From the routine’s API trigger at claude.ai/code/routines.',
    'Depuis le déclencheur API de la routine sur claude.ai/code/routines.',
  ],
  routineRights: [
    'When you connect Tuff’s MCP connector for the routine, sign in as this agent. Then it works with this agent’s rights and projects. Signed in as you, it has all of yours.',
    'Quand vous connectez le connecteur MCP de Tuff pour la routine, connectez-vous en tant que cet agent. Elle travaille alors avec les droits et les projets de cet agent. Connectée en votre nom, elle a tous les vôtres.',
  ],
  routineToken: ['Routine token', 'Jeton de la routine'],
  routineTokenHint: [
    'Sent as Authorization. Up to 30 runs an hour; Tuff sends no more.',
    'Envoyé comme Authorization. 30 lancements par heure au plus ; Tuff n’en envoie pas davantage.',
  ],
  routineBadUrl: [
    'Use the routine’s URL: https://api.anthropic.com/v1/claude_code/routines/…/fire',
    'Utilisez l’URL de la routine : https://api.anthropic.com/v1/claude_code/routines/…/fire',
  ],
  routineLimit: ['Up to 30 runs an hour.', '30 lancements par heure au plus.'],
  routineMade: [
    'Copy the token now — it won’t be shown again. The routine reads and answers through Tuff’s MCP connector, or with this token.',
    'Copiez le jeton maintenant : il ne sera plus affiché. La routine lit et répond via le connecteur MCP de Tuff, ou avec ce jeton.',
  ],
})
