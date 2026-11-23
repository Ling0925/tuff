import { say } from '../data/words.js'

/**
 * Starting a document from a shape, and saving one as a shape.
 * The words inside the four built in are
 * the shared schema's (`DOC_TEMPLATES`), in both languages; these are what
 * the screen calls them. "Template" and "modèle", as Notion and Google Docs
 * say it in each language.
 */
export const DOC_TEMPLATE = say({
  templates: ['Templates', 'Modèles', '模板'],
  template: ['Template', 'Modèle', '模板'],
  /* The four built in, as the menu names them. */
  brief: ['Brief', 'Brief', '简报'],
  meeting: ['Meeting notes', 'Compte rendu', '会议记录'],
  spec: ['Spec', 'Spécification', '规格说明'],
  report: ['Client report', 'Rapport client', '客户报告'],
  /* One saved by somebody here, and the project it lives in. */
  inProject: [(name: string) => `In ${name}`, (name: string) => `Dans ${name}`, (name: string) => `在 ${name} 中`],
  /* On a document's ⋯. */
  saveAsTemplate: ['Save as template', 'Enregistrer comme modèle', '保存为模板'],
  savedAsTemplate: ['Saved as a template', 'Enregistré comme modèle', '已保存为模板'],
  noLongerTemplate: ['No longer a template', 'Ne sert plus de modèle', '已不再作为模板'],
  couldNotSave: ['Couldn’t save it as a template', 'Impossible de l’enregistrer comme modèle', '无法将其保存为模板'],
})
