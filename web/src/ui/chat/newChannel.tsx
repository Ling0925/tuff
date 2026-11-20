import { useState, useEffect } from 'react'
import { MORE, MAKE, PLACES } from '../../data/words.js'
import { CHAT as W } from '../../words/chat.js'
import { type PersonInWorkspace } from '@tracker/shared-schema'
import { api, unlessOffline } from '../../data/api.js'
import { Icon } from '../glyphs.jsx'
import { Dialog, Button, Avatar, notALogin, findField } from '../kit.jsx'
import { asChannelName } from '../Channels.jsx'

/**
 * A channel, and who is in it, decided together.
 *
 * Not a name on its own. A room made for the whole project and a room made
 * for four people are different things and look identical once they exist —
 * so the question is asked while it is still being made, when the answer is
 * cheap. Nobody chosen means the project, which is the common case and the
 * one that needs no work.
 */
export function NewChannel({
  projectId,
  meId,
  onMade,
  round = false,
  wide = true,
}: {
  projectId: string
  /** Whoever is making it, who is in it whatever else is chosen. */
  meId?: string | undefined
  /** Given the new channel's id, to open it. */
  onMade: (id: string) => Promise<void>
  /** The disc beside the name, as the tasks' plus is — TRA-98. */
  round?: boolean
  /** Beside the name it opens rightwards; at the end of a phone's row,
      leftwards, or it opens off the screen. */
  wide?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [people, setPeople] = useState<PersonInWorkspace[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  /* Narrowing the list by name. */
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!open) return
    void api<{ members: PersonInWorkspace[] }>(`/projects/${projectId}/members`)
      .then((r) => setPeople(r.members ?? []))
      .catch(unlessOffline(() => setPeople([])))
  }, [open, projectId])

  /*
   * Who is in it. Whoever makes it always is — ticked, and not to be
   * unticked: a channel its maker is not in is one they cannot open. Everyone
   * ticked is the project's channel, which follows whoever joins the project
   * later; fewer is the people ticked.
   */
  const chosen = new Set(picked)
  if (meId) chosen.add(meId)
  const all = people.length > 0 && people.every((p) => chosen.has(p.actor_id))

  async function make() {
    const title = name.trim()
    if (!title) return
    setOpen(false)
    setName('')
    const r = await api<{ id: string }>(`/projects/${projectId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({
        name: title,
        ...(all ? {} : { member_ids: [...chosen] }),
      }),
    })
    setPicked(new Set())
    await onMade(r.id)
  }

  return (
    <span className="relative shrink-0">
      {round ? (
        <button
          data-control
          data-testid="create-new-channel"
          aria-label={MORE.newChannel}
          title={MORE.newChannel}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: open ? 'var(--track-on)' : 'var(--track)', color: open ? 'var(--ink)' : 'var(--ink-2)' }}
        >
          <Icon name="plusThin" size={15} />
        </button>
      ) : (
        <button
          data-testid="create-new-channel"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 shrink-0 items-center gap-2 pr-4 pl-3 text-base font-medium bg-hover text-ink"
          style={{ borderRadius: 'var(--r-pill)' }}
        >
          <Icon name="plus" size={16} />
          {MORE.newChannel}
        </button>
      )}
      {/*
        Its own window, as making a task or a project is — dimmed and soft
        behind, the name on top, who is in it, Create at the foot. It was a
        panel hanging off the button, and over a room in the dark it ran into
        what it stood on.
      */}
      {open && (
        <Dialog
          title={MORE.newChannel}
          testId="new-channel"
          onClose={() => setOpen(false)}
          footer={
            <>
              <div className="flex-1" />
              <Button tone="primary" data-testid="make-channel" disabled={!name.trim()} onClick={() => void make()}>
                {MORE.create}
              </Button>
            </>
          }
        >
          <div className="px-4 pt-1 pb-2">
            <input
              {...notALogin}
              autoFocus
              data-testid="draft-new-channel"
              className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-[var(--ink-3)]"
              style={{ color: 'var(--ink)', letterSpacing: 'var(--track-title)' }}
              placeholder={MAKE.whatIsItFor}
              value={name}
              /* Written the way it will be kept. */
              onChange={(e) => setName(asChannelName(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void make()
                }
              }}
            />
          </div>
          <div className="flex items-center px-4 pt-2 pb-1 text-sm text-ink-3">
            <span className="flex-1">{all ? W.everyoneOnProject : chosen.size === 1 && meId ? W.onlyYou : W.selected(chosen.size)}</span>
            <button
              type="button"
              data-testid="pick-all-members"
              onClick={() => setPicked(all ? new Set() : new Set(people.map((p) => p.actor_id)))}
              className="h-7 rounded-full px-2 font-medium transition-colors mouse:hover:bg-[var(--hover)] text-accent"
            >
              {all ? W.clear : W.selectAll}
            </button>
          </div>
          {people.length > 7 && (
            <div className="px-4 pt-1 pb-1">
              <input
                {...findField}
                data-testid="find-people"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={PLACES.findSomebody}
                className="h-8 w-full rounded-full px-3 text-base outline-none placeholder:text-[var(--ink-3)] bg-track"
                style={{ color: 'var(--ink)' }}
              />
            </div>
          )}
          <div className="max-h-[288px] overflow-y-auto pb-2">
            {people
              .filter((p) => !typed.trim() || p.name.toLowerCase().includes(typed.trim().toLowerCase()))
              .map((p) => (
                <label
                  key={p.actor_id}
                  data-pick-member={p.actor_id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors mouse:hover:bg-[var(--hover)]"
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 disabled:opacity-60"
                    checked={chosen.has(p.actor_id)}
                    disabled={p.actor_id === meId}
                    onChange={(e) =>
                      setPicked((was) => {
                        const next = new Set(was)
                        if (e.target.checked) next.add(p.actor_id)
                        else next.delete(p.actor_id)
                        return next
                      })
                    }
                  />
                  <Avatar name={p.name} id={p.actor_id} url={p.avatar_url} size={24} />
                  <span className="flex-1 truncate text-base text-ink">{p.name}</span>
                </label>
              ))}
          </div>
        </Dialog>
      )}
    </span>
  )
}
