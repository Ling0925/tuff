/**
 * Every word the interface says, in every language it says it in.
 *
 * The design asks for the first half of this from day one: "the product's
 * language is English … there is no localisation in v1, but every string is
 * lifted out of the components from day one, so that it can be added later".
 * This is later.
 *
 * ## How it is read
 *
 * The components import `BAR`, `MAKE` and the rest exactly as they did when
 * there was one language, and get the words for the language this machine is
 * reading in. Chosen once when the module loads, like the theme and for the
 * same reason: a language that changed under a rendered screen would be a
 * second source of truth about what the screen says, and nobody switches
 * language twice in a session. Changing it reloads.
 *
 * ## What belongs here
 *
 * Words the product says in its own voice: the name of a control, the hint
 * in an empty field, what a button does. Grouped by where they are rather
 * than by what they are, because "what is on the task screen" is the
 * question somebody editing copy actually has.
 *
 * ## What does not
 *
 * Anything a person wrote — a task's title, a label's name, a project's
 * description. Those are data and they are already in whatever language
 * their author used.
 *
 * And the prose. The empty states explain why a screen is empty and what to
 * do about it, in several sentences, and the design is explicit that this
 * copy is *written* in the product's tone rather than translated. A
 * dictionary key for three sentences is how that becomes a calque. They stay
 * where they are read until somebody writes them in each language.
 *
 * ## A warning about the copy below
 *
 * The English is the product's own. The Spanish and the French were written
 * here, to the same rules — short verb phrases, no exclamations, an error
 * says what to do — and they have not been read by anybody who speaks those
 * languages daily. They are a working draft and should be checked before
 * they are shown to anybody who would notice.
 */

export type Tongue = 'en' | 'es' | 'fr' | 'zh'

const KEY = 'tongue'

/**
 * Which language, and who decided.
 *
 * Four answers rather than three: "system" is the default and the way back
 * to it, the same shape the theme has. A switch with only the three takes
 * the choice away from the machine for ever.
 */
export type Chosen = Tongue | 'system'

export function readTongue(): Chosen {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'en' || v === 'es' || v === 'fr' || v === 'zh' ? v : 'system'
  } catch {
    return 'system'
  }
}

/**
 * What the machine says, for when nobody has said anything else.
 *
 * The first two letters only. A browser set to `es-419` or `fr-CA` is asking
 * for Spanish or French, and a product with one Spanish does not need to
 * know which one — matching the whole tag would answer English to most of
 * the people who asked for Spanish.
 */
export function fromSystem(): Tongue {
  try {
    const said = (navigator.language || 'en').slice(0, 2).toLowerCase()
    return said === 'es' || said === 'fr' || said === 'zh' ? said : 'en'
  } catch {
    return 'en'
  }
}

/*
 * The languages the product speaks: English and French.
 *
 * The Spanish below is still a draft nobody fluent has read, and a product
 * that greets a Madrid browser in a draft looks unfinished to exactly the
 * people it is reaching for. So it stays here and is not listened to —
 * adding it back is adding it to this list.
 *
 * French is spoken to whoever chooses it and to a browser that says it
 * reads French. The second list is what is heard
 * from the machine, and taking a language out of it is how one is held
 * back from people who never asked for it.
 */
const SPOKEN: readonly Tongue[] = ['en', 'fr', 'zh']
const HEARD: readonly Tongue[] = ['en', 'fr', 'zh']

/** The public site's pages in English: the landing, Help, the comparisons, the legal pages, what changed. */
const SITE_PAGE = /^\/(welcome|pricing|about|compare|alternatives|for|help|privacy|terms|refunds|changelog)(\/|$)/

/**
 * The language a page of the public site is in, which is its address's —
 * `/fr/…` French, the rest English — whoever reads it and whatever they
 * chose: a link to a page is a link to the words on it, and a search
 * engine has to find the same page at the same address every time. Null
 * for the app's own screens, which speak what the person chose.
 *
 * `/` and `/fr` are the landing only for somebody with no session; for
 * anybody else they are the app.
 */
export function siteTongue(path: string, signedIn: boolean): Tongue | null {
  if (path === '/' || path === '/fr' || path === '/fr/') return signedIn ? null : path === '/' ? 'en' : 'fr'
  if (/^\/fr\//.test(path)) return 'fr'
  return SITE_PAGE.test(path) ? 'en' : null
}

/* Whether this browser holds a session — read here rather than from
   `api.ts`, which reads this module. The same key. */
function signedIn(): boolean {
  try {
    return localStorage.getItem('session') !== null
  } catch {
    return false
  }
}

export function tongue(): Tongue {
  /* The public pages are built ahead of time once in each language
     — and say which before this is read. */
  const built = (globalThis as { __TONGUE__?: Tongue }).__TONGUE__
  if (built) return built
  try {
    const site = siteTongue(location.pathname, signedIn())
    if (site) return site
  } catch {
    // No address to read: the choice and the machine below decide.
  }
  const said = readTongue()
  if (said !== 'system') return SPOKEN.includes(said) ? said : 'en'
  const heard = fromSystem()
  return HEARD.includes(heard) ? heard : 'en'
}

/**
 * Keep a choice: on this device for the screens, and in a cookie for the
 * server, which sends a French browser from `/` to `/fr` only when nothing
 * was chosen — somebody who picked English is not sent back each visit.
 */
export function rememberTongue(to: Chosen): void {
  try {
    if (to === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, to)
  } catch {
    // A private window keeps nothing; the page is still built in the language asked for.
  }
  try {
    document.cookie = to === 'system' ? 'tongue=; path=/; max-age=0; samesite=lax' : `tongue=${to}; path=/; max-age=31536000; samesite=lax`
  } catch {
    // Nothing to keep it in: the redirect simply asks the browser again.
  }
}

export function chooseTongue(to: Chosen): void {
  rememberTongue(to)
  /* Read once at load, so the screen has to be built again to say anything
     else. Which is honest: half a screen in one language and half in
     another is worse than a flash of white. */
  location.reload()
}

/**
 * The address of the page being drawn — the browser's, or while the public
 * pages are built ahead of time the one being written (`prerender.tsx`).
 */
export function herePath(): string {
  const building = (globalThis as { __PATH__?: string }).__PATH__
  if (building) return building
  try {
    return location.pathname
  } catch {
    return '/'
  }
}

/**
 * The same page of the public site in the other language: `/compare/notion`
 * and `/fr/compare/notion`, `/` and `/fr`.
 */
export function inTongue(path: string, to: Tongue): string {
  const bare = path.replace(/^\/fr(?=\/|$)/, '') || '/'
  if (to !== 'fr') return bare
  return bare === '/' ? '/fr' : `/fr${bare}`
}

/**
 * A link from one public page to another, in the language this one is in.
 * The app's doors — `/signin`, `/signup` — and an anchor on this page pass
 * through as they are: they are not pages with two spellings.
 */
/** Tuff on the App Store — iPhone, iPad and Mac. No storefront in the path, so Apple sends each visitor to their own. */
export const APP_STORE = 'https://apps.apple.com/app/id6827503722'

export function site(path: string): string {
  if (now !== 'fr') return path
  const [bare, hash] = path.split('#') as [string, string | undefined]
  if (bare === '' || (bare !== '/' && !SITE_PAGE.test(bare))) return path
  return `${inTongue(bare, 'fr')}${hash !== undefined ? `#${hash}` : ''}`
}

/** The bar across the top, and what hangs off it. */
const BARS = {
  en: {
    search: 'Search',
    send: 'Send',
    reply: 'Reply',
    close: 'Close',
    openTheNavigation: 'Open the navigation',
    sidebarWidth: 'Sidebar Width',
    toolsWidth: 'Tools Width',
    besideWidth: 'Conversation Width',
    threadWidth: 'Thread Width',
  },
  es: {
    search: 'Buscar',
    send: 'Enviar',
    reply: 'Responder',
    close: 'Cerrar',
    openTheNavigation: 'Abrir la navegación',
    sidebarWidth: 'Ancho de la barra lateral',
    toolsWidth: 'Ancho de las herramientas',
    besideWidth: 'Ancho de la conversación',
    threadWidth: 'Ancho del hilo',
  },
  fr: {
    search: 'Rechercher',
    send: 'Envoyer',
    reply: 'Répondre',
    close: 'Fermer',
    openTheNavigation: 'Ouvrir la navigation',
    sidebarWidth: 'Largeur de la barre latérale',
    toolsWidth: 'Largeur des outils',
    besideWidth: 'Largeur de la conversation',
    threadWidth: 'Largeur du fil',
  },
  zh: {
    search: '搜索',
    send: '发送',
    reply: '回复',
    close: '关闭',
    openTheNavigation: '打开导航',
    sidebarWidth: '侧边栏宽度',
    toolsWidth: '工具宽度',
    besideWidth: '对话宽度',
    threadWidth: '话题宽度',
  },
} as const

/** The column down the side, and the screens it reaches. */
const PLACESES = {
  en: {
    myTasks: 'My Tasks',
    members: 'People & Agents',
    project: 'Project',
    startAConversation: 'Start a conversation',
    goAnywhere: 'Search, or go to a project or screen',
    findOrMakeOne: 'Find or create a label',
    findSomebody: 'Find someone',
    findASprint: 'Find a sprint',
  },
  es: {
    myTasks: 'Mis tareas',
    members: 'Personas y agentes',
    project: 'Proyecto',
    startAConversation: 'Empezar una conversación',
    goAnywhere: 'Buscar o ir a un proyecto o una pantalla',
    findOrMakeOne: 'Buscar o crear una etiqueta',
    findSomebody: 'Buscar a alguien',
    findASprint: 'Buscar un sprint',
  },
  fr: {
    myTasks: 'Mes tâches',
    members: 'Personnes et agents',
    project: 'Projet',
    startAConversation: 'Démarrer une conversation',
    goAnywhere: 'Rechercher ou aller à un projet ou un écran',
    findOrMakeOne: 'Trouver ou créer une étiquette',
    findSomebody: 'Trouver quelqu’un',
    findASprint: 'Trouver un sprint',
  },
  zh: {
    myTasks: '我的任务',
    members: '成员与代理',
    project: '项目',
    startAConversation: '发起对话',
    goAnywhere: '搜索，或前往项目或页面',
    findOrMakeOne: '查找或创建标签',
    findSomebody: '查找成员',
    findASprint: '查找迭代',
  },
} as const

/** Making things. The label on the button and the hint in the field it opens. */
const MAKES = {
  en: {
    newTask: 'New task',
    newProject: 'New project',
    newPost: 'New announcement',
    newDocument: 'New document',
    newFolder: 'New folder',
    newToken: 'New token',
    newWebhook: 'New webhook',
    addTask: 'Add task',
    addLink: 'Add link',
    addAList: 'Add a list',
    addALabel: 'Add a label',
    addSomebody: 'Add someone',
    attachAFile: 'Attach a file',
    callItWhatItIs: 'Give it a name',
    whatIsItAbout: 'What is it about?',
    whatIsThisAbout: 'What is this about?',
    whatIsItFor: 'What is it for?',
    whatGoesInIt: 'What goes in it?',
    nameForTheCopy: 'Name for the copy',
    subTaskTitle: 'Sub-task title',
    writeItHere: 'Write it here.',
    message: 'Message',
    cycleExample: 'Add a sprint',
  },
  es: {
    newTask: 'Nueva tarea',
    newProject: 'Nuevo proyecto',
    newPost: 'Nuevo anuncio',
    newDocument: 'Nuevo documento',
    newFolder: 'Nueva carpeta',
    newToken: 'Nuevo token',
    newWebhook: 'Nuevo webhook',
    addTask: 'Añadir tarea',
    addLink: 'Añadir enlace',
    addAList: 'Añadir una lista',
    addALabel: 'Añadir una etiqueta',
    addSomebody: 'Añadir a alguien',
    attachAFile: 'Adjuntar un archivo',
    callItWhatItIs: 'Ponle un nombre',
    whatIsItAbout: '¿De qué trata?',
    whatIsThisAbout: '¿De qué trata esto?',
    whatIsItFor: '¿Para qué es?',
    whatGoesInIt: '¿Qué va dentro?',
    nameForTheCopy: 'Nombre de la copia',
    subTaskTitle: 'Título de la subtarea',
    writeItHere: 'Escríbelo aquí.',
    message: 'Mensaje',
    cycleExample: 'Añadir un sprint',
  },
  fr: {
    newTask: 'Nouvelle tâche',
    newProject: 'Nouveau projet',
    newPost: 'Nouvelle annonce',
    newDocument: 'Nouveau document',
    newFolder: 'Nouveau dossier',
    newToken: 'Nouveau jeton',
    newWebhook: 'Nouveau webhook',
    addTask: 'Ajouter une tâche',
    addLink: 'Ajouter un lien',
    addAList: 'Ajouter une liste',
    addALabel: 'Ajouter une étiquette',
    addSomebody: 'Ajouter quelqu’un',
    attachAFile: 'Joindre un fichier',
    callItWhatItIs: 'Donnez-lui un nom',
    whatIsItAbout: 'De quoi s’agit-il ?',
    whatIsThisAbout: 'De quoi s’agit-il ?',
    whatIsItFor: 'À quoi sert-il ?',
    whatGoesInIt: 'Qu’est-ce qui va dedans ?',
    nameForTheCopy: 'Nom de la copie',
    subTaskTitle: 'Titre de la sous-tâche',
    writeItHere: 'Écrivez ici.',
    message: 'Message',
    cycleExample: 'Ajouter un sprint',
  },
  zh: {
    newTask: '新建任务',
    newProject: '新建项目',
    newPost: '新建公告',
    newDocument: '新建文档',
    newFolder: '新建文件夹',
    newToken: '新建令牌',
    newWebhook: '新建 Webhook',
    addTask: '添加任务',
    addLink: '添加链接',
    addAList: '添加列表',
    addALabel: '添加标签',
    addSomebody: '添加成员',
    attachAFile: '附加文件',
    callItWhatItIs: '给它起个名字',
    whatIsItAbout: '这是关于什么的？',
    whatIsThisAbout: '这是关于什么的？',
    whatIsItFor: '它是用来做什么的？',
    whatGoesInIt: '里面放什么？',
    nameForTheCopy: '副本名称',
    subTaskTitle: '子任务标题',
    writeItHere: '写在这里。',
    message: '消息',
    cycleExample: '添加迭代',
  },
} as const

/** A task's own facts — the rows in the panel beside it. */
const FACTSES = {
  en: {
    assignee: 'Assignee',
    priority: 'Priority',
    labels: 'Labels',
    due: 'Due',
    starts: 'Starts',
    cycle: 'Sprint',
    role: 'Role',
    addADescription: 'Add a description',
    addDescription: 'Add description…',
  },
  es: {
    assignee: 'Responsable',
    priority: 'Prioridad',
    labels: 'Etiquetas',
    due: 'Vence',
    starts: 'Empieza',
    cycle: 'Sprint',
    role: 'Rol',
    addADescription: 'Añadir una descripción',
    addDescription: 'Añadir descripción…',
  },
  fr: {
    assignee: 'Responsable',
    priority: 'Priorité',
    labels: 'Étiquettes',
    due: 'Échéance',
    starts: 'Début',
    cycle: 'Sprint',
    role: 'Rôle',
    addADescription: 'Ajouter une description',
    addDescription: 'Ajouter une description…',
  },
  zh: {
    assignee: '负责人',
    priority: '优先级',
    labels: '标签',
    due: '到期',
    starts: '开始',
    cycle: '迭代',
    role: '角色',
    addADescription: '添加描述',
    addDescription: '添加描述…',
  },
} as const

/** What a project is called and what it looks like. */
const PROJECTS = {
  en: {
    itsMark: 'Icon',
    itsColour: 'Colour',
    copyThisProject: 'Copy this project',
    workspaceName: 'Workspace name',
  },
  es: {
    itsMark: 'Icono',
    itsColour: 'Color',
    copyThisProject: 'Copiar este proyecto',
    workspaceName: 'Nombre del espacio',
  },
  fr: {
    itsMark: 'Icône',
    itsColour: 'Couleur',
    copyThisProject: 'Copier ce projet',
    workspaceName: 'Nom de l’espace de travail',
  },
  zh: {
    itsMark: '图标',
    itsColour: '颜色',
    copyThisProject: '复制此项目',
    workspaceName: '工作区名称',
  },
} as const

/** The toolbar over a document — `docs/specs/rich-text.md`. */
const WRITINGS = {
  en: {
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strike: 'Strike',
    code: 'Code',
    link: 'Link',
    quote: 'Quote',
    heading: 'Heading',
    subheading: 'Subheading',
    bulleted: 'Bulleted',
    numbered: 'Numbered',
    source: 'Source',
    addBlock: 'Add a block',
  },
  es: {
    bold: 'Negrita',
    italic: 'Cursiva',
    underline: 'Subrayado',
    strike: 'Tachado',
    code: 'Código',
    link: 'Enlace',
    quote: 'Cita',
    heading: 'Título',
    subheading: 'Subtítulo',
    bulleted: 'Viñetas',
    numbered: 'Numerada',
    source: 'Fuente',
    addBlock: 'Añadir un bloque',
  },
  fr: {
    bold: 'Gras',
    italic: 'Italique',
    underline: 'Souligné',
    strike: 'Barré',
    code: 'Code',
    link: 'Lien',
    quote: 'Citation',
    heading: 'Titre',
    subheading: 'Sous-titre',
    bulleted: 'Puces',
    numbered: 'Numérotée',
    source: 'Source',
    addBlock: 'Ajouter un bloc',
  },
  zh: {
    bold: '粗体',
    italic: '斜体',
    underline: '下划线',
    strike: '删除线',
    code: '代码',
    link: '链接',
    quote: '引用',
    heading: '标题',
    subheading: '副标题',
    bulleted: '项目符号',
    numbered: '编号',
    source: '源码',
    addBlock: '添加块',
  },
} as const

/** The two things done to anything: change it, or throw it away. */
const ACTSES = {
  en: {
    edit: 'Edit',
    delete: 'Delete',
    duplicate: 'Duplicate',
    undo: 'Undo',
    view: 'View',
    list: 'List',
    close: 'Close',
    moveToProject: 'Move to project…',
  },
  es: {
    edit: 'Editar',
    delete: 'Eliminar',
    duplicate: 'Duplicar',
    undo: 'Deshacer',
    view: 'Vista',
    list: 'Lista',
    close: 'Cerrar',
    moveToProject: 'Mover al proyecto…',
  },
  fr: {
    edit: 'Modifier',
    delete: 'Supprimer',
    duplicate: 'Dupliquer',
    undo: 'Annuler',
    view: 'Vue',
    list: 'Liste',
    close: 'Fermer',
    moveToProject: 'Déplacer vers un projet…',
  },
  zh: {
    edit: '编辑',
    delete: '删除',
    duplicate: '复制',
    undo: '撤销',
    view: '查看',
    list: '列表',
    close: '关闭',
    moveToProject: '移动到项目…',
  },
} as const

/**
 * The headings over a section, and the handful of bare words beside them.
 *
 * These are JSX text rather than attributes, which is why they were missed
 * by the first pass: a sweep for `label=` and `placeholder=` finds the
 * controls and not the words between the tags.
 */
const HEADINGS = {
  en: {
    tasks: 'Tasks',
    activity: 'Activity',
    settings: 'Settings',
    tools: 'Tools',
    lists: 'Lists',
    cycles: 'Sprints',
    comments: 'Comments',
    replies: 'Replies',
    projects: 'Projects',
    everyProject: 'All projects',
    notifications: 'Notifications',
    tokens: 'Tokens',
    webhooks: 'Webhooks',
    hours: 'Hours',
    bin: 'Bin',
    archived: 'Archived',
    mentionedIn: 'Mentioned in',
    whoIsOnIt: 'People',
    theProject: 'The project',
    useAsATemplate: 'Use as a template',
    archiveAndDelete: 'Archive and delete',
    securityLog: 'Audit log',
    signedIn: 'Signed in',
    signIn: 'Sign in',
    signOut: 'Sign out',
    newWorkspace: 'New workspace',
    invitationsOut: 'Pending invitations',
    onThem: 'Open tasks',
    messageSomebody: 'Message someone',
    quietFrom: 'Quiet from',
    nobody: 'Nobody',
    none: 'None',
    noCycle: 'No sprint',
    importing: 'Import',
  },
  es: {
    tasks: 'Tareas',
    activity: 'Actividad',
    settings: 'Ajustes',
    tools: 'Herramientas',
    lists: 'Listas',
    cycles: 'Sprints',
    comments: 'Comentarios',
    replies: 'Respuestas',
    projects: 'Proyectos',
    everyProject: 'Todos los proyectos',
    notifications: 'Avisos',
    tokens: 'Tokens',
    webhooks: 'Webhooks',
    hours: 'Horas',
    bin: 'Papelera',
    archived: 'Archivados',
    mentionedIn: 'Mencionado en',
    whoIsOnIt: 'Personas',
    theProject: 'El proyecto',
    useAsATemplate: 'Usar como plantilla',
    archiveAndDelete: 'Archivar y eliminar',
    securityLog: 'Registro de auditoría',
    signedIn: 'Sesiones abiertas',
    signIn: 'Entrar',
    signOut: 'Salir',
    newWorkspace: 'Nuevo espacio',
    invitationsOut: 'Invitaciones pendientes',
    onThem: 'Tareas abiertas',
    messageSomebody: 'Escribir a alguien',
    quietFrom: 'En silencio desde',
    nobody: 'Nadie',
    none: 'Ninguna',
    noCycle: 'Sin sprint',
    importing: 'Importar',
  },
  fr: {
    tasks: 'Tâches',
    activity: 'Activité',
    settings: 'Paramètres',
    tools: 'Outils',
    lists: 'Listes',
    cycles: 'Sprints',
    comments: 'Commentaires',
    replies: 'Réponses',
    projects: 'Projets',
    everyProject: 'Tous les projets',
    notifications: 'Notifications',
    tokens: 'Jetons',
    webhooks: 'Webhooks',
    hours: 'Heures',
    bin: 'Corbeille',
    archived: 'Archivés',
    mentionedIn: 'Mentionné dans',
    whoIsOnIt: 'Personnes',
    theProject: 'Le projet',
    useAsATemplate: 'Utiliser comme modèle',
    archiveAndDelete: 'Archiver et supprimer',
    securityLog: 'Journal d’audit',
    signedIn: 'Sessions ouvertes',
    signIn: 'Se connecter',
    signOut: 'Se déconnecter',
    newWorkspace: 'Nouvel espace de travail',
    invitationsOut: 'Invitations en attente',
    onThem: 'Tâches ouvertes',
    messageSomebody: 'Écrire à quelqu’un',
    quietFrom: 'Silence à partir de',
    nobody: 'Personne',
    none: 'Aucune',
    noCycle: 'Sans sprint',
    importing: 'Importer',
  },
  zh: {
    tasks: '任务',
    activity: '动态',
    settings: '设置',
    tools: '工具',
    lists: '列表',
    cycles: '迭代',
    comments: '评论',
    replies: '回复',
    projects: '项目',
    everyProject: '所有项目',
    notifications: '通知',
    tokens: '令牌',
    webhooks: 'Webhooks',
    hours: '工时',
    bin: '回收站',
    archived: '已归档',
    mentionedIn: '提及于',
    whoIsOnIt: '成员',
    theProject: '项目',
    useAsATemplate: '用作模板',
    archiveAndDelete: '归档与删除',
    securityLog: '审计日志',
    signedIn: '已登录设备',
    signIn: '登录',
    signOut: '退出登录',
    newWorkspace: '新建工作区',
    invitationsOut: '待处理邀请',
    onThem: '未完成任务',
    messageSomebody: '发消息给某人',
    quietFrom: '免打扰开始',
    nobody: '无人',
    none: '无',
    noCycle: '无迭代',
    importing: '导入',
  },
} as const

/**
 * The rest of the buttons, and the shortest of the empty states.
 *
 * A third group because the first two swept attributes and the words
 * between tags on one line, and these are the ones on a line of their own.
 * Three passes for one job, which is what a sweep by pattern costs when the
 * patterns are written after the code.
 */
const MOREY = {
  en: {
    addCycle: 'Add sprint',
    addSubTask: 'Add a sub-task',
    addSomebody: 'Add someone',
    allFiles: 'All files',
    allOfIt: 'All of it',
    archive: 'Archive',
    assign: 'Assign',
    assigned: 'Assigned',
    backToTheLetter: 'Remove picture',
    backToTheChannel: 'Back to the channel',
    backToTheMark: 'Remove picture',
    backToTheProject: 'Back to the project',
    cancel: 'Cancel',
    clear: 'Clear',
    create: 'Create',
    deleteTask: 'Delete task',
    duplicateTask: 'Duplicate task',
    subscribe: 'Subscribe',
    subscribed: 'Subscribed',
    history: 'History',
    language: 'Language',
    logTime: 'Log time',
    makeALink: 'Create a link',
    makeATask: 'Create a task',
    markAllRead: 'Mark all as read',
    newChannel: 'New channel',
    openTheFile: 'Open the file',
    save: 'Save',
    putItBack: 'Unarchive',
    remove: 'Remove',
    removeTheList: 'Remove the list',
    reset: 'Reset',
    seeTheProjects: 'See your projects',
    setUp: 'Set up',
    showMeOne: 'Send a test',
    status: 'Status',
    upload: 'Upload',
    watching: 'Watching',
    yourPicture: 'Your picture',
    profile: 'Profile',
    subTasks: 'Sub-tasks',
    twoFactor: 'Two-factor',
    loading: 'Loading…',
    pickAPerson: 'Pick a person…',
    onlyHere: 'Only on this device.',
    searchTip: 'Search — ⌘K',
    newTaskTip: 'New task — c',
    make: 'Create',
  },
  es: {
    addCycle: 'Añadir sprint',
    addSubTask: 'Añadir una subtarea',
    addSomebody: 'Añadir a alguien',
    allFiles: 'Todos los archivos',
    allOfIt: 'Todo',
    archive: 'Archivar',
    assign: 'Asignar',
    assigned: 'Asignada',
    backToTheLetter: 'Quitar la foto',
    backToTheChannel: 'Volver al canal',
    backToTheMark: 'Quitar la imagen',
    backToTheProject: 'Volver al proyecto',
    cancel: 'Cancelar',
    clear: 'Limpiar',
    create: 'Crear',
    deleteTask: 'Eliminar tarea',
    duplicateTask: 'Duplicar tarea',
    subscribe: 'Suscribirse',
    subscribed: 'Suscrito',
    history: 'Historial',
    language: 'Idioma',
    logTime: 'Anotar horas',
    makeALink: 'Crear un enlace',
    makeATask: 'Crear una tarea',
    markAllRead: 'Marcar todo como leído',
    newChannel: 'Nuevo canal',
    openTheFile: 'Abrir el archivo',
    save: 'Guardar',
    putItBack: 'Desarchivar',
    remove: 'Quitar',
    removeTheList: 'Quitar la lista',
    reset: 'Restablecer',
    seeTheProjects: 'Ver tus proyectos',
    setUp: 'Configurar',
    showMeOne: 'Enviar una prueba',
    status: 'Estado',
    upload: 'Subir',
    watching: 'Siguiendo',
    yourPicture: 'Tu foto',
    profile: 'Perfil',
    subTasks: 'Subtareas',
    twoFactor: 'Doble factor',
    loading: 'Cargando…',
    pickAPerson: 'Elige a alguien…',
    onlyHere: 'Solo en este dispositivo.',
    searchTip: 'Buscar — ⌘K',
    newTaskTip: 'Nueva tarea — c',
    make: 'Crear',
  },
  fr: {
    addCycle: 'Ajouter un sprint',
    addSubTask: 'Ajouter une sous-tâche',
    addSomebody: 'Ajouter quelqu’un',
    allFiles: 'Tous les fichiers',
    allOfIt: 'Tout',
    archive: 'Archiver',
    assign: 'Attribuer',
    assigned: 'Attribuée',
    backToTheLetter: 'Retirer la photo',
    backToTheChannel: 'Retour au canal',
    backToTheMark: 'Retirer l’image',
    backToTheProject: 'Retour au projet',
    cancel: 'Annuler',
    clear: 'Effacer',
    create: 'Créer',
    deleteTask: 'Supprimer la tâche',
    duplicateTask: 'Dupliquer la tâche',
    subscribe: 'Suivre',
    subscribed: 'Suivie',
    history: 'Historique',
    language: 'Langue',
    logTime: 'Saisir du temps',
    makeALink: 'Créer un lien',
    makeATask: 'Créer une tâche',
    markAllRead: 'Tout marquer comme lu',
    newChannel: 'Nouveau canal',
    openTheFile: 'Ouvrir le fichier',
    save: 'Enregistrer',
    putItBack: 'Désarchiver',
    remove: 'Retirer',
    removeTheList: 'Retirer la liste',
    reset: 'Réinitialiser',
    seeTheProjects: 'Voir vos projets',
    setUp: 'Configurer',
    showMeOne: 'Envoyer un test',
    status: 'Statut',
    upload: 'Importer',
    watching: 'Suivi',
    yourPicture: 'Votre photo',
    profile: 'Profil',
    subTasks: 'Sous-tâches',
    twoFactor: 'Authentification à deux facteurs',
    loading: 'Chargement…',
    pickAPerson: 'Choisir quelqu’un…',
    onlyHere: 'Seulement sur cet appareil.',
    searchTip: 'Rechercher — ⌘K',
    newTaskTip: 'Nouvelle tâche — c',
    make: 'Créer',
  },
  zh: {
    addCycle: '添加迭代',
    addSubTask: '添加子任务',
    addSomebody: '添加成员',
    allFiles: '所有文件',
    allOfIt: '全部',
    archive: '归档',
    assign: '指派',
    assigned: '已指派',
    backToTheLetter: '移除照片',
    backToTheChannel: '返回频道',
    backToTheMark: '移除图片',
    backToTheProject: '返回项目',
    cancel: '取消',
    clear: '清除',
    create: '创建',
    deleteTask: '删除任务',
    duplicateTask: '复制任务',
    subscribe: '订阅',
    subscribed: '已订阅',
    history: '历史',
    language: '语言',
    logTime: '记录工时',
    makeALink: '创建链接',
    makeATask: '创建任务',
    markAllRead: '全部标为已读',
    newChannel: '新建频道',
    openTheFile: '打开文件',
    save: '保存',
    putItBack: '取消归档',
    remove: '移除',
    removeTheList: '移除列表',
    reset: '重置',
    seeTheProjects: '查看你的项目',
    setUp: '设置',
    showMeOne: '发送测试',
    status: '状态',
    upload: '上传',
    watching: '关注中',
    yourPicture: '你的照片',
    profile: '个人资料',
    subTasks: '子任务',
    twoFactor: '双重验证',
    loading: '加载中…',
    pickAPerson: '选择成员…',
    onlyHere: '仅在此设备。',
    searchTip: '搜索 — ⌘K',
    newTaskTip: '新建任务 — c',
    make: '创建',
  },
} as const

/**
 * The sentences: what an empty screen says, and the short warnings.
 *
 * These were held back on the argument that the design asks for copy to be
 * written in the product's tone rather than translated, and a dictionary
 * key for three sentences is how that becomes a calque. That argument is
 * about *how* they are written, not about where they live — and a product
 * that speaks three languages everywhere except its empty screens speaks
 * three languages badly.
 *
 * So they are here, and the warning that applies to the rest applies
 * doubly: these are the lines a person reads when they are already
 * confused, and they are the ones most worth having a native speaker read.
 */
const SAYSES = {
  en: {
    nothingHereYet: 'Nothing here yet.',
    nobodyByThatName: 'No one found.',
    deleted: 'Deleted',
    sortedBy: 'Sorted by',
    nothingPostedYet: 'No announcements yet.',
    nothingSaidYet: 'No messages yet.',
    nothingLogged: 'No time logged yet.',
    nothingWaiting: 'No notifications.',
    nothingYet: 'Nothing yet.',
    nothingOpenHere: 'No open tasks here.',
    nothingHappenedHere: 'No activity yet.',
    noProjectsYet: 'No projects yet.',
    noConversations: 'No conversations.',
    noChannelHere: 'No channel here.',
    noLabelsYet: 'No labels yet.',
    noneYet: 'None yet.',
    none: 'None.',
    pickSomebody: 'Pick someone to see their profile.',
    whenSomethingNeedsYou: 'When something needs you, it shows up here.',
    projectNotHere: 'Project not found.',
    mayBeInAnother: 'It may have been deleted, or it may be in another project.',
    mayBeOneYouAreNotOn: 'It may have been deleted, or you may not have access to it.',
    clearedOutAfterThirty: 'Projects here are deleted for good after 30 days.',
    copyItNow: 'Copy it now. You won’t see it again.',
    singleUse: 'Works once and expires. You won’t see it again.',
    couldNotMakeIt: 'Couldn’t create it. Try again.',
    addToAuthenticator: 'Scan this code with your authenticator app, or add the key under it, then enter the 6-digit code it shows.',
    everyDeliverySigned: 'Each delivery is signed. The signature covers its timestamp, ID and body.',
    tooBigToSend: 'too large to upload',
    people: 'People',
    storage: 'Storage',
    browserWouldNotDraw: 'Your browser didn’t show it. Notifications are no longer allowed for this site.',
    nothingToDrawWith: 'Turn on notifications first.',
    tellMeAboutChat: 'Also notify me about chat messages',
    enterToKeep: 'Enter to save · Escape to cancel',
    nothingIsNumber: 'Nothing here has the number',
    chat: 'Chat',
    time: 'Time',
  },
  es: {
    nothingHereYet: 'Aquí no hay nada todavía.',
    nobodyByThatName: 'No se encontró a nadie.',
    deleted: 'Eliminada',
    sortedBy: 'Ordenado por',
    nothingPostedYet: 'Aún no hay anuncios.',
    nothingSaidYet: 'Aún no hay mensajes.',
    nothingLogged: 'Aún no hay horas anotadas.',
    nothingWaiting: 'No hay avisos.',
    nothingYet: 'Nada todavía.',
    nothingOpenHere: 'No hay tareas abiertas aquí.',
    nothingHappenedHere: 'Aún no hay actividad.',
    noProjectsYet: 'Ningún proyecto todavía.',
    noConversations: 'Sin conversaciones.',
    noChannelHere: 'Sin canal aquí.',
    noLabelsYet: 'Sin etiquetas todavía.',
    noneYet: 'Ninguno todavía.',
    none: 'Ninguno.',
    pickSomebody: 'Elige a alguien para ver su perfil.',
    whenSomethingNeedsYou: 'Cuando algo te necesite, aparecerá aquí.',
    projectNotHere: 'No se encontró el proyecto.',
    mayBeInAnother: 'Puede que se haya eliminado, o que esté en otro proyecto.',
    mayBeOneYouAreNotOn: 'Puede que se haya eliminado, o que no tengas acceso.',
    clearedOutAfterThirty: 'Los proyectos de aquí se eliminan para siempre a los 30 días.',
    copyItNow: 'Cópialo ahora. No volverás a verlo.',
    singleUse: 'Sirve una sola vez y caduca. No volverás a verlo.',
    couldNotMakeIt: 'No se pudo crear. Inténtalo de nuevo.',
    addToAuthenticator:
      'Escanea este código con tu app de autenticación, o añade la clave de debajo, y escribe el código de 6 dígitos que muestre.',
    everyDeliverySigned: 'Cada entrega va firmada. La firma cubre su marca de tiempo, su ID y su cuerpo.',
    tooBigToSend: 'demasiado grande para subirlo',
    people: 'Personas',
    storage: 'Almacenamiento',
    browserWouldNotDraw: 'Tu navegador no lo mostró. Este sitio ya no tiene permiso para mostrar avisos.',
    nothingToDrawWith: 'Activa los avisos primero.',
    tellMeAboutChat: 'Avisarme también de los mensajes del chat',
    enterToKeep: 'Enter para guardar · Escape para cancelar',
    nothingIsNumber: 'Aquí no hay nada con el número',
    chat: 'Chat',
    time: 'Tiempo',
  },
  fr: {
    nothingHereYet: 'Rien ici pour l’instant.',
    nobodyByThatName: 'Aucune personne trouvée.',
    deleted: 'Supprimée',
    sortedBy: 'Trié par',
    nothingPostedYet: 'Aucune annonce pour l’instant.',
    nothingSaidYet: 'Aucun message pour l’instant.',
    nothingLogged: 'Aucun temps saisi pour l’instant.',
    nothingWaiting: 'Aucune notification.',
    nothingYet: 'Rien pour l’instant.',
    nothingOpenHere: 'Aucune tâche ouverte ici.',
    nothingHappenedHere: 'Aucune activité pour l’instant.',
    noProjectsYet: 'Aucun projet pour l’instant.',
    noConversations: 'Aucune conversation.',
    noChannelHere: 'Aucun canal ici.',
    noLabelsYet: 'Aucune étiquette pour l’instant.',
    noneYet: 'Aucun pour l’instant.',
    none: 'Aucun.',
    pickSomebody: 'Choisissez quelqu’un pour voir son profil.',
    whenSomethingNeedsYou: 'Quand quelque chose vous attend, cela apparaît ici.',
    projectNotHere: 'Projet introuvable.',
    mayBeInAnother: 'Il a peut-être été supprimé, ou il est dans un autre projet.',
    mayBeOneYouAreNotOn: 'Il a peut-être été supprimé, ou vous n’y avez pas accès.',
    clearedOutAfterThirty: 'Les projets ici sont supprimés définitivement au bout de 30 jours.',
    copyItNow: 'Copiez-le maintenant. Vous ne le reverrez plus.',
    singleUse: 'Valable une seule fois, et il expire. Vous ne le reverrez plus.',
    couldNotMakeIt: 'Création impossible. Réessayez.',
    addToAuthenticator:
      'Scannez ce code avec votre application d’authentification, ou ajoutez la clé en dessous, puis saisissez le code à 6 chiffres qu’elle affiche.',
    everyDeliverySigned: 'Chaque envoi est signé. La signature couvre son horodatage, son identifiant et son contenu.',
    tooBigToSend: 'trop volumineux pour être importé',
    people: 'Personnes',
    storage: 'Stockage',
    browserWouldNotDraw: 'Votre navigateur ne l’a pas affichée. Les notifications ne sont plus autorisées pour ce site.',
    nothingToDrawWith: 'Activez d’abord les notifications.',
    tellMeAboutChat: 'Me prévenir aussi pour les messages de discussion',
    enterToKeep: 'Entrée pour enregistrer · Échap pour annuler',
    nothingIsNumber: 'Rien ici ne porte le numéro',
    chat: 'Discussion',
    time: 'Temps',
  },
  zh: {
    nothingHereYet: '这里还没有内容。',
    nobodyByThatName: '没有找到成员。',
    deleted: '已删除',
    sortedBy: '排序：',
    nothingPostedYet: '还没有公告。',
    nothingSaidYet: '还没有消息。',
    nothingLogged: '还没有记录工时。',
    nothingWaiting: '没有通知。',
    nothingYet: '还没有内容。',
    nothingOpenHere: '这里没有未完成任务。',
    nothingHappenedHere: '还没有动态。',
    noProjectsYet: '还没有项目。',
    noConversations: '没有对话。',
    noChannelHere: '这里没有频道。',
    noLabelsYet: '还没有标签。',
    noneYet: '还没有。',
    none: '无。',
    pickSomebody: '选择成员以查看其资料。',
    whenSomethingNeedsYou: '有需要你处理的事项时，会显示在这里。',
    projectNotHere: '未找到项目。',
    mayBeInAnother: '它可能已被删除，或在其他项目中。',
    mayBeOneYouAreNotOn: '它可能已被删除，或你没有访问权限。',
    clearedOutAfterThirty: '这里的项目将在 30 天后永久删除。',
    copyItNow: '请立即复制，之后将不再显示。',
    singleUse: '仅可使用一次并会过期，之后将不再显示。',
    couldNotMakeIt: '创建失败，请重试。',
    addToAuthenticator: '用身份验证器应用扫描此二维码，或在下方添加密钥，然后输入显示的 6 位验证码。',
    everyDeliverySigned: '每次投递都会签名，签名涵盖时间戳、ID 和正文。',
    tooBigToSend: '文件过大，无法上传',
    people: '成员',
    storage: '存储',
    browserWouldNotDraw: '浏览器未显示通知。此站点已不再允许通知。',
    nothingToDrawWith: '请先开启通知。',
    tellMeAboutChat: '聊天消息也通知我',
    enterToKeep: '回车保存 · Esc 取消',
    nothingIsNumber: '这里没有编号为这个的对象',
    chat: '聊天',
    time: '时间',
  },
} as const

/** The language this page was built in — read once, like everything above. */
export const now = tongue()

/**
 * The locale dates and numbers are written in, so a month is named in the
 * language the rest of the screen speaks. British English rather than the
 * machine's own: the product has always written "3 Mar", and a browser set
 * to American English was not asking for "Mar 3" on a screen that says
 * "Sprint" and "Colour".
 */
export const LOCALE = now === 'fr' ? 'fr-FR' : now === 'zh' ? 'zh-CN' : 'en-GB'

/**
 * The locale a time of day is written in. English leaves it to the machine,
 * which knows whether its person reads "14:05" or "2:05 PM"; French writes
 * the twenty-four hours, whatever the machine was set up for.
 */
export const CLOCK: string[] = now === 'fr' ? ['fr-FR'] : []

const SHORT_MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
}

/**
 * `5 Oct`, `5 oct.` — a day and its month, and the year when asked for.
 *
 * Written out rather than left to `toLocaleDateString`, which in British
 * English has started saying "Sept", and a product that wrote "Sep" for a
 * year changing its mind on a browser update is a screen moving under the
 * reader. The long form has no such quirk and is the locale's own.
 */
export function dayMonth(d: Date, year = false): string {
  if (now === 'zh') return `${year ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日`
  const months = SHORT_MONTHS[now === 'fr' ? 'fr' : 'en']
  /* The first of the month is "1er" in French. */
  const day = now === 'fr' && d.getDate() === 1 ? '1er' : String(d.getDate())
  return `${day} ${months[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ''}`
}

/** `5 October`, `5 octobre`, and the year when asked for. */
export function dayMonthLong(d: Date, year = false): string {
  const said = d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) })
  /* "1er novembre": the locale writes the first of the month as any other day. */
  return now === 'fr' && d.getDate() === 1 ? said.replace(/^1(?=\D)/, '1er') : said
}

/**
 * A screen's own words, each with its French beside it.
 *
 * `{ save: ['Save', 'Enregistrer'] }` — the English first and the French
 * next to it on the same line, because the person reading the French is
 * reading it against the English, and two blocks a screen apart is how a
 * key gets one language and not the other. A sentence with something in it
 * is a function, and the French one takes the same arguments — the type
 * says so, so a word missing in one language is a build that fails rather
 * than a screen that shows a key.
 *
 * The grouped dictionaries above came first and keep their three columns;
 * everything lifted out since lives under `web/src/words/`, a file a
 * screen.
 */
export function say<T extends Record<string, unknown>>(words: { [K in keyof T]: readonly [T[K], NoInfer<T[K]>, NoInfer<T[K]>?] }): T {
  const out = {} as T
  /* English first, French second, Simplified Chinese third. A line whose
     Chinese has not been written yet says its English, so a screen is
     never half in a language nobody speaks. */
  const at = now === 'fr' ? 1 : now === 'zh' ? 2 : 0
  for (const k in words) out[k] = words[k][at] ?? words[k][0]
  return out
}

/**
 * One or many. French counts nothing and one as one — "0 tâche", "1 tâche",
 * "2 tâches" — and English counts only one as one.
 */
export const one = (n: number): boolean => (now === 'fr' ? Math.abs(n) < 2 : n === 1)

export const BAR = BARS[now]
export const PLACES = PLACESES[now]
export const MAKE = MAKES[now]
export const FACTS = FACTSES[now]
export const PROJECT = PROJECTS[now]
export const WRITING = WRITINGS[now]
export const ACTS = ACTSES[now]
export const HEADS = HEADINGS[now]
export const MORE = MOREY[now]
export const SAYS = SAYSES[now]

/** What each language calls itself, for the switch. */
export const TONGUES: { id: Chosen; said: string }[] = [
  { id: 'system', said: now === 'fr' ? 'Système' : now === 'zh' ? '系统' : 'System' },
  { id: 'en', said: 'English' },
  { id: 'fr', said: 'Français' },
  { id: 'zh', said: '简体中文' },
]
