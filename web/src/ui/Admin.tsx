import { useCallback, useEffect, useState } from 'react'
import { HEADS, MAKE, MORE, SAYS, WRITING } from '../data/words.js'
import { ADMIN as W } from '../words/admin.js'
import { api, Refused } from '../data/api.js'
import { WEBHOOK_EVENTS, type WebhookEvent } from '@tracker/shared-schema'
import { ahead, known } from '../data/ahead.js'
import { Create } from './Create.jsx'
import { WebhookKey } from './WebhookKey.jsx'
import { WEBHOOK_KEY } from '../words/webhookKey.js'
import { Button, Dialog, Hairline, Panel, Popover, SectionHead, Select } from './kit.jsx'

type Hook = {
  id: string
  url: string
  events: string[]
  enabled: boolean
  /** Whether it sends the receiver's own key — never the key. */
  authorization_set?: boolean
  last_status: number | null
  last_at: string | null
  /** Turned off because the account that made it changed hands.
      Turning it on gives it a new secret. */
  stopped_at?: string | null
}
/* Where it sends, said by its host: the rest of an address can carry a key. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
const day = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '—')

/**
 * Webhooks: how something outside hears that work happened.
 *
 * Signed, retried and drained a workspace at a time — all of that was built
 * and there was nowhere to add one. The secret is shown once, because after
 * that it is in a column the database refuses to hand back.
 */
export function Webhooks() {
  const [hooks, setHooks] = useState<Hook[]>(() => known<{ webhooks: Hook[] }>('/webhooks')?.webhooks ?? [])
  const [secret, setSecret] = useState<string | null>(null)

  /* What was said about a row — a test sent, a change refused — under its address. */
  const [said, setSaid] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<Hook | null>(null)
  /* A webhook made by the account's previous holder, being turned on: the
     screen says where everything will go before it does. */
  const [reviving, setReviving] = useState<Hook | null>(null)

  const load = useCallback(async () => {
    setHooks((await ahead<{ webhooks: Hook[] }>('/webhooks')).webhooks)
  }, [])
  useEffect(() => void load().catch(() => setHooks([])), [load])

  /* On the screen at once, put back by the list if the server says no. */
  async function change(h: Hook, to: Partial<Pick<Hook, 'enabled' | 'events'>>) {
    setHooks((had) => had.map((x) => (x.id === h.id ? { ...x, ...to } : x)))
    try {
      await api(`/webhooks/${h.id}`, { method: 'PATCH', body: JSON.stringify(to) })
    } catch {
      setSaid((was) => ({ ...was, [h.id]: W.couldntChange }))
    }
    await load()
  }
  /* Through the queue, as every delivery goes; its answer is the row's
     last response a moment later. */
  async function test(h: Hook) {
    try {
      await api(`/webhooks/${h.id}/test`, { method: 'POST' })
      setSaid((was) => ({ ...was, [h.id]: W.testSent }))
      setTimeout(() => void load().catch(() => undefined), 4000)
    } catch (e) {
      setSaid((was) => ({ ...was, [h.id]: e instanceof Refused && e.status === 429 ? W.tooManyTests : W.couldntTest }))
    }
  }

  return (
    <section className="mt-9 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <SectionHead>{HEADS.webhooks}</SectionHead>
        <Create
          label={MAKE.newWebhook}
          variant="plain"
          placeholder="https://…"
          onCreate={async (url) => {
            const r = await api<{ secret: string }>('/webhooks', {
              method: 'POST',
              body: JSON.stringify({ url, events: [] }),
            })
            setSecret(r.secret)
            await load()
          }}
        />
      </div>

      {secret && (
        /* The shown-once box the invite link has: sunken, a grey line
           saying what it is, the secret to select. */
        <div data-testid="webhook-secret" className="flex flex-col gap-2 p-4 text-sm bg-sunken" style={{ borderRadius: 'var(--r-card)' }}>
          <div className="text-ink-3">{SAYS.copyItNow}</div>
          <code className="block break-all select-all text-ink">{secret}</code>
          <div className="text-ink-3">{SAYS.everyDeliverySigned}</div>
        </div>
      )}

      <Panel>
        {hooks.length === 0 && (
          <div className="flex min-h-[56px] flex-col justify-center gap-1 px-4 py-3">
            <span className="text-base text-ink">{SAYS.none}</span>
            <span className="text-sm text-ink-3">{W.webhooksHint}</span>
          </div>
        )}
        {hooks.map((h, i) => (
          <div key={h.id} className="contents">
            {i > 0 && <Hairline inset={16} />}
            <HookRow
              hook={h}
              said={said[h.id] ?? null}
              onChange={(to) => (to.enabled && h.stopped_at ? setReviving(h) : void change(h, to))}
              onTest={() => void test(h)}
              onKey={async (to) => {
                await api(`/webhooks/${h.id}`, { method: 'PATCH', body: JSON.stringify({ authorization: to }) })
                await load()
              }}
              onDelete={() => setDeleting(h)}
            />
          </div>
        ))}
      </Panel>

      {deleting && (
        <Dialog
          title={W.deleteWebhookAsk}
          testId="webhook-delete-dialog"
          onClose={() => setDeleting(null)}
          footer={
            <div className="flex flex-1 items-center justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="h-8 px-3 text-base font-medium text-ink-2">
                {MORE.cancel}
              </button>
              <Button
                tone="danger"
                data-testid="webhook-delete-go"
                onClick={async () => {
                  const h = deleting
                  setDeleting(null)
                  setHooks((had) => had.filter((x) => x.id !== h.id))
                  await api(`/webhooks/${h.id}`, { method: 'DELETE' }).catch(() => null)
                  await load()
                }}
              >
                {W.deleteWebhook}
              </Button>
            </div>
          }
        >
          <p className="px-4 pt-2 pb-4 text-base leading-5 text-ink-2">{W.deleteWebhookSays(deleting.url)}</p>
        </Dialog>
      )}

      {reviving && (
        <Dialog
          title={W.reviveAsk}
          testId="webhook-revive-dialog"
          onClose={() => setReviving(null)}
          footer={
            <div className="flex flex-1 items-center justify-end gap-2">
              <button onClick={() => setReviving(null)} className="h-8 px-3 text-base font-medium text-ink-2">
                {MORE.cancel}
              </button>
              <Button
                tone="primary"
                data-testid="webhook-revive-go"
                onClick={async () => {
                  const h = reviving
                  setReviving(null)
                  try {
                    const r = await api<{ ok: true; secret?: string }>(`/webhooks/${h.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ enabled: true }),
                    })
                    if (r.secret) setSecret(r.secret)
                  } catch {
                    setSaid((was) => ({ ...was, [h.id]: W.couldntChange }))
                  }
                  await load()
                }}
              >
                {W.turnOn}
              </Button>
            </div>
          }
        >
          <p className="px-4 pt-2 pb-4 text-base leading-5 text-ink-2">{W.reviveSays(hostOf(reviving.url))}</p>
        </Dialog>
      )}
    </section>
  )
}

/**
 * One webhook: on or off, what it was last answered, and what can be done
 * to it. Its events are picked from the list;
 * none picked is every event.
 */
function HookRow({
  hook: h,
  said,
  onChange,
  onTest,
  onKey,
  onDelete,
}: {
  hook: Hook
  said: string | null
  onChange: (to: Partial<Pick<Hook, 'enabled' | 'events'>>) => void
  onTest: () => void
  /** The receiver's own key: a value sets or replaces it, null takes it off. */
  onKey: (to: string | null) => Promise<void>
  onDelete: () => void
}) {
  const action = 'text-sm text-ink-3 mouse:hover:text-[var(--ink)]'
  const pick = (event: WebhookEvent) => {
    const on = h.events.includes(event)
    onChange({ events: on ? h.events.filter((x) => x !== event) : [...h.events, event] })
  }
  return (
    <div data-webhook={h.id} className="group flex min-h-[56px] items-center gap-3 px-4 py-3 text-base">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: !h.enabled ? 'var(--ink-3)' : h.last_status && h.last_status >= 400 ? 'var(--danger)' : '#30d158' }}
      />
      <span className="flex min-w-px flex-1 flex-col gap-1">
        <span className="truncate text-ink">{h.url}</span>
        <span data-webhook-said className="truncate text-sm text-ink-3">
          {said ??
            [
              h.enabled ? (h.last_status ? W.lastResponse(h.last_status) : W.noDeliveries) : h.stopped_at ? W.offFromBefore : W.off,
              h.events.length ? W.nEvents(h.events.length) : W.allEvents,
              ...(h.authorization_set ? [W.withKey] : []),
              ...(h.last_at ? [day(h.last_at)] : []),
            ].join(' · ')}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <Popover
          shape="bare"
          width={248}
          align="right"
          testId="webhook-events"
          said={W.events}
          label={<span className={action}>{W.events}</span>}
        >
          {() => (
            <div role="group" aria-label={W.events} className="flex max-h-[320px] flex-col overflow-y-auto py-1" data-webhook-events>
              <label className="flex shrink-0 items-center gap-3 px-3 text-base text-ink" style={{ height: 'var(--row-h)' }}>
                <input
                  type="checkbox"
                  data-webhook-event="all"
                  checked={h.events.length === 0}
                  onChange={() => h.events.length > 0 && onChange({ events: [] })}
                />
                {W.allEvents}
              </label>
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex shrink-0 items-center gap-3 px-3 text-base text-ink" style={{ height: 'var(--row-h)' }}>
                  <input type="checkbox" data-webhook-event={event} checked={h.events.includes(event)} onChange={() => pick(event)} />
                  <span className="min-w-px flex-1 truncate">{W.event[event]}</span>
                </label>
              ))}
            </div>
          )}
        </Popover>
        <Popover
          shape="bare"
          width={320}
          align="right"
          testId="webhook-key-menu"
          said={WEBHOOK_KEY.head}
          label={<span className={action}>{W.key}</span>}
        >
          {() => (
            <div className="p-3">
              <WebhookKey set={Boolean(h.authorization_set)} onSave={onKey} />
              <p className="mt-2 text-sm leading-5 text-ink-3">{WEBHOOK_KEY.hint}</p>
            </div>
          )}
        </Popover>
        {h.enabled && (
          <button data-testid="test-webhook" onClick={onTest} className={action}>
            {W.sendTest}
          </button>
        )}
        <button
          data-testid={h.enabled ? 'disable-webhook' : 'enable-webhook'}
          onClick={() => onChange({ enabled: !h.enabled })}
          className={action}
        >
          {h.enabled ? W.turnOff : W.turnOn}
        </button>
        <button data-testid="delete-webhook" onClick={onDelete} className="text-sm text-danger">
          {W.deleteWebhook}
        </button>
      </span>
    </div>
  )
}

/**
 * Moving in.
 *
 * An export from Basecamp, Asana or Trello, pasted in. Never through a token:
 * an import that arrives through a tool is somebody else's data landing in
 * your workspace with nobody having looked.
 */
export function Import() {
  const [source, setSource] = useState('basecamp')
  const [text, setText] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{HEADS.importing}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-base text-ink">{W.importFrom}</span>
            <span className="text-sm text-ink-3">{W.importHint}</span>
          </div>
          <Select
            label={WRITING.source}
            testId="import-source"
            value={source}
            onPick={setSource}
            options={[
              { id: 'basecamp', label: 'Basecamp' },
              { id: 'asana', label: 'Asana' },
              { id: 'trello', label: 'Trello' },
            ]}
          />
        </div>
        <div className="px-4 pb-4">
          <textarea
            data-testid="import-body"
            className="h-32 w-full resize-none rounded-[var(--r-row)] px-4 py-3 font-mono text-xs outline-none bg-sunken text-ink"
            placeholder="{ … }"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              data-testid="run-import"
              disabled={!text.trim() || busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api<{ projects: number; tasks: number }>(`/import/${source}`, {
                    method: 'POST',
                    body: text,
                  })
                  setResult(W.imported(r.projects ?? 0, r.tasks ?? 0))
                } catch (e) {
                  setResult((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
              className="inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40 bg-accent text-on-accent"
            >
              {busy ? W.importing : W.import}
            </button>
            {result && (
              <span data-testid="import-result" className="text-sm text-ink-2">
                {result}
              </span>
            )}
          </div>
        </div>
      </Panel>
    </section>
  )
}
