import type { z } from 'zod'
import type { Priority, ProjectTemplate } from '@tracker/shared-schema'
import type { Language } from './words.js'

/** The body shape every written thing in the product shares. */
export const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
})

export type List = 'Backlog' | 'Todo' | 'In Progress' | 'In Review' | 'Done' | 'Canceled'
export type Label = 'Bug' | 'Feature' | 'Improvement'

export type SampleTask = {
  title: string
  list: List
  label?: Label
  priority?: z.infer<typeof Priority>
  /** Days from today; negative is already late. */
  dueIn?: number
  /** For the two lists that finish: how long ago it was finished. */
  doneDaysAgo?: number
  body?: string[]
  parts?: { title: string; done?: boolean }[]
}

/**
 * A small project in all of its states.
 *
 * Nothing in it is on anybody: it is a place to look around, and the work in
 * it is nobody's.
 */
export type Sample = {
  name: string
  description: string
  tasks: readonly SampleTask[]
  doc: { name: string; body: string[] }
  post: { title: string; body: string[] }
  /**
   * The channel, a little lived in: a few days of somebody working, a task
   * named in a line, a list and a thread. Written as the person who made
   * the sample, since nobody else is in it. `ago` is in hours.
   */
  chat: readonly { ago: number; text: string; task?: string; list?: string[]; reply?: { ago: number; text: string } }[]
  /** A word or two under a task, as the team leaves them. */
  comments: readonly { task: string; ago: number; text: string }[]
}

export const SAMPLE: Sample = {
  name: 'Sample project',
  description: 'A sample to look around in. Delete it when you’re done.',
  tasks: [
    {
      title: 'Collect feedback from the first users',
      list: 'Backlog',
      label: 'Improvement',
      body: [
        'Talk to five people who signed up in the first week. What did they try first, and where did they stop?',
        'Write what you hear in a doc in this project, one heading per person, and link it here.',
      ],
    },
    {
      title: 'Try a dark version of the homepage',
      list: 'Backlog',
      label: 'Feature',
      priority: 'low',
      body: ['A quick experiment, not a redesign: the same page on a dark background, to see whether the screenshots read better.'],
    },
    {
      title: 'Fix the sign-in button on small screens',
      list: 'Todo',
      label: 'Bug',
      priority: 'high',
      dueIn: 1,
      body: [
        'On phones narrower than 360 pixels the button runs off the edge of the screen.',
        'Check it on the smallest iPhone and an older Android before closing this.',
      ],
    },
    {
      title: 'Write the release notes',
      list: 'Todo',
      priority: 'medium',
      dueIn: 3,
      body: [
        'Short and plain: what changed, and why it matters to the people reading.',
        'Lead with the new pricing page, then the smaller fixes in a list.',
      ],
    },
    {
      title: 'Plan the next sprint',
      list: 'Todo',
      dueIn: 7,
      body: [
        'Go through the backlog together and pick what fits in two weeks.',
        'Anything without an owner by the end of the meeting goes back to the backlog.',
      ],
    },
    {
      title: 'Redesign the pricing page',
      list: 'In Progress',
      label: 'Feature',
      priority: 'high',
      dueIn: 2,
      body: [
        'Three plans side by side, with the yearly price under the monthly one.',
        'Keep the page to one screen on a laptop. The questions people ask go in an FAQ under the plans.',
      ],
      parts: [{ title: 'Draft the layout', done: true }, { title: 'Write the copy' }, { title: 'Review it with the team' }],
    },
    {
      title: 'Update the help center',
      list: 'In Progress',
      label: 'Improvement',
      priority: 'medium',
      dueIn: -1,
      body: [
        'Three articles still show the old pricing. Replace the screenshots and the numbers.',
        'This one is a day late — it can go out with the release notes.',
      ],
    },
    {
      title: 'Set up the project',
      list: 'Done',
      doneDaysAgo: 3,
      body: ['Lists, labels and the team chat. Everyone who works on the launch is on the project.'],
    },
    {
      title: 'Pick the colour palette',
      list: 'Done',
      label: 'Feature',
      doneDaysAgo: 2,
      body: ['One accent, two greys and a red for errors. The values are in the design file.'],
    },
    {
      title: 'Move the blog to the new domain',
      list: 'Done',
      doneDaysAgo: 1,
      body: ['Old addresses redirect to the new ones, so links people shared still work.'],
    },
    {
      title: 'Add a live chat widget',
      list: 'Canceled',
      label: 'Feature',
      doneDaysAgo: 4,
      body: ['Dropped for now: an email address answered within a day is enough at this size.'],
    },
  ],
  doc: {
    name: 'How this project is organised',
    body: [
      'Tasks hold the work. Each list is a stage — Backlog, Todo, In Progress, In Review, Done — and a task moves through them. Switch between the list and the board at the top of Tasks.',
      'Chat is the project’s channel. Mention a task with # and a person with @.',
      'Docs hold documents like this one, files you upload and links.',
      'Announcements are for news and decisions everyone on the project should see.',
      'This is a sample. Delete it from the bar at the top of the project when you’re done.',
    ],
  },
  chat: [
    { ago: 50, text: 'Morning! Starting on the pricing page redesign today.' },
    { ago: 49, text: 'The plan and the parts are here:', task: 'Redesign the pricing page' },
    {
      ago: 30,
      text: 'Should the yearly price come first, or the monthly?',
      reply: { ago: 29, text: 'Monthly first, yearly under it — the way the layout draft has it.' },
    },
    { ago: 26, text: 'Before Tuesday:', list: ['Copy for the three plans', 'New screenshots for the help center', 'Release notes'] },
    { ago: 6, text: 'Quick one before lunch —', task: 'Fix the sign-in button on small screens' },
    { ago: 2, text: 'The layout is done. Copy next, then a review with everyone on Thursday.' },
  ],
  comments: [
    { task: 'Redesign the pricing page', ago: 28, text: 'Layout draft is in Docs. Copy is the next part.' },
    {
      task: 'Fix the sign-in button on small screens',
      ago: 5,
      text: 'Reproduced on a 320-pixel screen. The padding is fixed, not relative.',
    },
    { task: 'Update the help center', ago: 20, text: 'Two of the three articles are done.' },
  ],
  post: {
    title: 'The new pricing page goes live next week',
    body: ['We’re launching the new pricing page next Tuesday.', 'What’s left is in In Progress on the board.'],
  },
}

/* ------------------------------------------------------------ in French */

/*
 * What a project starts with, for somebody who reads French.
 *
 * Written into the project as it is made, and the project's own text from
 * then on: a list renamed, a label added, a task finished are the team's,
 * and nothing translates them again for whoever reads them next. So the
 * French is chosen once, by whoever makes the project, and the English in
 * `@tracker/shared-schema` stays what every client reads to draw a project
 * before it is made.
 *
 * The lists are named the way Trello, Asana and Jira name theirs in
 * French; Backlog is kept as the word French teams use for it.
 */
export const LISTS_FR: Record<List, string> = {
  Backlog: 'Backlog',
  Todo: 'À faire',
  'In Progress': 'En cours',
  'In Review': 'En revue',
  Done: 'Terminé',
  Canceled: 'Annulé',
}

/** The three labels the database gives every project — `071_a_label_belongs_to_its_project.sql`. */
export const LABELS_FR: Record<Label, string> = {
  Bug: 'Bug',
  Feature: 'Fonctionnalité',
  Improvement: 'Amélioration',
}

/** The lists and labels a new project starts with, in Simplified Chinese. */
export const LISTS_ZH: Record<List, string> = {
  Backlog: '待办池',
  Todo: '待办',
  'In Progress': '进行中',
  'In Review': '评审中',
  Done: '已完成',
  Canceled: '已取消',
}

export const LABELS_ZH: Record<Label, string> = {
  Bug: '缺陷',
  Feature: '功能',
  Improvement: '改进',
}

export const listName = (name: string, language: Language): string =>
  language === 'fr' ? (LISTS_FR[name as List] ?? name) : language === 'zh' ? (LISTS_ZH[name as List] ?? name) : name

/**
 * A template's first tasks and its document in French, keyed by the
 * English title as the error table is, so a task added to a template in
 * `shared-schema` without its French is found by `words.test.ts` rather
 * than made in English in a French project.
 */
export const TEMPLATES_FR: Record<
  z.infer<typeof ProjectTemplate>,
  { readonly tasks: Readonly<Record<string, string>>; readonly doc: { readonly name: string; readonly body: readonly string[] } }
> = {
  launch: {
    tasks: {
      'Write the launch brief': 'Rédiger le brief du lancement',
      'Set the launch date': 'Fixer la date de lancement',
      'Invite the team to this project': 'Inviter l’équipe dans ce projet',
      'List what has to be ready': 'Lister ce qui doit être prêt',
      'Draft the announcement': 'Préparer l’annonce',
      'Plan the launch day': 'Organiser le jour du lancement',
      'Review the results a week after': 'Faire le bilan une semaine après',
    },
    doc: {
      name: 'Brief du lancement',
      body: ['Ce que nous lançons, et pour qui.', 'La date, et ce qui doit être prêt d’ici là.', 'Comment nous saurons que ça a marché.'],
    },
  },
  client: {
    tasks: {
      'Hold the kick-off call': 'Faire la réunion de lancement',
      'Write the scope and the timeline': 'Rédiger le périmètre et le calendrier',
      'Share the plan with the client': 'Partager le plan avec le client',
      'Make the first draft': 'Réaliser une première version',
      'Collect the client’s feedback': 'Recueillir les retours du client',
      'Deliver the final version': 'Livrer la version finale',
      'Send the invoice': 'Envoyer la facture',
    },
    doc: {
      name: 'Périmètre et calendrier',
      body: ['Ce que le client a demandé, avec ses mots.', 'Ce qui est inclus, et ce qui ne l’est pas.', 'Les dates, et qui valide.'],
    },
  },
  sprint: {
    tasks: {
      'Plan the sprint': 'Planifier le sprint',
      'Write the sprint goal': 'Rédiger l’objectif du sprint',
      'Sort the backlog': 'Trier le backlog',
      'Check in with the team mid-sprint': 'Faire un point avec l’équipe à mi-sprint',
      'Review what shipped': 'Passer en revue ce qui a été livré',
      'Hold the retrospective': 'Faire la rétrospective',
    },
    doc: {
      name: 'Objectif du sprint',
      body: ['La seule chose à laquelle sert ce sprint.', 'À quoi ressemble « terminé ».', 'Ce que nous laissons pour la prochaine fois.'],
    },
  },
}

/** The same first tasks and documents in Simplified Chinese, keyed the same way. */
export const TEMPLATES_ZH: typeof TEMPLATES_FR = {
  launch: {
    tasks: {
      'Write the launch brief': '撰写发布简报',
      'Set the launch date': '确定发布日期',
      'Invite the team to this project': '邀请团队加入此项目',
      'List what has to be ready': '列出必须准备就绪的事项',
      'Draft the announcement': '起草发布公告',
      'Plan the launch day': '规划发布当天',
      'Review the results a week after': '发布一周后复盘结果',
    },
    doc: {
      name: '发布简报',
      body: ['我们要发布什么，以及面向谁。', '日期，以及到那时必须完成的事项。', '如何判断发布是否成功。'],
    },
  },
  client: {
    tasks: {
      'Hold the kick-off call': '召开启动会',
      'Write the scope and the timeline': '撰写范围和时间计划',
      'Share the plan with the client': '与客户分享计划',
      'Make the first draft': '制作第一版草稿',
      'Collect the client’s feedback': '收集客户反馈',
      'Deliver the final version': '交付最终版本',
      'Send the invoice': '发送发票',
    },
    doc: {
      name: '范围和时间计划',
      body: ['客户的要求，尽量使用他们的原话。', '包含什么，不包含什么。', '日期，以及由谁验收。'],
    },
  },
  sprint: {
    tasks: {
      'Plan the sprint': '规划迭代',
      'Write the sprint goal': '撰写迭代目标',
      'Sort the backlog': '整理待办池',
      'Check in with the team mid-sprint': '迭代中期与团队检查进度',
      'Review what shipped': '回顾已交付的内容',
      'Hold the retrospective': '召开复盘会',
    },
    doc: {
      name: '迭代目标',
      body: ['这次迭代唯一要达成的目标。', '「完成」是什么样子。', '哪些内容留给下一次。'],
    },
  },
}

/**
 * The sample, written in French rather than translated: the same project
 * in the same states — the same lists, labels, dates and parts — told the
 * way a French team would tell it. Tasks are named in the chat and the
 * comments by their French titles, which is what they are found by.
 */
export const SAMPLE_FR: Sample = {
  name: 'Exemple de projet',
  description: 'Un exemple pour faire le tour. Supprimez-le quand vous aurez terminé.',
  tasks: [
    {
      title: 'Recueillir les retours des premiers utilisateurs',
      list: 'Backlog',
      label: 'Improvement',
      body: [
        'Parlez à cinq personnes inscrites la première semaine. Qu’ont-elles essayé en premier, et où se sont-elles arrêtées ?',
        'Notez ce que vous entendez dans un document de ce projet, un titre par personne, et mettez le lien ici.',
      ],
    },
    {
      title: 'Essayer une version sombre de la page d’accueil',
      list: 'Backlog',
      label: 'Feature',
      priority: 'low',
      body: ['Un essai rapide, pas une refonte : la même page sur fond sombre, pour voir si les captures d’écran ressortent mieux.'],
    },
    {
      title: 'Corriger le bouton de connexion sur petit écran',
      list: 'Todo',
      label: 'Bug',
      priority: 'high',
      dueIn: 1,
      body: [
        'Sur les téléphones de moins de 360 pixels de large, le bouton déborde de l’écran.',
        'Vérifiez sur le plus petit iPhone et sur un Android plus ancien avant de clore la tâche.',
      ],
    },
    {
      title: 'Rédiger les notes de version',
      list: 'Todo',
      priority: 'medium',
      dueIn: 3,
      body: [
        'Court et simple : ce qui a changé, et pourquoi c’est important pour ceux qui les lisent.',
        'Commencez par la nouvelle page de tarifs, puis les petites corrections en liste.',
      ],
    },
    {
      title: 'Planifier le prochain sprint',
      list: 'Todo',
      dueIn: 7,
      body: [
        'Passez le backlog en revue ensemble et choisissez ce qui tient en deux semaines.',
        'Ce qui n’a pas de responsable à la fin de la réunion retourne dans le backlog.',
      ],
    },
    {
      title: 'Refondre la page de tarifs',
      list: 'In Progress',
      label: 'Feature',
      priority: 'high',
      dueIn: 2,
      body: [
        'Trois forfaits côte à côte, avec le prix à l’année sous le prix au mois.',
        'La page tient sur un seul écran d’ordinateur portable. Les questions fréquentes vont dans une FAQ sous les forfaits.',
      ],
      parts: [{ title: 'Esquisser la mise en page', done: true }, { title: 'Rédiger les textes' }, { title: 'Relire avec l’équipe' }],
    },
    {
      title: 'Mettre à jour le centre d’aide',
      list: 'In Progress',
      label: 'Improvement',
      priority: 'medium',
      dueIn: -1,
      body: [
        'Trois articles affichent encore les anciens tarifs. Remplacez les captures d’écran et les chiffres.',
        'Celle-ci a un jour de retard — elle peut partir avec les notes de version.',
      ],
    },
    {
      title: 'Mettre en place le projet',
      list: 'Done',
      doneDaysAgo: 3,
      body: [
        'Les listes, les étiquettes et la discussion de l’équipe. Toutes les personnes qui travaillent sur le lancement sont dans le projet.',
      ],
    },
    {
      title: 'Choisir la palette de couleurs',
      list: 'Done',
      label: 'Feature',
      doneDaysAgo: 2,
      body: ['Une couleur d’accent, deux gris et un rouge pour les erreurs. Les valeurs sont dans le fichier de maquette.'],
    },
    {
      title: 'Passer le blog sur le nouveau domaine',
      list: 'Done',
      doneDaysAgo: 1,
      body: ['Les anciennes adresses redirigent vers les nouvelles, et les liens déjà partagés fonctionnent toujours.'],
    },
    {
      title: 'Ajouter un chat en direct sur le site',
      list: 'Canceled',
      label: 'Feature',
      doneDaysAgo: 4,
      body: ['Laissé de côté pour l’instant : une adresse e-mail qui répond dans la journée suffit à notre taille.'],
    },
  ],
  doc: {
    name: 'Comment ce projet est organisé',
    body: [
      'Les tâches portent le travail. Chaque liste est une étape — Backlog, À faire, En cours, En revue, Terminé — et une tâche passe de l’une à l’autre. Passez de la liste au tableau en haut de Tâches.',
      'Discussion est le canal du projet. Mentionnez une tâche avec # et une personne avec @.',
      'Documents réunit les documents comme celui-ci, les fichiers importés et les liens.',
      'Annonces sert aux nouvelles et aux décisions que tout le monde sur le projet doit voir.',
      'Ceci est un exemple. Supprimez-le depuis la barre en haut du projet quand vous aurez terminé.',
    ],
  },
  chat: [
    { ago: 50, text: 'Bonjour ! Je commence la refonte de la page de tarifs aujourd’hui.' },
    { ago: 49, text: 'Le plan et les étapes sont ici :', task: 'Refondre la page de tarifs' },
    {
      ago: 30,
      text: 'On met le prix à l’année en premier, ou celui au mois ?',
      reply: { ago: 29, text: 'Au mois d’abord, à l’année en dessous — comme sur l’esquisse.' },
    },
    {
      ago: 26,
      text: 'Avant mardi :',
      list: ['Les textes des trois forfaits', 'De nouvelles captures pour le centre d’aide', 'Les notes de version'],
    },
    { ago: 6, text: 'Petite chose avant le déjeuner —', task: 'Corriger le bouton de connexion sur petit écran' },
    { ago: 2, text: 'La mise en page est terminée. Les textes ensuite, puis une relecture avec tout le monde jeudi.' },
  ],
  comments: [
    { task: 'Refondre la page de tarifs', ago: 28, text: 'L’esquisse est dans Documents. Les textes sont la prochaine étape.' },
    {
      task: 'Corriger le bouton de connexion sur petit écran',
      ago: 5,
      text: 'Reproduit sur un écran de 320 pixels. La marge est fixe, pas relative.',
    },
    { task: 'Mettre à jour le centre d’aide', ago: 20, text: 'Deux articles sur trois sont faits.' },
  ],
  post: {
    title: 'La nouvelle page de tarifs sera en ligne la semaine prochaine',
    body: ['Nous lançons la nouvelle page de tarifs mardi prochain.', 'Ce qui reste à faire est dans En cours, sur le tableau.'],
  },
}

/** The sample in Simplified Chinese, in the same states and with its tasks named the way the chat and the comments find them. */
export const SAMPLE_ZH: Sample = {
  name: '示例项目',
  description: '用于四处看看的示例。看完后删除即可。',
  tasks: [
    {
      title: '收集首批用户的反馈',
      list: 'Backlog',
      label: 'Improvement',
      body: [
        '和第一周注册的五个人聊聊。他们先尝试了什么，又停在了哪里？',
        '把听到的内容写进此项目的一篇文档，每个人一个标题，并链接到这里。',
      ],
    },
    {
      title: '尝试首页的深色版本',
      list: 'Backlog',
      label: 'Feature',
      priority: 'low',
      body: ['这是一次快速实验，不是重新设计：同一页面换成深色背景，看截图是否更清晰。'],
    },
    {
      title: '修复小屏幕上的登录按钮',
      list: 'Todo',
      label: 'Bug',
      priority: 'high',
      dueIn: 1,
      body: ['在窄于 360 像素的手机上，按钮会超出屏幕边缘。', '关闭前，请在最小的 iPhone 和一台较旧的 Android 设备上检查。'],
    },
    {
      title: '撰写发布说明',
      list: 'Todo',
      priority: 'medium',
      dueIn: 3,
      body: ['写得简短直白：发生了什么变化，以及为什么对读者重要。', '先介绍新的定价页，再用列表写较小的修复。'],
    },
    {
      title: '规划下一个迭代',
      list: 'Todo',
      dueIn: 7,
      body: ['一起过一遍待办池，挑出两周内能完成的工作。', '会议结束时仍没有负责人的事项，都放回待办池。'],
    },
    {
      title: '重新设计定价页',
      list: 'In Progress',
      label: 'Feature',
      priority: 'high',
      dueIn: 2,
      body: ['三个套餐并排展示，年付价格放在月付价格下方。', '页面在笔记本电脑上保持一屏以内。常见问题放在套餐下方的 FAQ 中。'],
      parts: [{ title: '起草布局', done: true }, { title: '撰写文案' }, { title: '与团队评审' }],
    },
    {
      title: '更新帮助中心',
      list: 'In Progress',
      label: 'Improvement',
      priority: 'medium',
      dueIn: -1,
      body: ['还有三篇文章显示旧定价。替换截图和数字。', '这一项已经晚了一天，可以随发布说明一起发出。'],
    },
    {
      title: '搭建项目',
      list: 'Done',
      doneDaysAgo: 3,
      body: ['列表、标签和团队聊天。参与发布的所有人都在项目中。'],
    },
    {
      title: '选定配色方案',
      list: 'Done',
      label: 'Feature',
      doneDaysAgo: 2,
      body: ['一个强调色、两个灰色，以及一个用于错误的红色。具体值在设计文件中。'],
    },
    {
      title: '将博客迁移到新域名',
      list: 'Done',
      doneDaysAgo: 1,
      body: ['旧地址会重定向到新地址，因此大家分享过的链接仍然有效。'],
    },
    {
      title: '添加在线聊天组件',
      list: 'Canceled',
      label: 'Feature',
      doneDaysAgo: 4,
      body: ['暂时放弃：以目前的规模，一个在一天内回复的邮箱地址已经足够。'],
    },
  ],
  doc: {
    name: '这个项目的组织方式',
    body: [
      '任务承载具体工作。每个列表都是一个阶段——待办池、待办、进行中、评审中、已完成——任务会依次流转。可以在「任务」顶部切换列表和看板。',
      '聊天是项目的频道。用 # 提及任务，用 @ 提及成员。',
      '文档存放像这样的文档、上传的文件和链接。',
      '公告用于发布项目成员都应看到的消息和决定。',
      '这是一个示例。看完后，在项目顶部栏中删除即可。',
    ],
  },
  chat: [
    { ago: 50, text: '早上好！今天开始重新设计定价页。' },
    { ago: 49, text: '计划和拆分都在这里：', task: '重新设计定价页' },
    {
      ago: 30,
      text: '应该先展示年付价格，还是月付价格？',
      reply: { ago: 29, text: '先月付，年付放在下面——布局草稿就是这样。' },
    },
    { ago: 26, text: '周二之前：', list: ['三个套餐的文案', '帮助中心的新截图', '发布说明'] },
    { ago: 6, text: '午饭前快速处理一个——', task: '修复小屏幕上的登录按钮' },
    { ago: 2, text: '布局已经完成。接下来写文案，周四和大家一起评审。' },
  ],
  comments: [
    { task: '重新设计定价页', ago: 28, text: '布局草稿在「文档」里。下一步是文案。' },
    { task: '修复小屏幕上的登录按钮', ago: 5, text: '已在 320 像素宽的屏幕上复现。内边距是固定值，不是相对值。' },
    { task: '更新帮助中心', ago: 20, text: '三篇文章已经完成两篇。' },
  ],
  post: {
    title: '新定价页下周上线',
    body: ['我们将在下周二上线新的定价页。', '剩余工作都在看板的「进行中」。'],
  },
}
