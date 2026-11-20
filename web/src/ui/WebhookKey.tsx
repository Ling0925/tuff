import { useState } from 'react'
import { WEBHOOK_KEY as W } from '../words/webhookKey.js'
import { Button, SecretInput } from './kit.jsx'

/** One header value, as the server takes it: printable ASCII, one line, a kilobyte at most. */
export const keyFits = (v: string) => {
  const t = v.trim()
  return t.length > 0 && t.length <= 1024 && /^[\x20-\x7E]+$/.test(t)
}

/** A Claude Code routine's API trigger — the only address a routine has. */
export const ROUTINE_URL = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/[A-Za-z0-9_-]{1,128}\/fire$/

/**
 * The receiver's own key on a webhook.
 * Never shown: the server says only whether there is
 * one, so the row says "Set" and offers to replace it or take it off. A
 * routine cannot be fired without its token, so it is replaced, not taken
 * off (`required`).
 */
export function WebhookKey({
  set,
  required = false,
  onSave,
  testId = 'webhook-key',
}: {
  set: boolean
  required?: boolean
  /** A value sets or replaces it; null takes it off. Throws when the server says no. */
  onSave: (value: string | null) => Promise<void>
  testId?: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  async function save(to: string | null) {
    if (busy) return
    if (to !== null && !keyFits(to)) {
      setSaid(W.bad)
      return
    }
    setBusy(true)
    setSaid(null)
    try {
      await onSave(to === null ? null : to.trim())
      setEditing(false)
      setValue('')
    } catch {
      setSaid(W.couldnt)
    } finally {
      setBusy(false)
    }
  }

  const action = 'text-sm text-ink-3 mouse:hover:text-[var(--ink)]'
  return (
    <div data-testid={testId} data-key-set={set ? '' : undefined} className="flex flex-col gap-2">
      <div className="flex min-h-[32px] items-center gap-3">
        <span className="flex min-w-px flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-ink-2">{W.head}</span>
          <span data-testid={`${testId}-state`} className="text-sm text-ink-3">
            {set ? W.set : W.notSet}
          </span>
        </span>
        {!editing && (
          <span className="flex shrink-0 items-center gap-3">
            <button type="button" data-testid={`${testId}-edit`} onClick={() => setEditing(true)} className={action}>
              {set ? W.replace : W.add}
            </button>
            {set && !required && (
              <button
                type="button"
                data-testid={`${testId}-remove`}
                disabled={busy}
                onClick={() => void save(null)}
                className="text-sm text-danger"
              >
                {W.remove}
              </button>
            )}
          </span>
        )}
      </div>
      {editing && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save(value)
          }}
        >
          <SecretInput
            data-testid={`${testId}-value`}
            aria-label={W.head}
            autoFocus
            maxLength={1024}
            placeholder={W.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(false)
                setValue('')
                setSaid(null)
              }
            }}
            className="h-8 min-w-px flex-1 rounded-[var(--r-row)] px-3 text-sm outline-none placeholder:text-[var(--ink-3)] bg-sunken text-ink"
          />
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setValue('')
              setSaid(null)
            }}
            className="h-8 px-2 text-sm font-medium text-ink-2"
          >
            {W.cancel}
          </button>
          <Button tone="primary" type="submit" data-testid={`${testId}-save`} disabled={busy || !value.trim()}>
            {W.save}
          </Button>
        </form>
      )}
      {said && (
        <p role="alert" className="text-sm text-danger">
          {said}
        </p>
      )}
    </div>
  )
}
