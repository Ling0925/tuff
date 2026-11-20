import { useEffect, useRef, useState } from 'react'
import { AGENTS as W } from '../words/agents.js'
import { WEBHOOK_KEY as K } from '../words/webhookKey.js'
import { api, Refused } from '../data/api.js'
import { Button, Dialog, SecretInput, urlField } from './kit.jsx'
import { Icon } from './glyphs.jsx'
import { ROUTINE_URL, WebhookKey, keyFits } from './WebhookKey.jsx'

/**
 * How an agent is reached.
 * Through MCP, by a webhook, or as a Claude Code routine (a webhook in
 * Claude Code's shape). The connect window and the agent's page draw the
 * choice with the same picker, so it looks the same in both.
 */
export type Reach = 'mcp' | 'webhook' | 'routine'
export const REACHES: readonly Reach[] = ['mcp', 'webhook', 'routine']

/** Its own glyph each: a prompt for MCP, the bolt for a webhook, a spark for Claude. */
const GLYPH = { mcp: 'prompt', webhook: 'bolt', routine: 'spark' } as const
/** Its name in a list, in full. */
export const reachName = (r: Reach) => (r === 'mcp' ? W.reachMcp : r === 'webhook' ? W.reachWebhook : K.routine)
/** Its name on the picker, where a third of the window holds it; the line under it says Claude Code. */
const pickName = (r: Reach) => (r === 'routine' ? W.reachRoutine : reachName(r))
export const reachLine = (r: Reach) => (r === 'mcp' ? W.reachMcpLine : r === 'webhook' ? W.reachWebhookLine : W.reachRoutineLine)
/** What an agent from `/api/agents` is reached by, as the picker names it. */
export const reachOfRow = (a: { reach: string; webhook_shape?: string | undefined }): Reach =>
  a.reach !== 'webhook' ? 'mcp' : a.webhook_shape === 'claude_routine' ? 'routine' : 'webhook'

/**
 * Its glyph on the left of its name, and one short line under both — the
 * full width of a third of the window, so neither wraps. The glyph takes
 * the accent when it is the one chosen.
 */
function Face({ r, on }: { r: Reach; on: boolean }) {
  return (
    <span className="flex min-w-px flex-col gap-1">
      <span className="flex min-w-px items-center gap-2">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center transition-colors duration-150 ease-[var(--ease-out)]"
          style={{ color: on ? 'var(--accent)' : 'var(--ink-2)' }}
        >
          <Icon name={GLYPH[r]} size={r === 'routine' ? 12 : 16} />
        </span>
        <span className="truncate text-base leading-5 font-medium text-ink" data-reach-name>
          {pickName(r)}
        </span>
      </span>
      <span className="truncate text-sm leading-5 text-ink-3" data-reach-line>
        {reachLine(r)}
      </span>
    </span>
  )
}

/**
 * The three side by side, each its glyph on the left of its name and one
 * short line — one height, so choosing one moves nothing. A radio group:
 * the arrows move the choice, at once, with no motion; the press scales a
 * hair, as a button does.
 */
export function ReachPicker({ value, onChange }: { value: Reach; onChange: (r: Reach) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div role="radiogroup" aria-label={W.reachedHead} data-agent-reach-picker className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
      {REACHES.map((r, i) => {
        const on = value === r
        return (
          <button
            type="button"
            role="radio"
            key={r}
            ref={(el) => {
              refs.current[i] = el
            }}
            data-agent-reach={r}
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              if (!on) onChange(r)
            }}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
              if (!step) return
              e.preventDefault()
              const next = (i + step + REACHES.length) % REACHES.length
              onChange(REACHES[next]!)
              refs.current[next]?.focus()
            }}
            className="flex min-w-px flex-col rounded-[var(--r-card)] bg-sunken px-3 py-3 text-left transition-[box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.98] mouse:hover:bg-[var(--hover)]"
            style={{ boxShadow: on ? 'inset 0 0 0 2px var(--accent)' : 'none' }}
          >
            <Face r={r} on={on} />
          </button>
        )
      })}
    </div>
  )
}

/** How it is reached, to somebody who cannot change it: the same face, one of them. */
export function ReachShown({ r }: { r: Reach }) {
  return (
    <div className="flex">
      <Face r={r} on={false} />
    </div>
  )
}

/** A field of the editor: what it asks, and a line on it. */
function Field({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink-2">{title}</span>
        {hint && <span className="text-sm leading-5 text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

const input = 'h-10 rounded-[var(--r-row)] px-3 text-base outline-none placeholder:text-[var(--ink-3)] bg-sunken text-ink'

type Row = {
  actor_id: string
  name: string
  reach: string
  can_manage: boolean
  authorization_set?: boolean | undefined
  webhook_shape?: string | undefined
  webhook_url?: string | undefined
}

/**
 * Changing it on the agent's page.
 * The picker starts on what it is; choosing another, or a new
 * address, opens what that needs and a Save. Before saving it says what the
 * change takes away: a new address or shape drops the stored Authorization
 * header (a key given for one host is never sent to another), and MCP stops
 * the calls and drops the address and the header. The server checks the
 * address as connecting does.
 */
export function ReachEditor({ agent, onChanged }: { agent: Row; onChanged: () => Promise<void> }) {
  const now = reachOfRow(agent)
  const [draft, setDraft] = useState<Reach>(now)
  const [url, setUrl] = useState(agent.webhook_url ?? '')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  /* The list's answer is what it is: a saved change, or somebody else's. */
  useEffect(() => {
    setDraft(now)
    setUrl(agent.webhook_url ?? '')
    setKey('')
  }, [now, agent.webhook_url])

  const pick = (r: Reach) => {
    setDraft(r)
    setSaid(null)
    /* The address belongs to the shape it was given for: a routine's is
       Anthropic's alone, so going between them starts the field empty. */
    setUrl(r === now ? (agent.webhook_url ?? '') : '')
    setKey('')
  }
  const trimmed = url.trim()
  const moved = draft !== now || (draft !== 'mcp' && trimmed !== (agent.webhook_url ?? ''))
  /* What saving takes away from the key that is there. */
  const clears = moved && Boolean(agent.authorization_set) && draft !== 'mcp'
  /* A webhook moved to a new address, or made, is signed with a new secret. */
  const resigned = moved && draft === 'webhook'
  /* A routine is fired with its token or not at all: one that keeps its
     token needs none, any other needs one given here. */
  const needsKey = draft === 'routine' && (!agent.authorization_set || moved)
  const urlOk = draft === 'mcp' || (draft === 'routine' ? ROUTINE_URL.test(trimmed) : /^https:\/\/\S+$/.test(trimmed))
  const keyOk = key.trim() ? keyFits(key) : !needsKey
  const ready = moved && urlOk && keyOk && !busy

  async function save() {
    if (!ready) return
    setBusy(true)
    setSaid(null)
    try {
      const r = await api<{ ok: true; authorization_cleared: boolean; secret?: string }>(`/agents/${agent.actor_id}/reach`, {
        method: 'PUT',
        body: JSON.stringify(
          draft === 'mcp'
            ? { reach: 'mcp' }
            : {
                reach: 'webhook',
                url: trimmed,
                shape: draft === 'routine' ? 'claude_routine' : 'tuff',
                ...(key.trim() ? { authorization: key.trim() } : {}),
              },
        ),
      })
      setKey('')
      /* A webhook made here is signed with a secret said once; a routine
         is not signed, so it is not shown. */
      if (r.secret && draft === 'webhook') setSecret(r.secret)
      await onChanged()
    } catch (e) {
      setSaid(e instanceof Refused && e.status === 400 && e.message ? e.message : W.couldntReach)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4" data-agent-reach-editor>
      <ReachPicker value={draft} onChange={pick} />
      {draft !== 'mcp' && (
        <Field title={draft === 'routine' ? K.routineUrl : W.webhook} hint={draft === 'routine' ? K.routineUrlHint : W.webhookHint}>
          <input
            data-testid="agent-reach-url"
            {...urlField}
            placeholder={draft === 'routine' ? 'https://api.anthropic.com/v1/claude_code/routines/…/fire' : 'https://'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={input}
          />
        </Field>
      )}
      {draft !== 'mcp' && moved && (
        /* The key for the new address — a routine's token, or what a
           receiver asks for. Never shown again. */
        <Field title={draft === 'routine' ? K.routineToken : K.head} hint={draft === 'routine' ? K.routineTokenHint : K.hint}>
          <SecretInput
            data-testid="agent-reach-key"
            maxLength={1024}
            placeholder={K.placeholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={input}
          />
        </Field>
      )}
      {draft === 'routine' && moved && (
        <p data-testid="agent-reach-rights" className="text-sm leading-5 text-ink-2">
          {K.routineRights}
        </p>
      )}
      {/* The stored key while nothing else changes: set, replaced, or taken
          off on its own. */}
      {!moved && draft !== 'mcp' && agent.authorization_set !== undefined && (
        <WebhookKey
          testId="agent-key"
          set={agent.authorization_set}
          required={draft === 'routine'}
          onSave={async (to) => {
            await api(`/agents/${agent.actor_id}`, { method: 'PATCH', body: JSON.stringify({ authorization: to }) })
            await onChanged()
          }}
        />
      )}
      {moved && (
        <div className="flex flex-col gap-3">
          {(clears || resigned || (draft === 'mcp' && now !== 'mcp')) && (
            <p data-testid="agent-reach-warning" className="text-sm leading-5 text-ink-2">
              {draft === 'mcp' ? W.reachToMcp : [clears && W.reachKeyCleared, resigned && W.reachNewSecretAhead].filter(Boolean).join(' ')}
            </p>
          )}
          {said && (
            <p role="alert" className="text-sm text-danger">
              {said}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => pick(now)} className="h-8 px-3 text-base font-medium text-ink-2">
              {W.reachCancel}
            </button>
            <Button tone="primary" data-testid="agent-reach-save" disabled={!ready} onClick={() => void save()}>
              {busy ? W.reachSaving : W.reachSave}
            </Button>
          </div>
        </div>
      )}
      {secret && (
        <Dialog
          title={W.reachSecretFor(agent.name)}
          testId="agent-reach-secret"
          onClose={() => setSecret(null)}
          footer={
            <div className="flex flex-1 justify-end">
              <Button tone="primary" onClick={() => setSecret(null)}>
                {W.done}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3 px-4 pt-2 pb-4 text-sm">
            <p className="leading-5 text-ink-3">{W.reachNewSecret}</p>
            <code data-testid="agent-secret" className="block break-all select-all rounded-[var(--r-row)] p-3 bg-sunken text-ink">
              {secret}
            </code>
          </div>
        </Dialog>
      )}
    </div>
  )
}
