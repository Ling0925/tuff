import { useState, useRef } from 'react'
import { MORE } from '../../data/words.js'
import { PROJECT_SETTINGS as W } from '../../words/projectSettings.js'
import { type Field, parseCsv, guess, dayFirstIn, dayOf, priorityOf, labelsOf } from '@tracker/shared-schema'
import { api, Refused } from '../../data/api.js'
import { sendHalving } from '../../data/halving.js'
import { known, ahead } from '../../data/ahead.js'
import { SectionHead, Panel, Button, Hairline } from '../kit.jsx'
import { type ListRow } from './lists.jsx'

type Spread = { headers: string[]; rows: string[][] }

/**
 * Tasks from a spreadsheet. Jira's, Asana's or
 * Linear's export, or any CSV: read here, its columns and statuses guessed
 * and shown, every guess changeable, and only the rows sent.
 */
export function ImportTasks({ projectId, may, onChanged }: { projectId: string; may: boolean; onChanged: () => Promise<void> | void }) {
  const [sheet, setSheet] = useState<Spread | null>(null)
  const [cols, setCols] = useState<Record<Field, number> | null>(null)
  const [lists, setLists] = useState<ListRow[]>(() => known<{ lists: ListRow[] }>(`/projects/${projectId}/lists`)?.lists ?? [])
  const [where, setWhere] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const cell = (r: string[], f: Field) => (cols && cols[f] >= 0 ? (r[cols[f]] ?? '').trim() : '')
  /* Jira writes a multi-valued field as several columns of one name. */
  const allOf = (r: string[], f: Field) => {
    if (!cols || cols[f] < 0 || !sheet) return ''
    const name = sheet.headers[cols[f]]
    return sheet.headers
      .map((h, i) => (h === name ? (r[i] ?? '') : ''))
      .filter(Boolean)
      .join(',')
  }
  const statuses = sheet && cols && cols.status >= 0 ? [...new Set(sheet.rows.map((r) => cell(r, 'status')).filter(Boolean))] : []
  const firstList = (lists.find((l) => !l.intake) ?? lists[0])?.id ?? ''
  const doneList = lists.find((l) => l.finishes && l.icon === 'done')?.id ?? ''

  async function read(file: File) {
    setSaid(null)
    const rows = parseCsv(await file.text())
    if (rows.length < 2) return setSaid(W.importEmpty)
    const [headers, ...body] = rows
    const g = guess(headers!)
    setSheet({ headers: headers!, rows: body.slice(0, 5000) })
    setCols(g)
    const ls = (await ahead<{ lists: ListRow[] }>(`/projects/${projectId}/lists`).catch(() => null))?.lists ?? lists
    setLists(ls)
    /* Each status to the list of its name, case aside, or the first. */
    const named = new Map(ls.map((l) => [l.name.toLowerCase(), l.id]))
    const first = (ls.find((l) => !l.intake) ?? ls[0])?.id ?? ''
    const next: Record<string, string> = {}
    for (const s of new Set(body.map((r) => (g.status >= 0 ? (r[g.status] ?? '').trim() : '')).filter(Boolean))) {
      next[s] = named.get(s.toLowerCase()) ?? first
    }
    setWhere(next)
  }

  async function bring() {
    if (!sheet || !cols || cols.title < 0) return
    /* Day first or month first, from the file's own dates, else as this
       browser writes one. */
    const dayFirst = dayFirstIn(
      sheet.rows.map((r) => cell(r, 'due')),
      !/^en-US/i.test(navigator.language),
    )
    const tasks = sheet.rows
      .map((r) => {
        const title = cell(r, 'title').slice(0, 300)
        if (!title) return null
        const status = cell(r, 'status')
        const finished = cols.done >= 0 && cell(r, 'done') !== ''
        return {
          title,
          ...(cell(r, 'body') ? { body: cell(r, 'body').slice(0, 20_000) } : {}),
          list_id: finished && doneList ? doneList : (where[status] ?? firstList) || null,
          ...(cell(r, 'assignee') ? { assignee: cell(r, 'assignee').slice(0, 254) } : {}),
          ...(dayOf(cell(r, 'due'), dayFirst) ? { due_on: dayOf(cell(r, 'due'), dayFirst) } : {}),
          ...(priorityOf(cell(r, 'priority')) ? { priority: priorityOf(cell(r, 'priority')) } : {}),
          ...(allOf(r, 'labels') ? { labels: labelsOf(allOf(r, 'labels')) } : {}),
          ...(cell(r, 'key') ? { key: cell(r, 'key').slice(0, 60) } : {}),
        }
      })
      .filter(Boolean)
    /* Pages of two hundred, or fewer when their words are long: a request
       is held to sixteen megabytes. */
    const pages: (typeof tasks)[] = []
    let page: typeof tasks = []
    let size = 0
    for (const t of tasks) {
      const n = JSON.stringify(t).length * 3
      if (page.length && (page.length >= 200 || size + n > 12_000_000)) {
        pages.push(page)
        page = []
        size = 0
      }
      page.push(t)
      size += n
    }
    if (page.length) pages.push(page)
    let done = 0
    setBusy(0)
    try {
      /* A page whose words come to too much for the server to write at
         once is sent again as two halves (`data/halving.ts`). */
      for (const part of pages) {
        await sendHalving(
          part,
          async (rows) =>
            (
              await api<{ written: number }>(`/projects/${projectId}/import/tasks`, {
                method: 'POST',
                body: JSON.stringify({ tasks: rows }),
              })
            ).written,
          (e) => e instanceof Refused && e.status === 413,
          (n) => {
            done += n
            setBusy(done)
          },
        )
      }
      setSaid(W.importDone(done))
      setSheet(null)
      await onChanged()
    } catch (e) {
      setSaid(e instanceof Error ? `${W.importStopped(done)} ${e.message}` : W.importStopped(done))
    } finally {
      setBusy(null)
    }
  }

  if (!may) return null
  const fields: [Field, string][] = [
    ['title', W.colTitle],
    ['body', W.colBody],
    ['status', W.colStatus],
    ['assignee', W.colAssignee],
    ['due', W.colDue],
    ['priority', W.colPriority],
    ['labels', W.colLabels],
    ['key', W.colKey],
  ]
  const select = 'h-8 min-w-px rounded-[var(--r-tile)] px-2 text-base outline-none'
  return (
    <section className="flex flex-col gap-3">
      <SectionHead>{W.importHead}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] items-center gap-4 px-4 py-3">
          <span className="flex min-w-px flex-1 flex-col gap-1">
            <span className="text-base text-ink">{sheet ? W.importRows(sheet.rows.length) : W.importFromCsv}</span>
            <span className="text-sm" style={{ color: said ? 'var(--ink-2)' : 'var(--ink-3)' }}>
              {said ?? W.importHint}
            </span>
          </span>
          <input
            ref={picker}
            type="file"
            accept=".csv,text/csv"
            data-testid="csv-file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void read(f)
            }}
          />
          {!sheet && (
            <Button data-testid="csv-choose" onClick={() => picker.current?.click()}>
              {W.chooseFile}
            </Button>
          )}
        </div>
        {sheet && cols && (
          <>
            <Hairline inset={16} />
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-2">
              {fields.map(([f, name]) => (
                <label key={f} className="flex items-center justify-between gap-3 text-base text-ink-2">
                  {name}
                  <select
                    data-testid={`csv-col-${f}`}
                    value={cols[f]}
                    onChange={(e) => setCols({ ...cols, [f]: Number(e.target.value) })}
                    className={`${select} w-48 bg-sunken text-ink`}
                  >
                    <option value={-1}>{W.colNone}</option>
                    {sheet.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `#${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {statuses.length > 0 && (
              <>
                <Hairline inset={16} />
                <div className="flex flex-col gap-2 px-4 py-3">
                  <span className="text-sm text-ink-3">{W.statusesHint}</span>
                  {statuses.map((s) => (
                    <label key={s} className="flex items-center justify-between gap-3 text-base text-ink">
                      <span className="min-w-px truncate">{s}</span>
                      <select
                        value={where[s] ?? firstList}
                        onChange={(e) => setWhere({ ...where, [s]: e.target.value })}
                        className={`${select} w-48 bg-sunken text-ink`}
                      >
                        {lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </>
            )}
            <Hairline inset={16} />
            <div className="flex items-center justify-end gap-2 px-4 py-3">
              <Button onClick={() => setSheet(null)} disabled={busy !== null}>
                {MORE.cancel}
              </Button>
              <Button tone="primary" data-testid="csv-import" disabled={busy !== null || cols.title < 0} onClick={() => void bring()}>
                {busy === null ? W.importN(sheet.rows.length) : W.importing(busy)}
              </Button>
            </div>
          </>
        )}
      </Panel>
    </section>
  )
}
