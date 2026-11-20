/**
 * Inputs made to be slow or large to read. The tests hold them to their
 * budgets in nodes and bytes, `bench/parsers.bench.ts` to their budgets in
 * time. Each once took seconds or minutes, or most of a gigabyte.
 */

/* ------------------------------------------------------------ Markdown */

export const N = 200_000
export const head = '|' + Array.from({ length: 64 }, (_, k) => 'h' + k).join('|') + '|\n|' + '--|'.repeat(64) + '\n'

export const attacks: [string, string][] = [
  /* A hundred and thirty nodes for every three characters: 8.6 M nodes, 7 s. */
  ['a wide header over rows of ||', head + '||\n'.repeat(Math.floor((N - head.length) / 3))],
  /* Two runs of spaces around an empty language: 20 s, and 72 s without it. */
  ['a fence of spaces around a language', '~~~' + ' '.repeat(N / 2) + 'js' + ' '.repeat(N / 2) + '!'],
  ['a fence of spaces', '```' + ' '.repeat(N) + '!'],
  /* `^\s*\|?\s*` after a table's first row: 115 s. */
  ['a line of spaces under a table row', '|a|\n' + ' '.repeat(N) + 'x'],
  /* `.` stops at a line separator, and `[ \t]+(.*)$` tried every split: 125 s. */
  ['a heading of spaces before a line separator', '# ' + ' '.repeat(N) + ' '],
  ['a list item of spaces before a line separator', '- ' + ' '.repeat(N) + ' x'],
  ['a rule of spaced dashes', '-' + ' - '.repeat(N / 3) + 'x'],
  ['a row of spaces', '|' + ' '.repeat(N) + 'x'],
  /* Every bracket read its words again: a second and more. */
  ['brackets', '['.repeat(N)],
  ['links that never close', '[a]('.repeat(N / 4)],
  ['[a', '[a'.repeat(N / 2)],
  ['lines of quotes in quotes', '>>>>>>>>- a\n'.repeat(Math.floor(N / 12))],
  ['list items', '- a\n'.repeat(N / 4)],
  ['paragraphs', 'a\n\n'.repeat(Math.floor(N / 3))],
  ['marks', '*a* '.repeat(N / 4)],
  ['code', '`a'.repeat(N / 2)],
]

/* A link's address on every run of words inside it. */
export const amplifier = '[' + '*a*b'.repeat(75) + '](https://e.co/' + 'x'.repeat(1987) + ')'

/* ------------------------------------------------------- a Slack webhook */

/* As much as 64 KB can carry, shaped to grow, to scan, or to nest. */
const tokens = (unit: string) => unit.repeat(Math.ceil(40_000 / unit.length)).slice(0, 40_000)
const piece = (unit: string) => unit.repeat(Math.ceil(2_900 / unit.length)).slice(0, 2_900)
export const worstSlack: unknown[] = [
  { text: tokens('*a* ') },
  { text: tokens('<https://x.example|y>') },
  { text: tokens('`c` _d_ ~e~ ') },
  { text: tokens('*') },
  { text: tokens('_ ') },
  { text: tokens('a\n') },
  { text: tokens('> *_~x~_*\n') },
  { blocks: Array.from({ length: 20 }, () => ({ type: 'section', text: { type: 'mrkdwn', text: piece('*a* _b_ ') } })) },
  {
    text: 'x',
    attachments: Array.from({ length: 100 }, () => ({
      title: 't',
      fields: Array.from({ length: 20 }, () => ({ title: 'f', value: '*v*' })),
    })),
  },
]
