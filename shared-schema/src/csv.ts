/**
 * A spreadsheet's rows, read in the browser.
 *
 * No package: CSV is quotes, commas and line breaks, and the three products
 * that export it here write it plainly. A field in quotes may hold commas,
 * line breaks and doubled quotes; the separator is whichever of comma,
 * semicolon and tab the header line has most of.
 */
export function parseCsv(raw: string, max = 5001): string[][] {
  const text = raw.replace(/^﻿/, '')
  const head = text.slice(0, text.search(/\r?\n/) >>> 0 || text.length)
  const sep = [',', ';', '\t'].sort((a, b) => head.split(b).length - head.split(a).length)[0]!
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === sep) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim())) rows.push(row)
      row = []
      if (rows.length >= max) return rows
    } else field += ch
  }
  row.push(field)
  if (row.some((f) => f.trim())) rows.push(row)
  return rows
}

export type Field = 'title' | 'body' | 'status' | 'assignee' | 'due' | 'priority' | 'labels' | 'key' | 'done'

/** Each product's name for each field, lower case — Jira, Asana, Linear, and plain. */
const NAMES: Record<Field, string[]> = {
  title: ['summary', 'name', 'title', 'task', 'task name'],
  body: ['description', 'notes', 'details'],
  status: ['status', 'section/column', 'section', 'column', 'state', 'list'],
  assignee: ['assignee email', 'assignee', 'owner', 'assigned to'],
  due: ['due date', 'due', 'due on', 'deadline'],
  priority: ['priority'],
  labels: ['labels', 'tags', 'label', 'tag'],
  key: ['issue key', 'id', 'task id', 'key'],
  done: ['completed at', 'completed'],
}

/** Which column each field is, guessed from the headers; -1 for none. */
export function guess(headers: string[]): Record<Field, number> {
  const low = headers.map((h) => h.trim().toLowerCase())
  const out = {} as Record<Field, number>
  for (const f of Object.keys(NAMES) as Field[]) {
    out[f] = -1
    for (const n of NAMES[f]) {
      const at = low.indexOf(n)
      if (at >= 0) {
        out[f] = at
        break
      }
    }
  }
  return out
}

/** Highest/High/Medium/Low, Urgent, P0–P4, 1–4 — into the four here. */
export function priorityOf(said: string): 'urgent' | 'high' | 'medium' | 'low' | undefined {
  const s = said.trim().toLowerCase()
  if (!s) return undefined
  if (['urgent', 'highest', 'critical', 'blocker', 'p0', '1'].includes(s)) return 'urgent'
  if (['high', 'major', 'p1', '2'].includes(s)) return 'high'
  if (['medium', 'normal', 'p2', '3'].includes(s)) return 'medium'
  if (['low', 'lowest', 'minor', 'trivial', 'p3', 'p4', '4'].includes(s)) return 'low'
  return undefined
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

/* A day that is one: 2026-13-45 is not. */
const real = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : undefined
}

/**
 * Whether a file's slashed dates are day first, as Europe writes them, or
 * month first, as the US does: a first number over twelve says day, a
 * second over twelve says month, and a file that says neither is read the
 * way its reader's browser would write a date.
 */
export function dayFirstIn(cells: string[], fallback: boolean): boolean {
  for (const c of cells) {
    const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}/.exec(c.trim())
    if (!m) continue
    if (Number(m[1]) > 12) return true
    if (Number(m[2]) > 12) return false
  }
  return fallback
}

/**
 * A date as each writes it: 2026-11-06, Jira's 06/Nov/26 10:00 AM,
 * Asana's 2026-11-06, 11/06/2026 or 06/11/2026 — into YYYY-MM-DD, or
 * nothing when it is no day at all.
 */
export function dayOf(said: string, dayFirst = false): string | undefined {
  const s = said.trim()
  if (!s) return undefined
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})/.exec(s)
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase())
    if (month >= 0) {
      const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      return real(year, month + 1, Number(m[1]))
    }
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) return dayFirst ? real(Number(m[3]), Number(m[2]), Number(m[1])) : real(Number(m[3]), Number(m[1]), Number(m[2]))
  const t = Date.parse(s)
  if (!Number.isNaN(t)) {
    const d = new Date(t)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return undefined
}

/** Labels as a cell holds them: commas, semicolons, or Jira's spaces between words without them. */
export const labelsOf = (said: string) =>
  [...new Set(said.split(/[,;]/).map((x) => x.trim()).filter(Boolean))].slice(0, 20).map((x) => x.slice(0, 40))
