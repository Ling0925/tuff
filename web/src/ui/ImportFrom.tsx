import { useCallback, useEffect, useRef, useState } from 'react'
import { api, Refused } from '../data/api.js'
import { ahead, known } from '../data/ahead.js'
import { IMPORT_FROM as W } from '../words/importFrom.js'
import { Button, Hairline, Panel, SectionHead, Segments, SecretInput, linkField, notALogin } from './kit.jsx'

/**
 * Bringing work across from Linear, Jira or Asana.
 *
 * The key goes to the server twice — to list what it can see and to
 * start — and is never kept on this page: the fields are emptied once the
 * import starts. The server holds it sealed while the import runs, and
 * drops it after.
 */

type Source = 'linear' | 'jira' | 'asana'
type Team = { id: string; key: string; name: string; issues: number }
type Import = {
  id: string
  source: Source
  teams: Team[]
  progress: Record<string, { project_id?: string; issues?: number; reading?: number; done?: boolean }>
  state: 'running' | 'done' | 'failed'
  error: string | null
}

export function ImportFrom({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [imports, setImports] = useState<Import[]>(() => known<{ imports: Import[] }>('/import/linear')?.imports ?? [])
  const [source, setSource] = useState<Source>('linear')
  const [key, setKey] = useState('')
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  /* What the sidebar has to hear: a project made for a team, and an import
     that ended. The worker makes them in another process, whose news does
     not reach this page's socket, so the page says it when it sees it. */
  const seen = useRef<string>('')
  const load = useCallback(async () => {
    const next = (await ahead<{ imports: Import[] }>('/import/linear')).imports
    setImports(next)
    const now = next
      .map(
        (i) =>
          `${i.id}:${i.state}:${Object.values(i.progress)
            .map((p) => p.project_id ?? '')
            .join(',')}`,
      )
      .join('|')
    if (seen.current && seen.current !== now) void onChanged()
    seen.current = now
  }, [onChanged])
  useEffect(() => void load().catch(() => {}), [load])

  /* While one runs, how far it has got, every few seconds. */
  const running = imports.some((i) => i.state === 'running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void load().catch(() => {}), 3000)
    return () => clearInterval(t)
  }, [running, load])

  /* What each product is asked with: Jira's key is three things. */
  const said = () =>
    source === 'jira'
      ? { site: site.trim(), email: email.trim(), token: key.trim() }
      : source === 'asana'
        ? { token: key.trim() }
        : { key: key.trim() }
  const ready = key.trim().length >= 20 && (source !== 'jira' || (site.trim() && email.includes('@')))

  async function find() {
    setBusy(true)
    setTrouble(null)
    try {
      const r = await api<{ teams: Team[] }>(`/import/${source}/${source === 'linear' ? 'teams' : 'projects'}`, {
        method: 'POST',
        body: JSON.stringify(said()),
      })
      setTeams(r.teams)
      setChosen(new Set(r.teams.filter((t) => t.issues > 0).map((t) => t.id)))
    } catch (e) {
      setTrouble(e instanceof Refused ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    setBusy(true)
    setTrouble(null)
    try {
      await api(`/import/${source}`, { method: 'POST', body: JSON.stringify({ ...said(), teams: [...chosen] }) })
      setKey('')
      setSite('')
      setEmail('')
      setTeams(null)
      await load()
    } catch (e) {
      setTrouble(e instanceof Refused ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const field = 'h-8 min-w-px flex-1 rounded-[var(--r-tile)] px-3 text-base outline-none placeholder:text-[var(--ink-3)]'
  const look = { background: 'var(--sunken)', color: 'var(--ink)' }
  const label = source === 'jira' ? W.jiraKey : source === 'asana' ? W.asanaKey : W.linearKey
  const where = source === 'jira' ? W.jiraWhere : source === 'asana' ? W.asanaWhere : W.linearWhere
  const typed = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value)
    setTeams(null)
  }
  return (
    <section data-testid="import-from" className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.head}</SectionHead>
      <Panel>
        {!running && (
          <div className="px-4 pt-3">
            <Segments<Source>
              items={[
                { key: 'linear', label: 'Linear', testId: 'import-linear' },
                { key: 'jira', label: 'Jira', testId: 'import-jira' },
                { key: 'asana', label: 'Asana', testId: 'import-asana' },
              ]}
              value={source}
              onPick={(next) => {
                setSource(next)
                setKey('')
                setTeams(null)
                setTrouble(null)
              }}
            />
          </div>
        )}
        <div className="flex flex-col gap-1 px-4 py-3">
          <span className="text-base text-ink">{label}</span>
          <span className="text-sm" style={{ color: trouble ? 'var(--danger)' : 'var(--ink-3)' }}>
            {trouble ?? where}
          </span>
        </div>
        {!running && (
          <form
            className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:flex-wrap sm:items-center"
            onSubmit={(e) => {
              e.preventDefault()
              void find()
            }}
          >
            {source === 'jira' && (
              <>
                <input
                  data-testid="import-site"
                  name="jira-site"
                  {...linkField}
                  aria-label={W.jiraSite}
                  placeholder="acme.atlassian.net"
                  value={site}
                  onChange={typed(setSite)}
                  className={`${field} w-full sm:w-auto`}
                  style={look}
                />
                <input
                  data-testid="import-email"
                  type="email"
                  name="jira-email"
                  {...notALogin}
                  aria-label={W.jiraEmail}
                  placeholder={W.jiraEmail}
                  value={email}
                  onChange={typed(setEmail)}
                  className={`${field} w-full sm:w-auto`}
                  style={look}
                />
              </>
            )}
            <div className="flex min-w-px flex-[2] items-center gap-2">
              <SecretInput
                data-testid="import-key"
                name={`${source}-api-key`}
                aria-label={source === 'jira' ? W.jiraToken : label}
                placeholder={source === 'linear' ? 'lin_api_…' : source === 'jira' ? W.jiraToken : '2/…'}
                value={key}
                onChange={typed(setKey)}
                className={field}
                style={look}
              />
              <Button type="submit" data-testid="import-find" disabled={busy || !ready}>
                {source === 'linear' ? W.findTeams : W.findProjects}
              </Button>
            </div>
          </form>
        )}
        {teams && !running && (
          <>
            <Hairline inset={16} />
            {teams.map((t) => (
              <label key={t.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 px-4">
                <input
                  type="checkbox"
                  data-testid={`import-team-${t.id}`}
                  checked={chosen.has(t.id)}
                  onChange={(e) => {
                    const next = new Set(chosen)
                    if (e.target.checked) next.add(t.id)
                    else next.delete(t.id)
                    setChosen(next)
                  }}
                />
                <span className="min-w-px flex-1 truncate text-base text-ink">
                  {t.name} <span className="text-ink-3">{t.key}</span>
                </span>
                <span className="text-sm tabular-nums text-ink-3">{source === 'asana' ? W.tasks(t.issues) : W.issues(t.issues)}</span>
              </label>
            ))}
            <div className="flex justify-end px-4 py-3">
              <Button tone="primary" data-testid="import-start" disabled={busy || chosen.size === 0} onClick={() => void start()}>
                {W.start}
              </Button>
            </div>
          </>
        )}
        {/* Every one still running, and the last that ended. */}
        {imports
          .filter((i, at) => i.state === 'running' || at === 0)
          .map((i) => (
            <div key={i.id}>
              <Hairline inset={16} />
              {i.teams.map((t) => {
                const p = i.progress[t.id]
                /* How far, as a bar: brought and being read against the
                 product's count — Linear's takes in its archive, so it is a
                 ceiling. */
                const moving = i.state === 'running' && !p?.done
                const share = p?.done ? 1 : Math.min(1, ((p?.issues ?? 0) + (p?.reading ?? 0)) / Math.max(t.issues, 1))
                return (
                  <div
                    key={t.id}
                    data-testid={`import-progress-${t.id}`}
                    className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2"
                  >
                    <span className="min-w-px flex-1 truncate text-base text-ink">{t.name}</span>
                    {/* Brought, not "of": Linear's count of a team's issues
                      takes in what it has archived, which is not brought. */}
                    <span className="text-sm tabular-nums" style={{ color: i.state === 'failed' ? 'var(--danger)' : 'var(--ink-3)' }}>
                      {p?.done ? W.done : i.state === 'failed' ? (i.error ?? W.failed) : `${W.running} ${W.brought(p?.issues ?? 0)}`}
                    </span>
                    {moving && (
                      <span
                        role="progressbar"
                        aria-label={t.name}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(share * 100)}
                        className="relative block h-1 w-full overflow-hidden rounded-full bg-track"
                      >
                        {/* Drawn by a transform, eased between the answers
                          that come every few seconds; and before the first
                          number, a strip that travels, so it never looks
                          stopped while it is not. */}
                        <span
                          className="absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-[250ms] ease-out motion-reduce:transition-none bg-accent"
                          style={{ transform: `scaleX(${Math.max(share, 0.02)})` }}
                        />
                        {share < 0.02 && (
                          <span
                            className="absolute inset-y-0 left-0 w-1/4 rounded-full motion-safe:animate-[import-wait_1.2s_ease-in-out_infinite] motion-reduce:hidden bg-accent"
                            style={{ opacity: 0.6 }}
                          />
                        )}
                      </span>
                    )}
                  </div>
                )
              })}
              {i.state === 'running' && (
                <div className="flex justify-end px-4 pb-3">
                  <Button
                    data-testid="import-stop"
                    onClick={async () => {
                      await api(`/import/linear/${i.id}/stop`, { method: 'POST' }).catch(() => {})
                      await load()
                    }}
                  >
                    {W.stop}
                  </Button>
                </div>
              )}
            </div>
          ))}
      </Panel>
      <p className="px-1 text-sm text-ink-3">{source === 'jira' ? W.jiraHint : source === 'asana' ? W.asanaHint : W.linearHint}</p>
    </section>
  )
}
