import { say } from '../data/words.js'

/** The body being written: its blocks, its bars and the files in it — `ui/Editor.tsx`. */
export const EDITOR = say({
  /* A file in the body. */
  uploading: [
    (percent: number) => `Uploading · ${percent}%`,
    (percent: number) => `Importation · ${percent} %`,
    (percent: number) => `上传中 · ${percent}%`,
  ],
  downloadName: [(name: string) => `Download ${name}`, (name: string) => `Télécharger ${name}`, (name: string) => `下载 ${name}`],
  download: ['Download', 'Télécharger', '下载'],
  removeName: [(name: string) => `Remove ${name}`, (name: string) => `Retirer ${name}`, (name: string) => `移除 ${name}`],
  remove: ['Remove', 'Retirer', '移除'],
  openName: [(name: string) => `Open ${name}`, (name: string) => `Ouvrir ${name}`, (name: string) => `打开 ${name}`],
  open: ['Open', 'Ouvrir', '打开'],
  removeCodeBlock: ['Remove code block', 'Retirer le bloc de code', '移除代码块'],

  /* Files held over the screen a body is on — `docs/specs/drop-files.md`. */
  dropIntoPost: ['Drop to add to the announcement', 'Déposez pour ajouter à l’annonce', '拖放以添加到公告'],
  dropIntoDescription: ['Drop to add to the description', 'Déposez pour ajouter à la description', '拖放以添加到描述'],
  dropIntoDocument: ['Drop to add to the document', 'Déposez pour ajouter au document', '拖放以添加到文档'],

  /* The blocks `/` and `+` offer. What is typed after the slash narrows
     them by these words. */
  heading: ['Heading', 'Titre', '标题'],
  subheading: ['Subheading', 'Sous-titre', '副标题'],
  bulletedList: ['Bulleted list', 'Liste à puces', '项目符号列表'],
  numberedList: ['Numbered list', 'Liste numérotée', '编号列表'],
  quote: ['Quote', 'Citation', '引用'],
  codeBlock: ['Code block', 'Bloc de code', '代码块'],
  divider: ['Divider', 'Séparateur', '分隔线'],
  table: ['Table', 'Tableau', '表格'],
  link: ['Link', 'Lien', '链接'],
  pictureOrFile: ['Picture or file', 'Image ou fichier', '图片或文件'],
  /* Two blocks that stand out and fold away. The
     words Notion uses for them in each language. */
  callout: ['Callout', 'Encadré', '提示框'],
  toggle: ['Toggle', 'Bloc dépliant', '折叠块'],
  /* On the bar over chosen words.
     Google Docs' and Asana's French. */
  comment: ['Comment', 'Commenter', '评论'],
  makeTask: ['Make a task', 'Créer une tâche', '创建任务'],
  /* The chip a line became. */
  makingTask: ['Making…', 'Création…', '创建中…'],
  completeTask: ['Mark complete', 'Marquer comme terminée', '标记为完成'],
  reopenTask: ['Mark incomplete', 'Marquer comme non terminée', '标记为未完成'],
  /* The first words of a task made from a document's line, before the document. */
  fromDocument: ['From', 'Depuis', '来源'],
  /* A callout's emoji, pressed: its look. */
  calloutLook: ['Change the icon and colour', 'Changer l’icône et la couleur', '更改图标和颜色'],
  tones: ['Colour', 'Couleur', '颜色'],
  toneGrey: ['Grey', 'Gris', '灰色'],
  toneBlue: ['Blue', 'Bleu', '蓝色'],
  toneGreen: ['Green', 'Vert', '绿色'],
  toneYellow: ['Yellow', 'Jaune', '黄色'],
  toneRed: ['Red', 'Rouge', '红色'],
  /* A toggle's own arrow, and what its empty first line says. */
  openToggle: ['Show what’s inside', 'Afficher le contenu', '显示内容'],
  foldToggle: ['Hide what’s inside', 'Masquer le contenu', '隐藏内容'],
  toggleTitle: ['Toggle', 'Bloc dépliant', '折叠块'],
  toggleEmpty: ['Empty toggle. Write inside it.', 'Bloc dépliant vide. Écrivez à l’intérieur.', '空折叠块。在里面书写。'],
  /* The headings beside a long document. */
  outline: ['On this page', 'Sur cette page', '本页内容'],

  /* A table's own tools, on the bar over it and on a phone's dock. */
  addRow: ['Add a row', 'Ajouter une ligne', '添加行'],
  addColumn: ['Add a column', 'Ajouter une colonne', '添加列'],
  removeRow: ['Remove the row', 'Supprimer la ligne', '删除行'],
  removeColumn: ['Remove the column', 'Supprimer la colonne', '删除列'],
  deleteTable: ['Delete the table', 'Supprimer le tableau', '删除表格'],
  headerRow: ['Header row', 'Ligne d’en-tête', '表头行'],
  header: ['Header', 'En-tête', '表头'],
  plusRow: ['+ Row', '+ Ligne', '+ 行'],
  plusColumn: ['+ Column', '+ Colonne', '+ 列'],
  minusRow: ['− Row', '− Ligne', '− 行'],
  minusColumn: ['− Column', '− Colonne', '− 列'],
  /* The same on the phone's dock, where there is less room. */
  plusRowShort: ['+Row', '+Ligne', '+行'],
  plusColShort: ['+Col', '+Col', '+列'],
  minusRowShort: ['−Row', '−Ligne', '−行'],
  minusColShort: ['−Col', '−Col', '−列'],

  /* The phone's dock. */
  back: ['Back', 'Retour', '返回'],
  text: ['Text', 'Texte', '文本'],
  styles: ['Styles', 'Styles', '样式'],

  /* A link written over the words it goes on. */
  pasteLink: ['Paste or type a link', 'Collez ou saisissez un lien', '粘贴或输入链接'],
  removeLink: ['Remove link', 'Retirer le lien', '移除链接'],
  applyLink: ['Apply link', 'Appliquer le lien', '应用链接'],
  apply: ['Apply', 'Appliquer', '应用'],
})
