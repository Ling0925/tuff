import { useState } from 'react'
import { api, setSession, wipe, type Session } from '../data/api.js'
import { ACCOUNT as W } from '../words/account.jsx'
import { SIDEBAR as S } from '../words/sidebar.js'
import { Button, Dialog, Panel, SectionHead } from './kit.jsx'

/**
 * Three ways out: the workspace, a channel, and
 * following an announcement or a document. Each asked before it is done
 * where it is more than a switch, and each waits for the server rather than
 * moving first: a room or a workspace that vanished and came back on a
 * refusal is worse than a second of "Leaving…".
 */

type Left = { ok: boolean; session: Session; workspace: { id: string; slug: string; name: string } | null }

/**
 * Leave workspace, the last-but-one section of Account. The owner reads why
 * not and is offered the hand-over instead of the button.
 */
export function LeaveWorkspace({
  workspace,
  owner,
  may,
  onHandOver,
}: {
  workspace: { name: string }
  owner: boolean
  /** `workspace.leave` in `/api/me`'s answers — the server still decides. */
  may: boolean
  onHandOver?: (() => void) | undefined
}) {
  const [asking, setAsking] = useState(false)
  if (!may && !owner) return null
  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.leaveWorkspace}</SectionHead>
      <Panel>
        <div className="flex items-center gap-4 px-4 py-3" data-testid="leave-workspace-row">
          <div className="flex min-w-px flex-1 flex-col gap-1">
            <span className="text-base text-ink">{workspace.name}</span>
            <span className="text-sm text-ink-3">{owner ? W.ownerCantLeave(workspace.name) : W.leaveWorkspaceHint(workspace.name)}</span>
          </div>
          {owner ? (
            onHandOver && (
              <Button data-testid="leave-workspace-hand-over" onClick={onHandOver}>
                {W.handOver}
              </Button>
            )
          ) : (
            <Button
              data-testid="leave-workspace"
              onClick={() => setAsking(true)}
              style={{ background: 'color-mix(in oklch, var(--danger) 12%, transparent)', color: 'var(--danger)' }}
            >
              {W.leaveEllipsis}
            </Button>
          )}
        </div>
      </Panel>
      {asking && <LeaveWorkspaceDialog name={workspace.name} onClose={() => setAsking(false)} />}
    </section>
  )
}

function LeaveWorkspaceDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setSaid(null)
    try {
      const r = await api<Left>('/me/leave', { method: 'POST' })
      /* What this browser kept of the workspace left goes before the next
         one is drawn — `docs/specs/offline.md`. The last one left lands on
         No workspaces, which `/` is for a session in none. */
      await wipe()
      setSession(r.session)
      location.assign(r.workspace ? `/${r.workspace.slug}` : '/')
    } catch (e) {
      setSaid((e as Error).message && (e as Error).message !== 'unauthorized' ? (e as Error).message : W.couldntLeave)
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={W.leaveName(name)}
      testId="leave-workspace-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <p role="alert" className="mr-auto min-w-px truncate text-sm text-danger">
            {said}
          </p>
          <button type="button" onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {S.cancel}
          </button>
          <Button
            data-testid="leave-workspace-go"
            disabled={busy}
            onClick={() => void go()}
            style={{ background: 'var(--danger)', color: '#fff' }}
          >
            {busy ? W.leavingWs : W.leaveGo}
          </Button>
        </div>
      }
    >
      <ul className="m-0 flex list-disc flex-col gap-1 px-4 pt-2 pb-4 pl-8 text-base leading-5 text-ink-2">
        <li>{W.leaveLoses}</li>
        <li>{W.leaveKeeps}</li>
        <li>{W.leaveBack}</li>
      </ul>
    </Dialog>
  )
}

/**
 * Leave channel, from a room's menu in the side column. What it says is
 * what it does: a room of chosen people is left, an open project channel is
 * put away and muted, since there is no place in "everybody" to end.
 */
export function LeaveChannelDialog({
  room,
  onClose,
  onLeft,
}: {
  room: { id: string; name: string; chosen: boolean }
  onClose: () => void
  onLeft: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setSaid(null)
    try {
      await api(`/conversations/${room.id}/leave`, { method: 'POST' })
      onLeft()
    } catch (e) {
      setSaid((e as Error).message && (e as Error).message !== 'unauthorized' ? (e as Error).message : S.couldntLeave)
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={S.leaveName(room.name)}
      testId="leave-channel-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <p role="alert" className="mr-auto min-w-px truncate text-sm text-danger">
            {said}
          </p>
          <button type="button" onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {S.cancel}
          </button>
          <Button
            data-testid="leave-channel-go"
            disabled={busy}
            onClick={() => void go()}
            style={{ background: 'var(--danger)', color: '#fff' }}
          >
            {busy ? S.leaving : S.leave}
          </Button>
        </div>
      }
    >
      <p className="px-4 pt-2 pb-4 text-base leading-5 text-ink-2">{room.chosen ? S.leaveChosen(room.name) : S.leaveOpen(room.name)}</p>
    </Dialog>
  )
}

/**
 * Subscribe / Subscribed on an announcement's or a document's head, the
 * pill a task's history has. Moves
 * first and goes back if the server says no, as the task's does.
 */
export function SubscribePill({
  on,
  path,
  onChange,
  words,
  testId,
}: {
  on: boolean
  /** `/posts/:id` or `/files/:id`. */
  path: string
  onChange: (on: boolean) => void
  words: { subscribe: string; subscribed: string }
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      onClick={() => {
        const next = !on
        onChange(next)
        void api(`${path}/subscription`, { method: next ? 'POST' : 'DELETE' }).catch(() => onChange(!next))
      }}
      className="inline-flex h-8 items-center rounded-full px-3 text-sm font-medium transition-colors"
      style={{
        background: on ? 'var(--track-on)' : 'var(--track)',
        boxShadow: on ? 'var(--control-shadow)' : undefined,
        color: on ? 'var(--ink)' : 'var(--accent)',
      }}
    >
      {on ? words.subscribed : words.subscribe}
    </button>
  )
}
