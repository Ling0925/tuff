/**
 * Ordinary bodies, the kind agents, GitHub issues and imports send, for
 * `markdown-limits.test.ts`: each is read now exactly as it was before the
 * parser had limits, which `markdown-regression.json` holds.
 */
export const corpus: Record<string, string> = {
  'task description': `## Goal

Make the board load in under 200 ms on a project with **10 000 tasks**.

## What it needs

- An index on \`(project_id, position)\`
- The query moved off the view, see [the spec](https://usetuff.com/docs/specs/board.md)
- A probe in \`pnpm load\`

Done when the load table is green.`,

  'github issue with code': `### Describe the bug

Calling \`fromMarkdown\` on a body with CRLF line endings drops the first heading.

\`\`\`ts
const doc = fromMarkdown('# Title\\r\\nbody')
console.log(doc.content[0].type) // 'paragraph'
\`\`\`

### Expected behavior

A heading.

### Environment
- OS: macOS 15
- Node: 22.11`,

  'issue with a shell fence and output': `Steps:

\`\`\`bash
pnpm install
pnpm --filter server test
\`\`\`

Output:

\`\`\`
TypeError: Cannot read properties of undefined (reading 'id')
    at handler (src/http/tasks.ts:41:12)
\`\`\`

~~~python
print("tilde fence")
~~~`,

  'simple table': `| Name | Role | Since |
|------|------|-------|
| Ada  | Owner | 2024 |
| Grace | Member | 2025 |`,

  'aligned table with marks': `| Column | Meaning |
| :--- | ---: |
| **id** | The task's number |
| \`state\` | One of *todo*, *doing*, *done* |
| link | [here](https://example.com/a?b=1) |`,

  'table with missing and extra cells': `| a | b | c |
|---|---|---|
| 1 |
| 1 | 2 | 3 | 4 |
||
| x | | z |`,

  'nested lists': `- One
  - One point one
  - One point two
    - Deeper
- Two
1. First
2. Second
   1. Inner
- [ ] a task box
- [x] a done box`,

  'loose list': `- first

- second

- third

After the list.`,

  'ordered list with parens': `1) Open the project
2) Press **New task**
3) Type a title`,

  'links of every kind': `See https://example.com/a. Also (https://example.com/b), www.example.org and [the docs](https://docs.example.com "title").
A [mail](mailto:a@b.co) link, a [bad one](javascript:alert(1)) and [relative](/x/y).
Wikipedia: https://en.wikipedia.org/wiki/Heat_(1995_film)`,

  'TODO reference lines': `[TODO]: write the migration
[NOTE]: the backfill runs at night
[1]: https://example.com/reference`,

  'array indexes and brackets': `Read \`arr[0][1]\` or arr[0][1] directly, and map[key] = value; also [a][b] and [x] alone.
Then f(a)[0] and [unclosed bracket and ] stray.`,

  'windows paths': `Copy it to \\\\server\\share\\folder and C:\\Users\\me\\file.txt.
The UNC path \\\\server\\share stays as written.`,

  'emphasis mix': `This is *italic*, _also italic_, **bold**, __bold too__, ~~struck~~, and ***both***.
snake_case_names stay, 2*3*4 = 24, a * b, and an _unterminated one.`,

  'headings of every depth': `# One
## Two ##
### Three
#### Four
##### Five
###### Six
####### Seven is text
#NoSpace
# C#`,

  'quotes and nested quotes': `> A quote
> over two lines
>
> > nested inside
> > - with a list
>
> back out

> [!NOTE]
> A GitHub alert is a callout since the batch that brought callouts in.`,

  rules: `Above

---

***
___
- - -
* * *

Below`,

  'pictures and files': `![diagram](file:3f2a9c1e-1b2c-4d5e-8f90-0123456789ab)
[spec.pdf](file:3F2A9C1E-1B2C-4D5E-8F90-0123456789AC)

Text with a ![inline](file:3f2a9c1e-1b2c-4d5e-8f90-0123456789ab) picture.`,

  'linear export': `**Priority:** High
**Labels:** backend, perf

When the user opens a project with many tasks the list jumps.

Repro:
1. Seed with \`pnpm load\`
2. Open /studio/web/tasks
3. Scroll

Expected: no jump.`,

  'csv cell with newlines': `First line of a CSV cell
second line, same paragraph
- then a list
- of two`,

  'empty and blank': `



`,

  'only spaces in a code fence': '```\n   \n```',

  'unterminated fence': '```js\nconst a = 1\nno closing fence',

  'fence with trailing spaces and info': '```  ts  \nlet x = 1\n```\n``` not a fence\n```c++\nint x;\n```',

  'paragraph broken by blocks': `A paragraph
# Heading right after
text
> quote right after
text
| not | a table |
text
\`\`\`
code
\`\`\``,

  'pipes that are not tables': `a | b | c
| starts with pipe only
|ends|
|---|`,

  'lists with stars and pluses': `* star
+ plus
- dash
10. ten
11. eleven`,

  'unicode and line separators': `Привет, **мир** — ça va?
Emoji 🎉 in *italic* text.
A line with a separator\u2028inside it.
# Heading\u2028with one
- item\u2028with one`,

  'tabs and indentation': `\t- tab indented item
\t\t- deeper by tab
    code-like indent is a paragraph
#\tTabbed heading`,

  'long realistic brief': `# Q4 plan

## Context

The team ships to **three** clients: web, iOS and Android. See https://usetuff.com.

## Milestones

| Month | What | Owner |
|---|---|---|
| Oct | Offline reading | Ada |
| Nov | Board undo | Grace |
| Dec | French | Linus |

## Risks

1. RLS cost on real data
   - measured with \`pnpm load\`
2. CI minutes
   - runs daily now

> Decided on 3 October: no op-log.

---

Questions go in [chat](https://usetuff.com/studio/chat/1).`,

  'crlf body': '# Title\r\n\r\n- a\r\n- b\r\n\r\n| x | y |\r\n|---|---|\r\n| 1 | 2 |\r\n',

  'table followed by text': `| k | v |
|---|---|
| a | 1 |
Not a row, a paragraph.
| new | row? |`,
}
