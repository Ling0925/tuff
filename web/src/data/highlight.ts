/**
 * Colour for code, the way an editor gives it.
 *
 * Not a highlighter package: the chosen stack names none, and what a
 * code block in a task or a message needs is not a grammar per language but
 * the five things every editor colours the same way whatever the language
 * — comments, strings, numbers, keywords, and the names of things being
 * called or declared. One pass of one expression over the text, shared by
 * the editor (as decorations) and by `Doc` (as spans), so a block reads the
 * same while it is written and after. `docs/specs/rich-text.md`.
 */

export type Tone = 'comment' | 'string' | 'number' | 'keyword' | 'fn' | 'type'

export type Token = { from: number; to: number; tone: Tone }

/* The keywords of the languages a team pastes into a task — JavaScript and
   TypeScript, Python, Go, Rust, shell — in one set. A word that is a keyword
   in one and a name in another is coloured as a keyword; in a snippet of a
   few lines that is the right mistake to make. */
const KEYWORDS = new Set(
  `abstract and as async await break case catch class const continue crate debugger def default defer del delete do elif else enum esac except export extends false fi final finally fn for from func function go goto if impl implements import in instanceof interface is lambda let loop match mod module mut namespace new nil none None not null of or package pass private protected pub public raise readonly return select self Self static struct super switch then this throw throws trait true True False try type typeof undefined unless use var void where while with yield chan map range fallthrough elsif echo local`.split(
    ' ',
  ),
)

/* SQL is shouted more often than not, so its words count when they are
   written in capitals and are left alone in lower case, where they are
   ordinary names in every other language. */
const SQL = new Set(
  `SELECT FROM WHERE INSERT INTO UPDATE DELETE SET VALUES JOIN LEFT RIGHT INNER OUTER FULL ON GROUP BY ORDER LIMIT OFFSET HAVING UNION ALL DISTINCT AS AND OR NOT NULL IS IN LIKE CREATE TABLE ALTER DROP INDEX PRIMARY KEY REFERENCES DEFAULT RETURNING WITH CASE WHEN THEN ELSE END EXISTS BEGIN COMMIT ROLLBACK GRANT POLICY`.split(
    ' ',
  ),
)

const SCAN = new RegExp(
  [
    // Comments: line and block in the C family, `--` in SQL, `#` followed by
    // a space in shell and Python — not `#fff` or `#include`.
    String.raw`(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|<!--[\s\S]*?(?:-->|$)|--\s[^\n]*|#(?=[\s!]|$)[^\n]*)`,
    // Strings, unterminated ones running to the end of the line.
    String.raw`("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|\x60(?:\\.|[^\x60\\])*\x60?)`,
    // Numbers.
    String.raw`(\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b)`,
    // Words, sorted out below.
    String.raw`([A-Za-z_$][\w$]*)`,
  ].join('|'),
  'g',
)

export function tokens(code: string): Token[] {
  const out: Token[] = []
  SCAN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SCAN.exec(code))) {
    const from = m.index
    const to = from + m[0].length
    if (m[0].length === 0) {
      SCAN.lastIndex++
      continue
    }
    if (m[1]) out.push({ from, to, tone: 'comment' })
    else if (m[2]) out.push({ from, to, tone: 'string' })
    else if (m[3]) out.push({ from, to, tone: 'number' })
    else if (m[4]) {
      const word = m[4]
      /* After a dot it is a property, whatever it is spelled like —
         `task.done`, `row.type`. */
      const member = code[from - 1] === '.'
      if (!member && (KEYWORDS.has(word) || SQL.has(word))) out.push({ from, to, tone: 'keyword' })
      else if (/^\s*\(/.test(code.slice(to, to + 8))) out.push({ from, to, tone: 'fn' })
      else if (/^[A-Z][a-z]/.test(word)) out.push({ from, to, tone: 'type' })
    }
  }
  return out
}
