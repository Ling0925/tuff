import { say } from '../data/words.js'

/** The body being written: its blocks, its bars and the files in it — `ui/Editor.tsx`. */
export const EDITOR = say({
  /* A file in the body. */
  uploading: [(percent: number) => `Uploading · ${percent}%`, (percent: number) => `Importation · ${percent} %`],
  downloadName: [(name: string) => `Download ${name}`, (name: string) => `Télécharger ${name}`],
  download: ['Download', 'Télécharger'],
  removeName: [(name: string) => `Remove ${name}`, (name: string) => `Retirer ${name}`],
  remove: ['Remove', 'Retirer'],
  openName: [(name: string) => `Open ${name}`, (name: string) => `Ouvrir ${name}`],
  open: ['Open', 'Ouvrir'],

  /* Files held over the screen a body is on — `docs/specs/drop-files.md`. */
  dropIntoPost: ['Drop to add to the announcement', 'Déposez pour ajouter à l’annonce'],
  dropIntoDescription: ['Drop to add to the description', 'Déposez pour ajouter à la description'],
  dropIntoDocument: ['Drop to add to the document', 'Déposez pour ajouter au document'],

  /* The blocks `/` and `+` offer. What is typed after the slash narrows
     them by these words. */
  heading: ['Heading', 'Titre'],
  subheading: ['Subheading', 'Sous-titre'],
  bulletedList: ['Bulleted list', 'Liste à puces'],
  numberedList: ['Numbered list', 'Liste numérotée'],
  quote: ['Quote', 'Citation'],
  codeBlock: ['Code block', 'Bloc de code'],
  divider: ['Divider', 'Séparateur'],
  table: ['Table', 'Tableau'],
  link: ['Link', 'Lien'],
  pictureOrFile: ['Picture or file', 'Image ou fichier'],
  /* A chip for a doc or a task of the project.
     Notion's "Link to page", with the chat's "doc"; the French a button's
     infinitive, as "Mentionner un document" is. `linkToFind` is what else
     typed after the slash finds it. */
  linkTo: ['Link to a doc or task', 'Lier un document ou une tâche'],
  linkToFind: ['page document mention', 'page lien mentionner'],
  /* Under # when nothing in the project matches what was typed. */
  noLinkable: ['No matching docs or tasks', 'Aucun document ni aucune tâche correspondant'],
  /* Two blocks that stand out and fold away. The
     words Notion uses for them in each language. */
  callout: ['Callout', 'Encadré'],
  toggle: ['Toggle', 'Bloc dépliant'],
  /* On the bar over chosen words.
     Google Docs' and Asana's French. */
  comment: ['Comment', 'Commenter'],
  makeTask: ['Make a task', 'Créer une tâche'],
  /* The chip a line became. */
  makingTask: ['Making…', 'Création…'],
  completeTask: ['Mark complete', 'Marquer comme terminée'],
  reopenTask: ['Mark incomplete', 'Marquer comme non terminée'],
  /* The first words of a task made from a document's line, before the document. */
  fromDocument: ['From', 'Depuis'],
  /* A callout's emoji, pressed: its look. */
  calloutLook: ['Change the icon and colour', 'Changer l’icône et la couleur'],
  tones: ['Colour', 'Couleur'],
  toneGrey: ['Grey', 'Gris'],
  toneBlue: ['Blue', 'Bleu'],
  toneGreen: ['Green', 'Vert'],
  toneYellow: ['Yellow', 'Jaune'],
  toneRed: ['Red', 'Rouge'],
  /* A toggle's own arrow, and what its empty first line says. */
  openToggle: ['Show what’s inside', 'Afficher le contenu'],
  foldToggle: ['Hide what’s inside', 'Masquer le contenu'],
  toggleTitle: ['Toggle', 'Bloc dépliant'],
  toggleEmpty: ['Empty toggle. Write inside it.', 'Bloc dépliant vide. Écrivez à l’intérieur.'],
  /* The headings beside a long document. */
  outline: ['On this page', 'Sur cette page'],

  /* A table's own tools, on the bar over it and on a phone's dock. */
  addRow: ['Add a row', 'Ajouter une ligne'],
  addColumn: ['Add a column', 'Ajouter une colonne'],
  removeRow: ['Remove the row', 'Supprimer la ligne'],
  removeColumn: ['Remove the column', 'Supprimer la colonne'],
  deleteTable: ['Delete the table', 'Supprimer le tableau'],
  headerRow: ['Header row', 'Ligne d’en-tête'],
  header: ['Header', 'En-tête'],
  plusRow: ['+ Row', '+ Ligne'],
  plusColumn: ['+ Column', '+ Colonne'],
  minusRow: ['− Row', '− Ligne'],
  minusColumn: ['− Column', '− Colonne'],
  /* The same on the phone's dock, where there is less room. */
  plusRowShort: ['+Row', '+Ligne'],
  plusColShort: ['+Col', '+Col'],
  minusRowShort: ['−Row', '−Ligne'],
  minusColShort: ['−Col', '−Col'],

  /* The phone's dock. */
  back: ['Back', 'Retour'],
  text: ['Text', 'Texte'],
  styles: ['Styles', 'Styles'],

  /* A link written over the words it goes on. */
  pasteLink: ['Paste or type a link', 'Collez ou saisissez un lien'],
  removeLink: ['Remove link', 'Retirer le lien'],
  applyLink: ['Apply link', 'Appliquer le lien'],
  apply: ['Apply', 'Appliquer'],
})
