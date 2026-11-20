import { say } from '../data/words.js'

/**
 * Starting a document from a shape, and saving one as a shape.
 * The words inside the four built in are
 * the shared schema's (`DOC_TEMPLATES`), in both languages; these are what
 * the screen calls them. "Template" and "modèle", as Notion and Google Docs
 * say it in each language.
 */
export const DOC_TEMPLATE = say({
  templates: ['Templates', 'Modèles'],
  template: ['Template', 'Modèle'],
  /* The four built in, as the menu names them. */
  brief: ['Brief', 'Brief'],
  meeting: ['Meeting notes', 'Compte rendu'],
  spec: ['Spec', 'Spécification'],
  report: ['Client report', 'Rapport client'],
  /* One saved by somebody here, and the project it lives in. */
  inProject: [(name: string) => `In ${name}`, (name: string) => `Dans ${name}`],
  /* On a document's ⋯. */
  saveAsTemplate: ['Save as template', 'Enregistrer comme modèle'],
  savedAsTemplate: ['Saved as a template', 'Enregistré comme modèle'],
  noLongerTemplate: ['No longer a template', 'Ne sert plus de modèle'],
  couldNotSave: ['Couldn’t save it as a template', 'Impossible de l’enregistrer comme modèle'],
})
