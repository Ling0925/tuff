import { useState } from 'react'
import { PROJECT, MAKE, MORE } from '../../data/words.js'
import { PROJECT_SETTINGS as W } from '../../words/projectSettings.js'
import { Icon } from '../icons.jsx'
import { Panel, Button, Hairline, notALogin } from '../kit.jsx'

/**
 * A copy of the project, made from its settings — a row like Archive and
 * Move to bin below it: what it does, under its name, and the button. The
 * name for the copy is asked in the same panel, filled with one to keep, so
 * Enter alone makes it. It was a plus and two grey words under a heading
 * and a paragraph, and read as a note rather than a thing to press.
 */
export function CopyProject({ name, onCopy }: { name: string; onCopy: (name: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<string | null>(null)
  async function copy(value: string) {
    const text = value.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await onCopy(text)
      setDraft(null)
      setMade(text)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel>
      <div className="flex items-center gap-4 px-4 py-3">
        <span className="flex min-w-px flex-1 flex-col gap-1">
          <span className="text-base text-ink">{PROJECT.copyThisProject}</span>
          <span className="text-sm text-ink-3">{made ? W.copyMade(made) : W.templateHint}</span>
        </span>
        {draft === null && (
          <Button
            data-testid="create-copy-this-project"
            onClick={() => {
              setMade(null)
              setDraft(W.copyOf(name))
            }}
          >
            <Icon name="copy" size={16} />
            {W.makeACopy}
          </Button>
        )}
      </div>
      {draft !== null && (
        <>
          <Hairline inset={16} />
          <form
            className="flex flex-wrap items-center gap-2 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              void copy(draft)
            }}
          >
            <input
              {...notALogin}
              autoFocus
              data-testid="draft-copy-this-project"
              aria-label={MAKE.nameForTheCopy}
              placeholder={MAKE.nameForTheCopy}
              value={draft}
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
              className="min-w-[160px] flex-1 rounded-[var(--r-tile)] px-3 text-base outline-none placeholder:text-[var(--ink-3)] bg-sunken"
              style={{ height: 'var(--control-h)', color: 'var(--ink)' }}
            />
            <Button type="button" onClick={() => setDraft(null)}>
              {MORE.cancel}
            </Button>
            <Button type="submit" tone="primary" disabled={busy || !draft.trim()}>
              {W.copy}
            </Button>
          </form>
        </>
      )}
    </Panel>
  )
}
