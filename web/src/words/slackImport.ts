import { one, say } from '../data/words.js'

/**
 * Bringing a room's history from Slack — `ui/SlackImport.tsx`. The help
 * names Slack's own buttons, so its French is what Slack says in French.
 */
export const SLACK_IMPORT = say({
  noChannels: ['There are no channels in that export.', 'Cette exportation ne contient aucun canal.', '该导出中没有频道。'],
  notAnExport: [
    'Couldn’t read this file as a Slack export. Use the .zip from Import & export data in Slack.',
    'Impossible de lire ce fichier comme une exportation Slack. Utilisez le .zip obtenu depuis Importer/Exporter des données dans Slack.',
    '无法将此文件读取为 Slack 导出。请使用 Slack 中「导入与导出数据」生成的 .zip。',
  ],
  stopped: [
    'The import stopped partway. Messages that arrived are kept, but the rest can’t be added here.',
    'L’importation s’est arrêtée en cours de route. Les messages arrivés sont conservés, mais le reste ne peut pas être ajouté ici.',
    '导入中途停止。已到达的消息会保留，但其余内容无法在此添加。',
  ],
  /** Written into a message whose file Slack would not give. */
  attachedInSlack: [
    (name: string) => `Attached in Slack: ${name}`,
    (name: string) => `Joint dans Slack : ${name}`,
    (name: string) => `在 Slack 中附加：${name}`,
  ],
  importFromSlack: ['Import from Slack', 'Importer depuis Slack', '从 Slack 导入'],
  howTo: ['How to export from Slack', 'Comment exporter depuis Slack', '如何从 Slack 导出'],
  progress: [
    (done: number, of: number, what: 'files' | 'messages') => `${done} of ${of} ${what}`,
    (done: number, of: number, what: 'files' | 'messages') =>
      `${done} sur ${of} ${what === 'files' ? (one(of) ? 'fichier' : 'fichiers') : one(of) ? 'message' : 'messages'}`,
    (done: number, of: number, what: 'files' | 'messages') => `已完成 ${done}/${of} ${what === 'files' ? '个文件' : '条消息'}`,
  ],
  brings: [
    'Imports threads, names, times and files.',
    'Importe les fils de discussion, les noms, les heures et les fichiers.',
    '导入话题、成员姓名、时间和文件。',
  ],
  import: ['Import', 'Importer', '导入'],
  days: [(n: number) => (n === 1 ? '1 day' : `${n} days`), (n: number) => (one(n) ? `${n} jour` : `${n} jours`), (n: number) => `${n} 天`],
  gotIt: ['Got it', 'Compris', '知道了'],
  freePlan: [
    'A standard export includes public channels only. Private channels and direct messages need a paid Slack plan and Slack’s approval to export all conversations. On Slack’s free plan, the export covers the last 90 days of messages and files.',
    'Une exportation standard ne comprend que les canaux publics. Les canaux privés et les messages directs nécessitent un forfait Slack payant et l’accord de Slack pour exporter toutes les conversations. Avec le forfait gratuit de Slack, l’exportation couvre les 90 derniers jours de messages et de fichiers.',
    '标准导出仅包含公开频道。私有频道和私信需要付费 Slack 套餐并获得 Slack 批准才能导出所有对话。在 Slack 免费版中，导出覆盖最近 90 天的消息和文件。',
  ],

  /* The steps, and Slack's screens as they are drawn in them. */
  step1: ['Open workspace settings', 'Ouvrez les paramètres de l’espace de travail', '打开工作区设置'],
  step1Said: [
    'In Slack on a computer, click Admin in the sidebar, then Workspace settings. Only owners and admins of the Slack workspace can do this.',
    'Dans Slack sur un ordinateur, cliquez sur Admin dans la barre latérale, puis sur Paramètres de l’espace de travail. Seuls les propriétaires et les administrateurs de l’espace de travail Slack peuvent le faire.',
    '在电脑版 Slack 中，点击侧边栏的「管理」，然后点击「工作区设置」。只有 Slack 工作区的所有者和管理员可以操作。',
  ],
  home: ['Home', 'Accueil', '首页'],
  dms: ['DMs', 'Messages', '私信'],
  admin: ['Admin', 'Admin', '管理'],
  manageMembers: ['Manage members', 'Gérer les membres', '管理成员'],
  workspaceSettings: ['Workspace settings', 'Paramètres de l’espace de travail', '工作区设置'],
  billing: ['Billing', 'Facturation', '账单'],
  step2: ['Security → Import & export data', 'Sécurité → Importer/Exporter des données', '安全 → 导入与导出数据'],
  step2Said: [
    'Workspace settings opens in your browser. Open the Security tab and click Import & export data.',
    'Les paramètres de l’espace de travail s’ouvrent dans votre navigateur. Ouvrez l’onglet Sécurité et cliquez sur Importer/Exporter des données.',
    '工作区设置会在浏览器中打开。打开「安全」标签页，点击「导入与导出数据」。',
  ],
  settings: ['Settings', 'Paramètres', '设置'],
  security: ['Security', 'Sécurité', '安全'],
  permissions: ['Permissions', 'Autorisations', '权限'],
  authentication: ['Authentication', 'Authentification', '身份验证'],
  importExport: ['Import & export data', 'Importer/Exporter des données', '导入与导出数据'],
  step3: [
    'Choose dates and click Start Export',
    'Choisissez les dates et cliquez sur Démarrer l’exportation',
    '选择日期并点击「开始导出」',
  ],
  step3Said: [
    'On the Export tab, choose a date range or keep Entire history, then click Start Export. Slack creates the file in the background.',
    'Dans l’onglet Exporter, choisissez une plage de dates ou gardez Tout l’historique, puis cliquez sur Démarrer l’exportation. Slack crée le fichier en arrière-plan.',
    '在「导出」标签页选择日期范围或保留「全部历史」，然后点击「开始导出」。Slack 会在后台创建文件。',
  ],
  export: ['Export', 'Exporter', '导出'],
  dateRange: ['Export date range: Entire history ▾', 'Plage de dates d’exportation : Tout l’historique ▾', '导出日期范围：全部历史 ▾'],
  startExport: ['Start Export', 'Démarrer l’exportation', '开始导出'],
  step4: ['Download the .zip', 'Téléchargez le .zip', '下载 .zip'],
  step4Said: [
    'Slack emails you when it’s ready. Open the link in the email and click Ready for download to save the .zip.',
    'Slack vous envoie un e-mail quand il est prêt. Ouvrez le lien de l’e-mail et cliquez sur Prêt pour le téléchargement pour enregistrer le .zip.',
    '文件准备好后 Slack 会发邮件通知。打开邮件中的链接并点击「可下载」保存 .zip。',
  ],
  exportReady: ['✉ Your Slack export is ready', '✉ Votre exportation Slack est prête', '✉ 你的 Slack 导出已就绪'],
  workspaceExport: ['Workspace export · .zip', 'Exportation de l’espace de travail · .zip', '工作区导出 · .zip'],
  readyForDownload: ['Ready for download', 'Prêt pour le téléchargement', '可下载'],
  step5: ['Import it here', 'Importez-le ici', '在这里导入'],
  step5Said: [
    'Back here, click Import from Slack, choose the .zip, select the channel and click Import.',
    'De retour ici, cliquez sur Importer depuis Slack, choisissez le .zip, sélectionnez le canal et cliquez sur Importer.',
    '回到这里，点击「从 Slack 导入」，选择 .zip，选择频道并点击「导入」。',
  ],
  exampleChannel: ['◉ #general · 120 days', '◉ #general · 120 jours', '◉ #general · 120 天'],
})
