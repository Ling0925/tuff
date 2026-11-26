import { common, createLowlight } from 'lowlight'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { getExtensionField, type Editor } from '@tiptap/react'
import type { Plugin } from '@tiptap/pm/state'
import { languageOf } from './code.js'

/**
 * The highlighter, in a chunk of its own.
 *
 * lowlight with its common grammars, and TipTap's lowlight plugin over it,
 * fetched by `loadLit` in `code.ts` the first time a code block is drawn.
 * Nothing imports this file but that one `import()`.
 */

const lowlight = createLowlight(common)

/*
 * What "Auto detect" chooses between. Every grammar lowlight carries, asked
 * of every block on every keystroke, guessed slower and worse: a JSON
 * object read as JavaScript is fine, a shell line read as Perl is not.
 */
const GUESSED = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'graphql',
  'java',
  'javascript',
  'json',
  'kotlin',
  'makefile',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
]

type Tree = ReturnType<typeof lowlight.highlight>

/*
 * The last answers, by language and words. TipTap's plugin colours every
 * code block of a body again whenever any one of them changes, and a
 * document with ten blocks guessed ten languages per keystroke; the nine
 * nobody touched come from here.
 */
const kept = new Map<string, Tree>()
function remember(key: string, make: () => Tree): Tree {
  const had = kept.get(key)
  if (had) {
    kept.delete(key)
    kept.set(key, had)
    return had
  }
  const tree = make()
  kept.set(key, tree)
  if (kept.size > 200) kept.delete(kept.keys().next().value as string)
  return tree
}

/** The grammar a written language means: a fence's `shell` is Bash, not a terminal's transcript. */
function grammarOf(written: string): string | null {
  const known = languageOf(written)
  if (known) return known.id
  return lowlight.registered(written) ? written : null
}

/** A block's words as lowlight's tree: in its language when it names one lowlight knows, guessed when not. */
export function tree(code: string, written: unknown): Tree {
  const grammar = typeof written === 'string' && written ? grammarOf(written) : null
  return grammar
    ? remember(`${grammar}\u0000${code}`, () => lowlight.highlight(grammar, code))
    : remember(`\u0000${code}`, () => lowlight.highlightAuto(code, { subset: GUESSED }))
}

/** The language a guess came to, by the name lowlight gives it. */
export const guessed = (t: Tree): string | null => (typeof t.data?.language === 'string' ? t.data.language : null)

/** A run of words and the classes it is drawn with. */
export type Run = { text: string; classes: string[] }

/** The tree as runs, cut at each line's end — `Doc` numbers lines by drawing them one by one. */
export function lines(t: Tree): Run[][] {
  const out: Run[][] = [[]]
  const walk = (nodes: Tree['children'], classes: string[]) => {
    for (const n of nodes) {
      if (n.type === 'text') {
        const parts = n.value.split('\n')
        parts.forEach((p, i) => {
          if (i > 0) out.push([])
          if (p) out[out.length - 1]!.push({ text: p, classes })
        })
      } else if (n.type === 'element') {
        const own = Array.isArray(n.properties?.className) ? (n.properties.className as string[]) : []
        walk(n.children as Tree['children'], [...classes, ...own])
      }
    }
  }
  walk(t.children, [])
  return out
}

/*
 * The same tree for TipTap's plugin: it asks lowlight by name, and is
 * given this, which reads the name the way `tree` does and keeps answers.
 */
const forPlugin = {
  highlight: (language: string, code: string) => tree(code, language),
  highlightAuto: (code: string) => tree(code, null),
  listLanguages: () => lowlight.listLanguages(),
  registered: (name: string) => grammarOf(name) !== null,
}

/**
 * TipTap's lowlight plugin, for an editor that is already open.
 *
 * `CodeBlockLowlight` is a whole code block node, and the editor's node is
 * made before this chunk arrives — so only its plugin is taken, the one
 * that turns lowlight's tree into decorations, and run inside the editor's
 * own (`editor/codeBlock.tsx`). The rest of what the extension makes is the
 * code block StarterKit already has.
 */
export function lowlightPlugin(editor: Editor): Plugin {
  const ext = CodeBlockLowlight.configure({ lowlight: forPlugin, defaultLanguage: null })
  const make = getExtensionField<(() => Plugin[]) | undefined>(ext, 'addProseMirrorPlugins', {
    name: ext.name,
    options: ext.options,
    storage: {},
    editor,
    type: editor.schema.nodes.codeBlock,
  })
  const plugins = make?.() ?? []
  const found = plugins.find((p) => (p as unknown as { key: string }).key.startsWith('lowlight$'))
  if (!found) throw new Error('lowlight plugin not found')
  return found
}
