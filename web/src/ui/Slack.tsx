import { useCallback, useEffect, useState } from 'react'
import { api, Refused } from '../data/api.js'
import { ahead, known } from '../data/ahead.js'
import { SLACK_POSTS as W } from '../words/slackPosts.js'
import { Icon } from './glyphs.jsx'
import { Button, Panel, SectionHead } from './kit.jsx'

/**
 * Slack: the workspace's connection, the owner's,
 * and the channel a project posts to.
 */

type Hello = { configured: boolean; connection: { team_name: string; broken: boolean; previews: boolean } | null; can_connect: boolean }

/** In the workspace's settings: connecting Slack, the owner's. */
export function SlackSection() {
  const [hello, setHello] = useState<Hello | null>(() => known<Hello>('/slack') ?? null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const load = useCallback(async () => setHello(await ahead<Hello>('/slack')), [])

  useEffect(() => {
    /* Back from Slack with its code: finished here, with this session,
       and the address put back to the settings it is. */
    const q = new URLSearchParams(window.location.search)
    const code = q.get('code')
    const state = q.get('state')
    if (q.get('slack') === 'connected' && code && state) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
      setBusy(true)
      void api('/slack', { method: 'POST', body: JSON.stringify({ code, state }) })
        .catch((e) => setTrouble(e instanceof Refused ? e.message : String(e)))
        .finally(() => {
          setBusy(false)
          void load()
        })
    } else {
      void load().catch(() => {})
    }
  }, [load])

  if (!hello?.can_connect) return null
  const c = hello.connection
  /* Connected before previews: connecting again grants them, and keeps every channel. */
  const again = Boolean(c && (c.broken || !c.previews))
  const start = async () => {
    setBusy(true)
    setTrouble(null)
    try {
      window.location.assign((await api<{ url: string }>('/slack/start', { method: 'POST' })).url)
    } catch (e) {
      setTrouble(e instanceof Refused ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <section data-testid="slack" className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.head}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
          <Icon name="slack" size={20} className="text-ink" />
          <div className="flex min-w-px flex-1 flex-col gap-1">
            <span className="text-base text-ink">{!hello.configured ? W.notSetUp : c ? W.connectedTo(c.team_name) : W.head}</span>
            <span className="text-sm" style={{ color: trouble || c?.broken ? 'var(--danger)' : 'var(--ink-3)' }}>
              {trouble ?? (c ? (c.broken ? W.broken : !c.previews ? W.previewsNeedAgain : W.disconnectHint) : W.connectHint)}
            </span>
          </div>
          {hello.configured && again && (
            <Button tone="primary" data-testid="slack-reconnect" disabled={busy} onClick={start}>
              {busy ? W.connecting : W.connectAgain}
            </Button>
          )}
          {hello.configured &&
            (c ? (
              <Button
                data-testid="slack-disconnect"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setTrouble(null)
                  try {
                    await api('/slack', { method: 'DELETE' })
                  } catch (e) {
                    setTrouble(e instanceof Refused ? e.message : String(e))
                  }
                  setBusy(false)
                  await load()
                }}
              >
                {W.disconnect}
              </Button>
            ) : (
              <Button tone="primary" data-testid="slack-connect" disabled={busy} onClick={start}>
                {busy ? W.connecting : W.connect}
              </Button>
            ))}
        </div>
      </Panel>
    </section>
  )
}

type Channel = { id: string; name: string; private: boolean }
type Link = { channel_id: string; channel_name: string; private: boolean; linked_by_name: string; stopped_at: string | null }

/**
 * In a project's settings: the channel it posts to. Choosing one only
 * shows what will be posted and where; the button under it is what starts
 * it, since everything after goes to people who may not be in Tuff.
 */
export function ProjectSlack({ projectId, may }: { projectId: string; may: boolean }) {
  const [hello, setHello] = useState<Hello | null>(() => known<Hello>('/slack') ?? null)
  const [link, setLink] = useState<Link | null>(() => known<{ link: Link | null }>(`/projects/${projectId}/slack`)?.link ?? null)
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [h, l] = await Promise.all([ahead<Hello>('/slack'), ahead<{ link: Link | null }>(`/projects/${projectId}/slack`)])
    setHello(h)
    setLink(l.link)
    if (h.connection && !h.connection.broken && may) {
      setChannels((await api<{ channels: Channel[] }>('/slack/channels').catch(() => ({ channels: [] }))).channels)
    }
  }, [projectId, may])
  useEffect(() => void load().catch(() => {}), [load])

  if (!hello?.configured) return null
  const c = hello.connection
  const current = link && !link.stopped_at ? link.channel_id : ''
  const chosen = picked ?? current
  const choice = (channels ?? []).find((ch) => ch.id === chosen) ?? null
  const changing = chosen !== current && choice !== null
  /* The project's own channel stays in the list when it is not in Slack's
     answer for this person — a private one, to anybody but the owner. */
  const own = link && !link.stopped_at ? [{ id: link.channel_id, name: link.channel_name, private: link.private }] : []
  const shown = [...own, ...(channels ?? []).filter((ch) => ch.id !== link?.channel_id)]
  /* A private channel's name is the owner's; anybody else reads that it is one. */
  const named = (name: string) => (name ? `#${name}` : W.aPrivateChannel)

  const hint = trouble
    ? trouble
    : changing
      ? W.willPost(named(choice.name))
      : link?.stopped_at
        ? W.stopped(named(link.channel_name))
        : link
          ? W.posting(named(link.channel_name), link.linked_by_name)
          : !c
            ? W.ownerConnects
            : c.broken
              ? W.broken
              : W.pickHint

  return (
    <section data-testid="project-slack" className="flex flex-col gap-3">
      <SectionHead>{W.head}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
          <Icon name="slack" size={20} className="text-ink" />
          <div className="flex min-w-px flex-1 flex-col gap-1">
            {c && !c.broken && may ? (
              <select
                data-testid="slack-channel"
                aria-label={W.channel}
                data-pill
                value={chosen}
                onChange={(e) => {
                  setTrouble(null)
                  setPicked(e.target.value)
                }}
                className="h-8 max-w-full rounded-full bg-transparent px-3 text-base text-ink"
                style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
              >
                <option value="">{W.noChannel}</option>
                {shown.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {named(ch.name)}
                    {ch.private && ch.name ? ` — ${W.privateMark}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-base text-ink">{link ? named(link.channel_name) : W.noChannel}</span>
            )}
            <span
              data-testid="slack-hint"
              className="text-sm"
              style={{ color: trouble || (link?.stopped_at && !changing) || (c?.broken && !link) ? 'var(--danger)' : 'var(--ink-3)' }}
            >
              {hint}
            </span>
          </div>
          {may && changing && (
            <Button
              tone="primary"
              data-testid="slack-post-here"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setTrouble(null)
                try {
                  await api(`/projects/${projectId}/slack`, { method: 'PUT', body: JSON.stringify({ channel_id: choice.id }) })
                  setPicked(null)
                } catch (err) {
                  setTrouble(err instanceof Refused ? err.message : String(err))
                }
                setBusy(false)
                await load()
              }}
            >
              {W.postHere(named(choice.name))}
            </Button>
          )}
          {may && !changing && link && (
            <Button
              data-testid="slack-stop"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setTrouble(null)
                try {
                  await api(`/projects/${projectId}/slack`, { method: 'DELETE' })
                  setPicked(null)
                } catch (err) {
                  setTrouble(err instanceof Refused ? err.message : String(err))
                }
                setBusy(false)
                await load()
              }}
            >
              {W.stop}
            </Button>
          )}
        </div>
      </Panel>
    </section>
  )
}
