import { useEffect, useState } from 'react'
import { AFTER_SIGN_IN, api, setSession, stored, type Session } from '../data/api.js'
import { AuthShell, primaryLook } from './Access.jsx'
import { Avatar } from './kit/avatar.jsx'
import { CONNECT as W } from '../words/connect.jsx'

/**
 * An agent asking to be connected.
 *
 * ChatGPT, Claude on the web or any MCP client sends the person here with
 * who it is, where to send them back and a PKCE challenge. The page says
 * which agent, which workspace it will work in and what it may not do, and
 * asks. Allow sends the browser back with a one-time code; Cancel sends it
 * back with `access_denied`, so the agent can say so rather than wait.
 */

type Me = { actor: { id: string; name: string; avatar_url?: string | null }; workspace: { id: string; name: string } }
/** An agent the person manages, and may sign the connection in as. */
type Managed = { id: string; name: string; avatar_url: string | null }

/* What the server said, or ours when all it gave was a status. */
const said = (e: Error, fallback: string) => (e.message && !/^\d+$|^unauthorized$/.test(e.message) ? e.message : fallback)
type Workspace = { id: string; name: string }

export function Connect() {
  const q = new URLSearchParams(location.search)
  const asked = {
    client_id: q.get('client_id') ?? '',
    redirect_uri: q.get('redirect_uri') ?? '',
    code_challenge: q.get('code_challenge') ?? '',
    code_challenge_method: q.get('code_challenge_method') ?? '',
    state: q.get('state') ?? undefined,
  }
  const [agent, setAgent] = useState<string | null>(null)
  const [managed, setManaged] = useState<Managed[]>([])
  /* Whom it signs in as: null is the person. A `login_hint` naming one of
     their agents picks it here; only Allow sends it. */
  const [as, setAs] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [all, setAll] = useState<Workspace[]>([])
  const [wrong, setWrong] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const signedIn = Boolean(stored())
  /* Where the code goes, which is what proves who is asking: the name is
     whatever the agent called itself when it registered, and anybody may
     register as "Claude" with an address of their own. */
  const goesTo = (() => {
    try {
      return new URL(asked.redirect_uri).host
    } catch {
      return ''
    }
  })()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.title = W.docTitle
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, for the link the page arrived with
  useEffect(() => {
    if (!signedIn) return
    if (q.get('response_type') !== 'code' || asked.code_challenge_method !== 'S256' || !asked.code_challenge) {
      setWrong(W.badLink)
      return
    }
    const who = `/oauth/client?client_id=${encodeURIComponent(asked.client_id)}&redirect_uri=${encodeURIComponent(asked.redirect_uri)}`
    void Promise.all([
      api<{ name: string; agents?: Managed[] }>(who),
      api<Me>('/me'),
      api<{ workspaces: Workspace[] }>('/workspaces').catch(() => ({ workspaces: [] })),
    ])
      .then(([a, m, w]) => {
        setAgent(a.name)
        const mine = a.agents ?? []
        setManaged(mine)
        const hint = q.get('login_hint')
        if (hint && mine.some((g) => g.id === hint)) setAs(hint)
        setMe(m)
        setAll(w.workspaces)
      })
      .catch((e: Error) => {
        /* The session ran out while the page was open: sign in again. */
        if (e.message === 'unauthorized') return location.reload()
        setWrong(said(e, W.badLink))
      })
    // Once, for the link the page arrived with.
  }, [signedIn])

  /* Another workspace: a session for it, and the same page again. */
  async function into(id: string) {
    const s = await api<Session>(`/workspaces/${id}/enter`, { method: 'POST' })
    setSession(s)
    location.reload()
  }

  async function allow() {
    if (busy) return
    setBusy(true)
    try {
      const r = await api<{ redirect: string }>('/oauth/authorize', {
        method: 'POST',
        body: JSON.stringify({ ...asked, agent_id: as }),
      })
      location.assign(r.redirect)
    } catch (e) {
      setBusy(false)
      setWrong(said(e as Error, W.didntWork))
    }
  }

  /* Only once the server has said the address is this client's: a refusal
     is sent nowhere it has not checked. */
  function cancel() {
    const to = new URL(asked.redirect_uri)
    to.searchParams.set('error', 'access_denied')
    if (asked.state !== undefined) to.searchParams.set('state', asked.state)
    location.assign(to.toString())
  }

  if (!signedIn) {
    return (
      <AuthShell title={W.connectAnAgent}>
        <p className="text-center text-md text-ink-2">{W.signInFirst}</p>
        <button
          data-testid="connect-sign-in"
          onClick={() => {
            try {
              sessionStorage.setItem(AFTER_SIGN_IN, location.pathname + location.search)
            } catch {
              /* Without storage they sign in and start again from the agent. */
            }
            location.assign('/signin')
          }}
          className="h-11 rounded-[var(--r-field)] text-md font-medium"
          style={primaryLook}
        >
          {W.signIn}
        </button>
      </AuthShell>
    )
  }

  if (wrong) {
    return (
      <AuthShell title={W.connectAnAgent}>
        <p data-testid="connect-wrong" className="text-center text-md text-ink-2">
          {wrong}
        </p>
      </AuthShell>
    )
  }

  /* Drawn whole or not at all: the name and the workspace arrive together. */
  if (!agent || !me) return null
  const picked = managed.find((g) => g.id === as) ?? null

  return (
    <AuthShell title={W.connectNamed(agent)}>
      <div data-testid="connect" className="flex flex-col gap-4 rounded-[var(--r-card)] p-6 bg-surface">
        <p data-testid="connect-wants" className="text-md leading-[1.5]">
          {picked ? W.wantsAs(<b>{agent}</b>, <b>{picked.name}</b>) : W.wants(<b>{agent}</b>)}
        </p>
        <p data-testid="connect-goes-to" className="text-base leading-[1.5] text-ink-2">
          {W.goesTo(<b className="text-ink">{goesTo}</b>)}
        </p>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-ink-3">{W.workspace}</span>
          {all.length > 1 ? (
            <select
              data-testid="connect-workspace"
              value={me.workspace.id}
              onChange={(e) => void into(e.target.value)}
              className="h-11 rounded-[var(--r-field)] px-4 text-md bg-sunken text-ink"
            >
              {all.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-md font-medium">{me.workspace.name}</span>
          )}
        </div>
        {managed.length > 0 && (
          /* Whom it works as: the person, or an agent they manage. Chosen
             here and sent only by Allow. */
          <div className="flex flex-col gap-2">
            <span id="connect-as-label" className="text-sm text-ink-3">
              {W.signInAs}
            </span>
            <div role="radiogroup" aria-labelledby="connect-as-label" data-testid="connect-as" className="flex flex-col gap-1">
              {[
                { id: null, name: W.you(me.actor.name), avatar_url: me.actor.avatar_url ?? null, face: me.actor.id },
                ...managed.map((g) => ({ ...g, face: g.id })),
              ].map((o) => {
                const on = as === o.id
                return (
                  <button
                    key={o.face}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-connect-as={o.id ?? 'me'}
                    onClick={() => setAs(o.id)}
                    className="flex h-11 items-center gap-3 rounded-[var(--r-field)] px-3 text-left text-md text-ink transition-colors"
                    style={{ background: on ? 'var(--hover)' : 'var(--sunken)', boxShadow: on ? 'inset 0 0 0 2px var(--accent)' : 'none' }}
                  >
                    <Avatar id={o.face} name={o.name} url={o.avatar_url} size={24} on={on ? 'var(--hover)' : 'var(--sunken)'} />
                    <span className="min-w-px flex-1 truncate">{o.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <ul className="flex flex-col gap-2 text-base leading-[1.5] text-ink-2">
          <li>{picked ? W.agentCanChange(picked.name) : W.canChange}</li>
          <li>{W.cantDelete}</li>
          <li>{picked ? W.agentUnderName(picked.name) : W.underYourName}</li>
        </ul>
      </div>
      <button
        data-testid="connect-allow"
        onClick={() => void allow()}
        disabled={busy}
        className="h-11 rounded-[var(--r-field)] text-md font-medium"
        style={primaryLook}
      >
        {W.allow}
      </button>
      <button data-testid="connect-cancel" onClick={cancel} className="h-11 rounded-[var(--r-field)] text-md bg-hover text-ink">
        {W.cancel}
      </button>
    </AuthShell>
  )
}
