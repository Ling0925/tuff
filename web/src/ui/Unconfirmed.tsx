import { useState } from 'react'
import { api, setSession, type Session } from '../data/api.js'
import { UNCONFIRMED as W } from '../words/unconfirmed.js'
import { AuthShell, fieldLook, primaryLook } from './Access.jsx'

/** A workspace the account joined before its address was confirmed. */
export type Waiting = { id: string; name: string; role: string }

/**
 * Check your workspaces.
 * The account joined these before its address was
 * proved, by its owner or by whoever held it then; each opens nothing until
 * the person presses Join or Leave here. A screen of its own, before the
 * workspace or No workspaces, drawn once the list is known so it opens whole.
 *
 * Each press sends `{ answer }` and nothing else; nothing here answers by
 * itself. A Join from a session in no workspace comes back with a session
 * for the workspace joined, which is where the app goes next.
 */
export function Unconfirmed({ waiting, onDone }: { waiting: Waiting[]; onDone: (joined: boolean) => void }) {
  const [left, setLeft] = useState(waiting)
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [joinedAny, setJoinedAny] = useState(false)

  const answer = async (id: string, what: 'join' | 'leave') => {
    setBusy(id)
    setSaid(null)
    try {
      const r = await api<{ ok: true; answer: 'joined' | 'left' } & Partial<Session>>(`/me/unconfirmed/${id}`, {
        method: 'POST',
        body: JSON.stringify({ answer: what }),
      })
      /* Joined from no workspace: a session for the one joined. */
      if (r.access_token) {
        setSession(r as Session)
        location.assign('/')
        return
      }
      const rest = left.filter((w) => w.id !== id)
      const joined = joinedAny || r.answer === 'joined'
      setJoinedAny(joined)
      setLeft(rest)
      setBusy(null)
      if (rest.length === 0) onDone(joined)
    } catch {
      setSaid(W.couldntSave)
      setBusy(null)
    }
  }

  return (
    <div data-testid="unconfirmed" data-whole="unconfirmed">
      <AuthShell title={W.title}>
        <p className="text-center text-md text-ink-2">{W.body}</p>
        <p className="text-center text-md text-ink-2">{W.hint}</p>
        <section className="mt-4 flex flex-col gap-2">
          {left.map((w) => (
            <div
              key={w.id}
              data-testid="unconfirmed-row"
              className="flex min-h-12 items-center gap-2 rounded-xl py-2 pr-2 pl-4"
              style={fieldLook}
            >
              <span className="flex min-w-px flex-1 flex-col">
                <span className="truncate text-md text-ink">{w.name}</span>
                {w.role === 'owner' && <span className="text-sm text-ink-3">{W.owner}</span>}
              </span>
              {/* The owner's role is not left: a workspace keeps its owner. */}
              {w.role !== 'owner' && (
                <button
                  type="button"
                  data-testid="unconfirmed-leave"
                  disabled={busy !== null}
                  onClick={() => void answer(w.id, 'leave')}
                  className="h-8 rounded-full px-4 text-base font-medium text-ink-2"
                >
                  {W.leave}
                </button>
              )}
              <button
                type="button"
                data-testid="unconfirmed-join"
                disabled={busy !== null}
                onClick={() => void answer(w.id, 'join')}
                className="h-8 rounded-full px-4 text-base font-medium"
                style={primaryLook}
              >
                {W.join}
              </button>
            </div>
          ))}
        </section>
        {said && (
          <p role="alert" className="text-center text-sm text-danger">
            {said}
          </p>
        )}
      </AuthShell>
    </div>
  )
}
