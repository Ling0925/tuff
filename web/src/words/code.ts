import { say } from '../data/words.js'

/** A code block's bar: its language, how it is drawn, and Copy. */
export const CODE = say({
  /* The language list's first answer: the highlighter guesses. */
  autoDetect: ['Auto detect', 'Détection automatique'],
  /* What the language button is, for a screen reader. */
  language: ['Language', 'Langage'],
  /* The sliders: how the block is drawn. VS Code's French for both. */
  options: ['Display options', 'Options d’affichage'],
  wrapLines: ['Wrap lines', 'Retour à la ligne automatique'],
  lineNumbers: ['Show line numbers', 'Afficher les numéros de ligne'],
  copy: ['Copy', 'Copier'],
  copied: ['Copied', 'Copié'],
  remove: ['Remove code block', 'Retirer le bloc de code'],
})

/*
 * The languages by the names their own projects give them — the same in
 * French, but for the one that is not a language.
 */
export const LANGUAGE_NAMES = say({
  bash: ['Bash', 'Bash'],
  c: ['C', 'C'],
  cpp: ['C++', 'C++'],
  csharp: ['C#', 'C#'],
  css: ['CSS', 'CSS'],
  diff: ['Diff', 'Diff'],
  go: ['Go', 'Go'],
  graphql: ['GraphQL', 'GraphQL'],
  html: ['HTML', 'HTML'],
  ini: ['INI', 'INI'],
  java: ['Java', 'Java'],
  javascript: ['JavaScript', 'JavaScript'],
  json: ['JSON', 'JSON'],
  kotlin: ['Kotlin', 'Kotlin'],
  less: ['Less', 'Less'],
  lua: ['Lua', 'Lua'],
  makefile: ['Makefile', 'Makefile'],
  markdown: ['Markdown', 'Markdown'],
  objectivec: ['Objective-C', 'Objective-C'],
  perl: ['Perl', 'Perl'],
  php: ['PHP', 'PHP'],
  plaintext: ['Plain text', 'Texte brut'],
  python: ['Python', 'Python'],
  r: ['R', 'R'],
  ruby: ['Ruby', 'Ruby'],
  rust: ['Rust', 'Rust'],
  scss: ['SCSS', 'SCSS'],
  sh: ['Shell', 'Shell'],
  sql: ['SQL', 'SQL'],
  swift: ['Swift', 'Swift'],
  toml: ['TOML', 'TOML'],
  typescript: ['TypeScript', 'TypeScript'],
  vbnet: ['Visual Basic .NET', 'Visual Basic .NET'],
  xml: ['XML', 'XML'],
  yaml: ['YAML', 'YAML'],
})
