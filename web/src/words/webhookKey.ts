import { say } from '../data/words.js'

/**
 * The receiver's own key on a webhook, and a Claude Code routine —
 * `ui/WebhookKey.tsx`, the connect window and the webhooks list.
 */
export const WEBHOOK_KEY = say({
  head: ['Authorization header', 'En-tête Authorization', 'Authorization 请求头'],
  hint: [
    'For a receiver that asks for its own key. Sent with every delivery and never shown again.',
    'Pour un destinataire qui demande sa propre clé. Envoyé avec chaque envoi et jamais réaffiché.',
    '用于需要自己密钥的接收方。每次投递都会发送，之后不再显示。',
  ],
  set: ['Set', 'Défini', '已设置'],
  notSet: ['Not set', 'Non défini', '未设置'],
  add: ['Add', 'Ajouter', '添加'],
  replace: ['Replace', 'Remplacer', '替换'],
  remove: ['Remove', 'Retirer', '移除'],
  save: ['Save', 'Enregistrer', '保存'],
  cancel: ['Cancel', 'Annuler', '取消'],
  placeholder: ['Bearer …', 'Bearer …', 'Bearer …'],
  bad: ['Use one line of plain text, up to 1 KB.', 'Utilisez une ligne de texte simple, 1 Ko au plus.', '请使用一行纯文本，最多 1 KB。'],
  couldnt: ['Couldn’t save the header. Try again.', 'Impossible d’enregistrer l’en-tête. Réessayez.', '无法保存请求头，请重试。'],
  /* A Claude Code routine. */
  routine: ['Claude Code routine', 'Routine Claude Code', 'Claude Code 例行任务'],
  routineUrl: ['Routine URL', 'URL de la routine', '例行任务 URL'],
  routineUrlHint: [
    'From the routine’s API trigger at claude.ai/code/routines.',
    'Depuis le déclencheur API de la routine sur claude.ai/code/routines.',
    '来自 claude.ai/code/routines 中该例行任务的 API 触发器。',
  ],
  routineRights: [
    'When you connect Tuff’s MCP connector for the routine, sign in as this agent. Then it works with this agent’s rights and projects. Signed in as you, it has all of yours.',
    'Quand vous connectez le connecteur MCP de Tuff pour la routine, connectez-vous en tant que cet agent. Elle travaille alors avec les droits et les projets de cet agent. Connectée en votre nom, elle a tous les vôtres.',
    '为例行任务连接 Tuff 的 MCP 连接器时，请以此代理身份登录。这样它会拥有该代理的权限和项目。若以你的身份登录，则拥有你的全部权限。',
  ],
  routineToken: ['Routine token', 'Jeton de la routine', '例行任务令牌'],
  routineTokenHint: [
    'Sent as Authorization. Up to 30 runs an hour; Tuff sends no more.',
    'Envoyé comme Authorization. 30 lancements par heure au plus ; Tuff n’en envoie pas davantage.',
    '作为 Authorization 发送。每小时最多 30 次运行；Tuff 不会发送更多。',
  ],
  routineBadUrl: [
    'Use the routine’s URL: https://api.anthropic.com/v1/claude_code/routines/…/fire',
    'Utilisez l’URL de la routine : https://api.anthropic.com/v1/claude_code/routines/…/fire',
    '请使用例行任务的 URL：https://api.anthropic.com/v1/claude_code/routines/…/fire',
  ],
  routineLimit: ['Up to 30 runs an hour.', '30 lancements par heure au plus.', '每小时最多 30 次运行。'],
  routineMade: [
    'Copy the token now — it won’t be shown again. The routine reads and answers through Tuff’s MCP connector, or with this token.',
    'Copiez le jeton maintenant : il ne sera plus affiché. La routine lit et répond via le connecteur MCP de Tuff, ou avec ce jeton.',
    '请立即复制令牌，之后将不再显示。例行任务通过 Tuff 的 MCP 连接器或此令牌读取和回复。',
  ],
})
