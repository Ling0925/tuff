import { useCallback, useEffect, useState } from 'react'
import type { PullOnTask } from '@tracker/shared-schema'
import { api, Refused } from '../data/api.js'
import { ahead, known } from '../data/ahead.js'
import { GITHUB as W } from '../words/github.js'
import { Icon } from './glyphs.jsx'
import { Button, Hairline, Panel, SectionHead, Switch } from './kit.jsx'

/**
 * GitHub: the workspace's installation, a
 * project's repository, and the pull requests on a task.
 */

type Hello = { configured: boolean; install: { account_login: string } | null; can_install: boolean }

/** In the workspace's settings: connecting the Tuff app on GitHub, the owner's. */
export function GithubSection() {
  const [hello, setHello] = useState<Hello | null>(() => known<Hello>('/github') ?? null)
  /* Whose GitHub you are: an installation is claimed only by somebody whose
     own GitHub can see it, so that comes first. */
  const [linked, setLinked] = useState<boolean | null>(() => {
    const me = known<{ linked: unknown }>('/github/me')
    return me ? Boolean(me.linked) : null
  })
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [h, me] = await Promise.all([ahead<Hello>('/github'), ahead<{ linked: unknown }>('/github/me')])
    setHello(h)
    setLinked(Boolean(me.linked))
  }, [])

  useEffect(() => {
    /* Back from GitHub with the installation in the address: finished here,
       and the address put back to the settings it is. */
    const q = new URLSearchParams(window.location.search)
    const id = q.get('installation_id')
    const state = q.get('state')
    if (q.get('github') === 'installed' && id && state) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
      setBusy(true)
      /* GitHub says who installed it in an event of its own, which can land
         a moment after the owner does: asked again until it has. */
      const claim = async (left: number): Promise<void> => {
        const r = await api<{ pending?: boolean }>('/github/installs', {
          method: 'POST',
          body: JSON.stringify({ installation_id: Number(id), state }),
        })
        if (r?.pending && left > 0) {
          await new Promise((done) => setTimeout(done, 2000))
          return claim(left - 1)
        }
      }
      void claim(15)
        .catch((e) => setTrouble(e instanceof Refused ? e.message : String(e)))
        .finally(() => {
          setBusy(false)
          void load()
        })
    } else {
      void load().catch(() => {})
    }
  }, [load])

  if (!hello?.can_install) return null
  return (
    <section data-testid="github" className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.head}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
          <Icon name="github" size={20} className="text-ink" />
          <div className="flex min-w-px flex-1 flex-col gap-1">
            <span className="text-base text-ink">
              {!hello.configured ? W.notSetUp : hello.install ? W.connectedTo(hello.install.account_login) : W.head}
            </span>
            <span className="text-sm" style={{ color: trouble ? 'var(--danger)' : 'var(--ink-3)' }}>
              {trouble ?? (hello.install ? W.disconnectHint : linked === false ? W.linkYoursFirstHint : W.connectHint)}
            </span>
          </div>
          {hello.configured &&
            (hello.install ? (
              <Button
                data-testid="github-disconnect"
                onClick={async () => {
                  await api('/github/install', { method: 'DELETE' })
                  await load()
                }}
              >
                {W.disconnect}
              </Button>
            ) : (
              <Button
                tone="primary"
                data-testid="github-connect"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setTrouble(null)
                  try {
                    const r = await api<{ url: string }>(linked === false ? '/github/me/start' : '/github/start', { method: 'POST' })
                    window.location.assign(r.url)
                  } catch (e) {
                    setTrouble(e instanceof Refused ? e.message : String(e))
                    setBusy(false)
                  }
                }}
              >
                {busy ? W.connecting : linked === false ? W.linkYoursFirst : W.connect}
              </Button>
            ))}
        </div>
      </Panel>
    </section>
  )
}

type Me = { configured: boolean; linked: { login: string; avatar_url: string | null } | null }

/** In Account settings: who you are on GitHub, yours to connect. */
export function GithubAccount() {
  const [me, setMe] = useState<Me | null>(() => known<Me>('/github/me') ?? null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const load = useCallback(async () => setMe(await ahead<Me>('/github/me')), [])

  useEffect(() => {
    /* Back from GitHub with its code: finished here, with this session,
       and the address put back. */
    const q = new URLSearchParams(window.location.search)
    const code = q.get('code')
    const state = q.get('state')
    if (q.get('github') === 'linked' && code && state) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
      setBusy(true)
      void api('/github/me', { method: 'POST', body: JSON.stringify({ code, state }) })
        .catch((e) => setTrouble(e instanceof Refused ? e.message : String(e)))
        .finally(() => {
          setBusy(false)
          void load()
        })
    } else {
      void load().catch(() => {})
    }
  }, [load])

  if (!me?.configured) return null
  return (
    <section data-testid="github-me" className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.yours}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
          <Icon name="github" size={20} className="text-ink" />
          <div className="flex min-w-px flex-1 flex-col gap-1">
            <span className="text-base text-ink">{me.linked ? W.yoursAs(me.linked.login) : W.yours}</span>
            <span className="text-sm" style={{ color: trouble ? 'var(--danger)' : 'var(--ink-3)' }}>
              {trouble ?? W.yoursHint}
            </span>
          </div>
          {me.linked ? (
            <Button
              data-testid="github-me-unlink"
              onClick={async () => {
                await api('/github/me', { method: 'DELETE' })
                await load()
              }}
            >
              {W.unlinkYours}
            </Button>
          ) : (
            <Button
              tone="primary"
              data-testid="github-me-link"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setTrouble(null)
                try {
                  window.location.assign((await api<{ url: string }>('/github/me/start', { method: 'POST' })).url)
                } catch (e) {
                  setTrouble(e instanceof Refused ? e.message : String(e))
                  setBusy(false)
                }
              }}
            >
              {busy ? W.connecting : W.linkYours}
            </Button>
          )}
        </div>
      </Panel>
    </section>
  )
}

type Repo = { id: number; name: string; private: boolean; project_id: string | null }
type Link = { repo_id: string; repo_name: string; private: boolean; issues: boolean; linked_by_name: string; stopped_at: string | null }

/** In a project's settings: which repository is its, for whoever may change its settings. */
export function ProjectGithub({ projectId, may }: { projectId: string; may: boolean }) {
  const [hello, setHello] = useState<Hello | null>(() => known<Hello>('/github') ?? null)
  const [link, setLink] = useState<Link | null>(() => known<{ link: Link | null }>(`/projects/${projectId}/github`)?.link ?? null)
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  /* The switch moves when pressed, not when the server has answered. */
  const [syncing, setSyncing] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    const [h, l] = await Promise.all([ahead<Hello>('/github'), ahead<{ link: Link | null }>(`/projects/${projectId}/github`)])
    setHello(h)
    setLink(l.link)
    if (h.install && may) setRepos((await api<{ repos: Repo[] }>('/github/repos')).repos)
  }, [projectId, may])
  useEffect(() => void load().catch(() => {}), [load])

  if (!hello?.configured) return null
  return (
    <section data-testid="project-github" className="flex flex-col gap-3">
      <SectionHead>{W.head}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
          <Icon name="github" size={20} className="text-ink" />
          <div className="flex min-w-px flex-1 flex-col gap-1">
            {hello.install && may ? (
              <select
                data-testid="github-repo"
                aria-label={W.repository}
                data-pill
                value={link?.repo_id ?? ''}
                onChange={async (e) => {
                  setTrouble(null)
                  try {
                    if (!e.target.value) await api(`/projects/${projectId}/github`, { method: 'DELETE' })
                    else
                      await api(`/projects/${projectId}/github`, {
                        method: 'PUT',
                        body: JSON.stringify({ repo_id: Number(e.target.value) }),
                      })
                  } catch (err) {
                    setTrouble(err instanceof Refused ? err.message : String(err))
                  }
                  await load()
                }}
                className="h-8 max-w-full rounded-full bg-transparent px-3 text-base text-ink"
                style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
              >
                <option value="">{W.noRepository}</option>
                {(repos ?? (link ? [{ id: Number(link.repo_id), name: link.repo_name, private: true, project_id: projectId }] : [])).map(
                  (r) => (
                    <option key={r.id} value={String(r.id)} disabled={Boolean(r.project_id && r.project_id !== projectId)}>
                      {r.name}
                      {r.project_id && r.project_id !== projectId ? ` — ${W.takenBy}` : ''}
                    </option>
                  ),
                )}
              </select>
            ) : (
              <span className="text-base text-ink">{link?.repo_name ?? (hello.install ? W.noRepository : W.ownerConnects)}</span>
            )}
            <span className="text-sm" style={{ color: trouble || link?.stopped_at ? 'var(--danger)' : 'var(--ink-3)' }}>
              {trouble ?? (link ? (link.stopped_at ? W.stopped(link.linked_by_name) : W.linkedBy(link.linked_by_name)) : W.linkHint)}
            </span>
          </div>
          {link?.stopped_at && may && (
            /* Linked again as whoever presses it, who is who it acts as now. */
            <Button
              data-testid="github-relink"
              onClick={async () => {
                setTrouble(null)
                try {
                  await api(`/projects/${projectId}/github`, {
                    method: 'PUT',
                    body: JSON.stringify({ repo_id: Number(link.repo_id), issues: link.issues, confirm: link.repo_name }),
                  })
                } catch (err) {
                  setTrouble(err instanceof Refused ? err.message : String(err))
                }
                await load()
              }}
            >
              {W.relink}
            </Button>
          )}
        </div>
        {link && (
          <>
            <Hairline inset={16} />
            {/* Code, or code and issues — chosen here, not a setting with a
                default: A public repository is
                confirmed by its name, since all of it becomes public. */}
            <div className="flex min-h-[56px] items-center gap-4 px-4 py-3">
              <span className="flex min-w-px flex-1 flex-col gap-1">
                <span className="text-base text-ink">{W.syncIssues}</span>
                <span className="text-sm text-ink-3">{W.syncIssuesHint}</span>
              </span>
              <Switch
                testId="github-issues"
                said={W.syncIssues}
                on={syncing ?? link.issues}
                disabled={!may}
                onChange={async (on) => {
                  let confirm: string | undefined
                  if (on && !link.private) {
                    confirm = window.prompt(W.confirmPublic(link.repo_name)) ?? undefined
                    if (confirm === undefined) return
                  }
                  setTrouble(null)
                  setSyncing(on)
                  try {
                    await api(`/projects/${projectId}/github`, {
                      method: 'PUT',
                      body: JSON.stringify({ repo_id: Number(link.repo_id), issues: on, ...(confirm ? { confirm } : {}) }),
                    })
                  } catch (err) {
                    setTrouble(err instanceof Refused ? err.message : String(err))
                  }
                  await load()
                  setSyncing(null)
                }}
              />
            </div>
          </>
        )}
      </Panel>
    </section>
  )
}

/** On a task: the pull requests that name it, as GitHub last said they stand. */
export function PullsOnTask({
  pulls,
  issue = null,
}: {
  pulls: PullOnTask[]
  issue?: { number: number; repo_name: string; url: string } | null
}) {
  if (pulls.length === 0 && !issue) return null
  return (
    <section data-testid="task-pulls" className="flex flex-col gap-2">
      <SectionHead>{W.onGithub}</SectionHead>
      <Panel>
        {issue && (
          <a
            data-issue={issue.number}
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[48px] items-center gap-3 px-4 py-2 text-base mouse:hover:bg-[var(--hover)]"
          >
            <Icon name="github" size={16} className="text-ink" />
            <span className="min-w-px flex-1 truncate text-ink">{W.issueIn(issue.repo_name)}</span>
            <span className="shrink-0 text-sm tabular-nums text-ink-3">#{issue.number}</span>
          </a>
        )}
        {issue && pulls.length > 0 && <Hairline inset={16} />}
        {pulls.map((p, i) => (
          <div key={`${p.repo_name}#${p.number}`} className="contents">
            {i > 0 && <Hairline inset={16} />}
            <a
              data-pull={p.number}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="@container flex min-h-[48px] items-center gap-3 px-4 py-2 text-base mouse:hover:bg-[var(--hover)]"
            >
              <Icon name={standing(p).glyph} size={16} style={{ color: standing(p).color }} />
              {/* Only the title gives way; what stands after it is short and
                  is kept whole, the pill above all — a review cut to
                  "Approv…" says less than a shorter title does. On a phone
                  "Closes it" goes, to leave the title some room. */}
              <span className="min-w-0 grow truncate text-ink">{p.title}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="shrink-0 text-sm tabular-nums text-ink-3">#{p.number}</span>
                <StatePill p={p} />
                {review(p) && <span className="whitespace-nowrap text-sm text-ink-2">{review(p)}</span>}
                <ChecksMark p={p} />
                {p.closes && p.state !== 'closed' && (
                  <span className="whitespace-nowrap text-sm text-ink-3 @max-[480px]:hidden">{W.closes}</span>
                )}
              </span>
            </a>
          </div>
        ))}
      </Panel>
    </section>
  )
}

/*
 * Where a pull request stands, as GitHub draws it: the glyph, the colour and
 * the word go together, so the state is read three ways at once rather than
 * guessed from a tinted logo and a grey caption. A draft is a draft before it
 * is open — GitHub says "Draft", not "Open", on one.
 */
export function standing(p: Pick<PullOnTask, 'state' | 'draft'>): {
  key: 'open' | 'merged' | 'closed' | 'draft'
  glyph: 'pullOpen' | 'pullMerged' | 'pullClosed' | 'pullDraft'
  color: string
  word: string
} {
  if (p.state === 'merged') return { key: 'merged', glyph: 'pullMerged', color: 'var(--gh-merged)', word: W.merged }
  if (p.state === 'closed') return { key: 'closed', glyph: 'pullClosed', color: 'var(--gh-closed)', word: W.closed }
  if (p.draft) return { key: 'draft', glyph: 'pullDraft', color: 'var(--gh-draft)', word: W.draft }
  return { key: 'open', glyph: 'pullOpen', color: 'var(--gh-open)', word: W.open }
}

/* The state as a word in its colour, on a wash of it — the label pill's
   family, at its height, and never shortened. */
function StatePill({ p }: { p: PullOnTask }) {
  const s = standing(p)
  return (
    <span
      data-pull-state={s.key}
      className="inline-flex h-5 shrink-0 items-center px-2 text-xs font-medium whitespace-nowrap"
      style={{
        color: s.color,
        background: `color-mix(in var(--mark-space), ${s.color} var(--mark-wash-pct), transparent)`,
        borderRadius: 'var(--r-pill)',
        letterSpacing: 'var(--track-body)',
      }}
    >
      {s.word}
    </span>
  )
}

/* What the reviewers said, while there is still something for them to say. */
function review(p: PullOnTask): string | null {
  if (p.state !== 'open') return null
  if (p.review === 'approved') return W.approved
  if (p.review === 'changes') return W.changes
  if (p.review === 'requested') return W.inReview
  return null
}

/* The checks as one mark, apart from the state: a tick, a cross, or an amber
   dot while they run. Named for whoever cannot see the colour. */
function ChecksMark({ p }: { p: PullOnTask }) {
  if (p.state !== 'open' || !p.checks) return null
  const [label, color] =
    p.checks === 'success'
      ? [W.checksPassed, 'var(--gh-open)']
      : p.checks === 'failure'
        ? [W.checksFailed, 'var(--gh-closed)']
        : [W.checksRunning, 'var(--gh-running)']
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-checks={p.checks}
      className="flex size-4 shrink-0 items-center justify-center"
      style={{ color }}
    >
      {p.checks === 'success' ? (
        <Icon name="check" size={16} />
      ) : p.checks === 'failure' ? (
        <Icon name="close" size={16} />
      ) : (
        <span className="size-2 rounded-full" style={{ background: color }} />
      )}
    </span>
  )
}
