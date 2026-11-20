/**
 * A document or a task as a PDF — `docs/specs/export.md`.
 *
 * The browser's own printing does the PDF: a clean page is opened beside the
 * app, holding the title, a line of facts and the body as it is drawn on the
 * screen, and the print dialog is asked for on it, where "Save as PDF" is.
 * No library and no server render — what is printed is what was read, its
 * pictures and formatting included, and the page's title is the file's name.
 */
import { PRINT as W } from '../words/print.js'

export type Printed = {
  title: string
  /** The facts under the title — a handle, who, when — joined by dots. */
  facts: string[]
  /** What is drawn on the screen, copied as it is. */
  body: Element | null
  /** Anything after the body, already shaped: a checklist, comments. */
  after?: { heading: string; items: { head?: string; text: string; done?: boolean }[] }[]
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The body without what only makes sense on a screen: editing, controls. */
function cleaned(body: Element): string {
  const copy = body.cloneNode(true) as Element
  copy.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'))
  /* Paper cannot be pressed: every toggle prints open, and a callout keeps
     its emoji, which on the screen is a button. */
  copy.querySelectorAll('details').forEach((n) => n.setAttribute('open', ''))
  copy.querySelectorAll('[data-type="detailsContent"][hidden]').forEach((n) => n.removeAttribute('hidden'))
  copy.querySelectorAll('[data-callout-emoji]').forEach((n) => {
    const face = copy.ownerDocument.createElement('span')
    face.className = 'callout-emoji'
    face.textContent = n.textContent
    n.replaceWith(face)
  })
  /* A task named in the body is a line of words on paper: a box, ticked
     or not, the handle and the title. */
  copy.querySelectorAll('[data-task-chip]').forEach((n) => {
    const words = copy.ownerDocument.createElement('span')
    const handle = n.querySelector('.task-chip-handle')?.textContent ?? ''
    const title = n.querySelector('.task-chip-title')?.textContent ?? ''
    words.textContent = `${n.hasAttribute('data-done') ? '☑' : '☐'} ${handle} ${title}`.replace(/\s+/g, ' ')
    n.replaceWith(words)
  })
  copy.querySelectorAll('button:not(:has(img)), input, select, textarea, [data-print-skip]').forEach((n) => n.remove())
  /* Pictures at their full address rather than their loading glance. */
  copy.querySelectorAll('img').forEach((img) => {
    img.removeAttribute('loading')
    img.removeAttribute('style')
  })
  return copy.innerHTML
}

const STYLE = `
@page { margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font: 11pt/1.55 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif; color: #111; margin: 0; }
main { max-width: 720px; margin: 0 auto; }
h1.title { font-size: 22pt; line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 6pt; }
p.facts { color: #666; font-size: 9.5pt; margin: 0 0 18pt; padding-bottom: 12pt; border-bottom: 1px solid #ddd; }
h1, h2, h3 { line-height: 1.25; margin: 16pt 0 6pt; break-after: avoid; }
p { margin: 0 0 8pt; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li > p { margin: 0; }
blockquote { margin: 0 0 8pt; padding-left: 10pt; border-left: 3px solid #ddd; color: #444; }
pre, code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 9.5pt; }
pre { background: #f5f5f5; padding: 8pt 10pt; border-radius: 4pt; white-space: pre-wrap; break-inside: avoid; }
img, video { max-width: 100%; height: auto; break-inside: avoid; border-radius: 4pt; }
table { border-collapse: collapse; margin: 0 0 8pt; width: 100%; table-layout: fixed; break-inside: auto; }
tr { break-inside: avoid; }
td, th { border: 1px solid #ddd; padding: 4pt 6pt; vertical-align: top; text-align: left; }
th { background: #f5f5f5; font-weight: 600; }
td > p, th > p { margin: 0; }
a { color: #1a5fd0; text-decoration: none; }
hr { border: 0; border-top: 1px solid #ddd; margin: 12pt 0; }
.callout { display: flex; gap: 8pt; padding: 8pt 10pt; margin: 0 0 8pt; border-radius: 4pt; background: #f2f2f3; break-inside: avoid; }
.callout[data-tone="blue"] { background: #e7f1ff; }
.callout[data-tone="green"] { background: #e8f7ec; }
.callout[data-tone="yellow"] { background: #fff8db; }
.callout[data-tone="red"] { background: #ffeceb; }
.callout-emoji { flex: none; }
.callout-body { flex: 1; min-width: 0; }
.callout-body p:last-child { margin-bottom: 0; }
.toggle, details { margin: 0 0 8pt; }
.toggle summary, details > summary { font-weight: 600; list-style: none; margin: 0 0 4pt; }
.toggle-chevron { display: none; }
.toggle [data-type="detailsContent"], details > .toggle-inside { padding-left: 12pt; }
section.after { margin-top: 18pt; }
section.after h2 { font-size: 12pt; }
.item { margin: 0 0 8pt; break-inside: avoid; }
.item .head { color: #666; font-size: 9pt; }
.done { color: #888; text-decoration: line-through; }
`

/** Opened from the press, so the browser lets the window open. */
export function printAsPdf(p: Printed): void {
  const w = window.open('', '_blank')
  if (!w) return
  const after = (p.after ?? [])
    .filter((s) => s.items.length > 0)
    .map(
      (s) =>
        `<section class="after"><h2>${esc(s.heading)}</h2>${s.items
          .map(
            (i) =>
              `<div class="item">${i.head ? `<div class="head">${esc(i.head)}</div>` : ''}<div class="${i.done ? 'done' : ''}">${
                i.done === undefined ? '' : i.done ? '☑ ' : '☐ '
              }${esc(i.text)}</div></div>`,
          )
          .join('')}</section>`,
    )
    .join('')
  w.document.open()
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.title || W.untitled)}</title><style>${STYLE}</style></head><body><main><h1 class="title">${esc(
      p.title || W.untitled,
    )}</h1>${p.facts.length ? `<p class="facts">${p.facts.map(esc).join(' · ')}</p>` : ''}<article>${
      p.body ? cleaned(p.body) : ''
    }</article>${after}</main></body></html>`,
  )
  w.document.close()
  /* Printed once the pictures are in, or after three seconds whatever they
     are doing — a picture that never arrives should not hold the page. */
  const pictures = [...w.document.images].filter((img) => !img.complete)
  const ready = Promise.race([
    Promise.all(pictures.map((img) => new Promise((done) => ((img.onload = done), (img.onerror = done))))),
    new Promise((done) => setTimeout(done, 3000)),
  ])
  void ready.then(() => {
    w.focus()
    w.print()
  })
  w.onafterprint = () => w.close()
}
