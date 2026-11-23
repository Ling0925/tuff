import { say } from '../data/words.js'

/** A document, opened — `ui/FileDetail.tsx`. */
export const FILE_DETAIL = say({
  back: ['Back to Files', 'Retour aux fichiers', '返回文件'],
  /* What a document wears — `docs/specs/docs.md`, "A document's mark". */
  changeLook: ['Change icon and colour', 'Changer l’icône et la couleur', '更改图标和颜色'],
  itsIcon: ['Icon', 'Icône', '图标'],
  itsColour: ['Colour', 'Couleur', '颜色'],
  ownLook: ['Default', 'Par défaut', '默认'],
  /* Following it. As a task's pill says it. */
  subscribe: ['Subscribe', 'Suivre', '订阅'],
  subscribed: ['Subscribed', 'Suivi', '已订阅'],
  gone: [
    'This document isn’t available. It may have been deleted, or it’s in a project you’re not on.',
    'Ce document n’est pas disponible. Il a peut-être été supprimé, ou il se trouve dans un projet dont vous ne faites pas partie.',
    '此文档不可用。它可能已被删除，或位于你未加入的项目中。',
  ],
  version: [(n: number) => `Version ${n}`, (n: number) => `Version ${n}`, (n: number) => `版本 ${n}`],
  /* In the PDF's line of facts, after the author. */
  versionFact: [(n: number) => `version ${n}`, (n: number) => `version ${n}`, (n: number) => `版本 ${n}`],
  unsaved: [
    'Couldn’t save. Try again — your changes are still here.',
    'Impossible d’enregistrer. Réessayez — vos modifications sont toujours là.',
    '保存失败。请重试——你的修改仍在。',
  ],
  /* Written together, with the connection down. */
  offline: [
    'Offline. Your changes will save when you reconnect.',
    'Hors ligne. Vos modifications seront enregistrées à la reconnexion.',
    '离线。重新连接后将保存修改。',
  ],
  full: [
    'This document is too large to add more. Remove something to keep writing.',
    'Ce document est trop volumineux pour en ajouter davantage. Supprimez du contenu pour continuer.',
    '此文档已太大，无法继续添加。请删除一些内容再继续书写。',
  ],
  outOfDate: [
    'This page is out of date. Reload to keep editing.',
    'Cette page n’est plus à jour. Rechargez-la pour continuer à modifier.',
    '此页面已过期。请重新加载后继续编辑。',
  ],
  more: ['More', 'Plus d’options', '更多'],
  linkCopied: ['Link copied', 'Lien copié', '已复制链接'],
  publicLinkCopied: ['Public link copied', 'Lien public copié', '已复制公开链接'],
  couldNotCopy: ['Couldn’t copy link', 'Impossible de copier le lien', '无法复制链接'],
  noLongerShared: ['No longer shared', 'Partage désactivé', '已取消共享'],
  couldNotShare: ['Couldn’t change sharing', 'Impossible de modifier le partage', '无法更改共享设置'],
  copyLink: ['Copy link', 'Copier le lien', '复制链接'],
  /* A link's address, changed on its screen — `docs/specs/docs.md`. */
  changeLink: ['Change', 'Modifier', '更改'],
  linkAddress: ['Link address', 'Adresse du lien', '链接地址'],
  linkNeedsHttp: [
    'Use an address that starts with http:// or https://.',
    'Utilisez une adresse qui commence par http:// ou https://.',
    '请使用以 http:// 或 https:// 开头的地址。',
  ],
  couldntChangeLink: ['Couldn’t change the address. Try again.', 'Impossible de modifier l’adresse. Réessayez.', '无法更改地址，请重试。'],
  shareToWeb: ['Share to web', 'Partager sur le web', '共享到网络'],
  copyPublicLink: ['Copy public link', 'Copier le lien public', '复制公开链接'],
  exportPdf: ['Export PDF', 'Exporter en PDF', '导出 PDF'],
  /* Who a document is for. As Notion and
     Google Docs say it: Publish, Share, Only you. */
  publish: ['Publish', 'Publier', '发布'],
  draftOnlyYou: ['Only you can see this draft', 'Vous seul pouvez voir ce brouillon', '只有你能看到此草稿'],
  /* Pictures it shows that were put in before it was private. */
  loosePictures: [
    'Pictures added before it was private are still visible to the project.',
    'Les images ajoutées avant qu’il soit privé restent visibles par le projet.',
    '在设为私有之前添加的图片仍对该项目可见。',
  ],
  whoCanSee: ['Who can see it', 'Qui peut le voir', '谁可以看到'],
  everyoneOnProject: ['Everyone on the project', 'Toutes les personnes du projet', '项目中的所有成员'],
  /* The two halves of the panel's choice, short enough for one line each. */
  wholeProject: ['Whole project', 'Tout le projet', '整个项目'],
  chosenPeople: ['Chosen people', 'Personnes choisies', '选定成员'],
  /* Under an agent in the list of who can see it: whose agent it is. */
  agentOf: [(name: string) => `${name}’s agent`, (name: string) => `Agent de ${name}`, (name: string) => `${name} 的代理`],
  onlyYou: ['Only you', 'Vous seul', '仅你'],
  sharedWith: [
    (n: number) => (n === 1 ? 'Shared with 1 person' : `Shared with ${n} people`),
    (n: number) => (n === 1 ? 'Partagé avec 1 personne' : `Partagé avec ${n} personnes`),
    (n: number) => `已与 ${n} 人共享`,
  ],
  draft: ['Draft', 'Brouillon', '草稿'],
  /* A document named somewhere it is not seen: its chip, with no name. */
  privateDocument: ['Private document', 'Document privé', '私有文档'],
  published: ['Published', 'Publié', '已发布'],
  accessSaved: ['Saved', 'Enregistré', '已保存'],
  couldNotPublish: ['Couldn’t publish. Try again.', 'Impossible de publier. Réessayez.', '无法发布，请重试。'],
  /* The project's instructions for agents.
     The switch on the ⋯ menu, the label by the title and in Docs, and
     what is said beside the menu after a press. */
  forAgents: ['For agents', 'Pour les agents', '供代理使用'],
  agentsReadThis: ['Agents on this project read this first', 'Les agents du projet lisent ceci en premier', '此项目的代理会先阅读此内容'],
  agentsReadThisInstead: [
    'Agents on this project read this first now, instead of the last one',
    'Les agents du projet lisent désormais ceci en premier, à la place du précédent',
    '此项目的代理现在会先阅读此内容，取代上一份',
  ],
  noLongerForAgents: ['No longer for agents', 'Ne sert plus aux agents', '不再供代理使用'],
  couldNotForAgents: ['Couldn’t change it. Try again.', 'Impossible de le modifier. Réessayez.', '无法更改，请重试。'],
})
