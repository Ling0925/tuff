import { useState } from 'react'
import type { RoomHook, RoomHookAddress, RoomHooks as Listed } from '@tracker/shared-schema'
import { api } from '../../data/api.js'
import { recall, remember } from '../../data/memory.js'
import { CHANNELS as W } from '../../words/channels.js'
import { Button, Dialog, Hairline, notALogin, asTyped } from '../kit.jsx'
import { ago } from './messageRow.jsx'

/*
 * A room's incoming webhooks.
 *
 * Read ahead when the room's gear is reached for, and the window opened
 * only once the list is here (or after 400 ms on what this machine kept),
 * so it is drawn whole rather than as a frame that fills.
 */

const kept = (roomId: string) => `room-hooks:${roomId}`

/** The list, asked for and kept; what was kept, at once, while it comes. */
export function warmHooks(roomId: string): Promise<RoomHook[]> {
  return api<Listed>(`/conversations/${roomId}/hooks`).then((r) => {
    remember(kept(roomId), r.hooks)
    return r.hooks
  })
}

/** Opened with the list in hand: wait for it up to 400 ms, then use what was kept. */
export async function hooksAhead(roomId: string): Promise<RoomHook[]> {
  const had = recall<RoomHook[]>(kept(roomId))
  const fresh = warmHooks(roomId).catch(() => had ?? [])
  const late = new Promise<RoomHook[] | null>((done) => setTimeout(() => done(had), 400))
  return (await Promise.race([fresh, late])) ?? fresh
}

export function RoomHooksWindow({
  roomId,
  roomSaid,
  first,
  onClose,
}: {
  roomId: string
  /** The room as the column writes it — `#general`. */
  roomSaid: string
  /** The list it opens with, read ahead. */
  first: RoomHook[]
  onClose: () => void
}) {
  const [hooks, setHooks] = useState<RoomHook[]>(first)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  /* The address made or turned over a moment ago — shown this once. */
  const [fresh, setFresh] = useState<RoomHookAddress | null>(null)
  const [copied, setCopied] = useState(false)
  /* Which row is asking "are you sure", and about what. */
  const [sure, setSure] = useState<{ id: string; what: 'turn' | 'remove' } | null>(null)

  const reread = () =>
    warmHooks(roomId)
      .then(setHooks)
      .catch(() => {})

  const add = async () => {
    const said = name.trim()
    if (!said || busy) return
    setBusy(true)
    try {
      const made = await api<RoomHookAddress>(`/conversations/${roomId}/hooks`, { method: 'POST', body: JSON.stringify({ name: said }) })
      setFresh(made)
      setCopied(false)
      setName('')
      await reread()
    } finally {
      setBusy(false)
    }
  }
  const turn = async (id: string) => {
    setSure(null)
    const made = await api<RoomHookAddress>(`/hooks/${id}/turn`, { method: 'POST' })
    setFresh(made)
    setCopied(false)
    await reread()
  }
  const remove = async (id: string) => {
    setSure(null)
    /* Off the list first; read again after, which puts it back if refused. */
    setHooks((had) => had.filter((h) => h.id !== id))
    if (fresh?.id === id) setFresh(null)
    await api(`/hooks/${id}`, { method: 'DELETE' }).catch(() => {})
    await reread()
  }

  return (
    <Dialog
      title={W.hooks}
      testId="room-hooks"
      onClose={onClose}
      footer={
        <div className="flex flex-1 justify-end">
          <Button tone="primary" data-testid="room-hooks-done" onClick={onClose}>
            {W.done}
          </Button>
        </div>
      }
    >
      <div data-room-hooks className="flex flex-col gap-3 px-4 pb-2">
        <p className="text-sm text-ink-2">{W.hooksSaid(roomSaid)}</p>
        {fresh && (
          <div data-hook-url className="flex flex-col gap-2 rounded-[var(--r-field)] p-3 bg-sunken">
            <span className="text-sm font-medium text-ink">{W.copyNow}</span>
            <div className="flex items-center gap-2">
              <input
                {...notALogin}
                {...asTyped}
                readOnly
                data-testid="hook-url"
                value={fresh.url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 min-w-px flex-1 rounded-[var(--r-row)] px-2 font-mono text-xs outline-none bg-surface text-ink"
              />
              <Button
                data-testid="copy-hook-url"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(fresh.url)
                    .then(() => setCopied(true))
                    .catch(() => {})
                }
              >
                {copied ? W.copied : W.copy}
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-col">
          {hooks.length === 0 && <p className="py-2 text-sm text-ink-3">{W.noHooks}</p>}
          {hooks.map((h, i) => (
            <div key={h.id} className="contents">
              {i > 0 && <Hairline />}
              <div data-hook-row={h.id} className="flex min-h-12 items-center gap-3 py-2">
                <span className="flex min-w-px flex-1 flex-col">
                  <span className="truncate text-base font-medium text-ink">{h.name}</span>
                  <span data-hook-stopped={h.stopped_at ? '' : undefined} className="truncate text-sm text-ink-3">
                    {h.stopped_at
                      ? W.hookStopped
                      : W.hookBy(h.created_by_name, Boolean(h.turned_at), h.last_used_at ? ago(h.last_used_at) : null)}
                  </span>
                </span>
                {sure?.id === h.id ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-sm text-ink-2">{sure.what === 'turn' ? W.newUrlSure : W.removeSure}</span>
                    <Button
                      tone={sure.what === 'remove' ? 'danger' : 'primary'}
                      data-testid={sure.what === 'turn' ? 'confirm-new-hook-url' : 'confirm-remove-hook'}
                      onClick={() => void (sure.what === 'turn' ? turn(h.id) : remove(h.id))}
                    >
                      {sure.what === 'turn' ? W.newUrl : W.remove}
                    </Button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button data-testid="new-hook-url" onClick={() => setSure({ id: h.id, what: 'turn' })}>
                      {W.newUrl}
                    </Button>
                    <Button tone="danger" data-testid="remove-hook" onClick={() => setSure({ id: h.id, what: 'remove' })}>
                      {W.remove}
                    </Button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            {...notALogin}
            data-testid="hook-name"
            aria-label={W.hookName}
            placeholder={W.hookName}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            className="h-8 min-w-px flex-1 rounded-[var(--r-row)] px-3 text-base outline-none bg-track text-ink placeholder:text-[var(--ink-3)]"
          />
          <Button tone="primary" data-testid="add-hook" disabled={!name.trim() || busy} onClick={() => void add()}>
            {W.addHook}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
