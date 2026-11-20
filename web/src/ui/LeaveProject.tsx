import { useState } from 'react'
import { MORE } from '../data/words.js'
import { PROJECT_SAID as W } from '../words/project.js'
import { api } from '../data/api.js'
import { Button, Dialog } from './kit.jsx'

/**
 * Taking yourself off a project.
 *
 * Asked before it is done, and the press that does it is the one in this
 * window, which says what happens: leaving takes the project's work off
 * your screen, and only somebody else can put you back. It waits for the
 * server rather than moving first — a project that vanished and came back
 * on a refusal is worse than a second of "Leaving…".
 */
export function LeaveDialog({
  project,
  meId,
  owner,
  onClose,
  onLeft,
}: {
  project: { id: string; name: string }
  meId: string
  /** The workspace's owner, who still sees the project afterwards. */
  owner: boolean
  onClose: () => void
  onLeft: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setSaid(null)
    try {
      await api(`/projects/${project.id}/members/${meId}`, { method: 'DELETE' })
      onLeft()
    } catch {
      setSaid(W.couldntLeave)
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={W.leaveName(project.name)}
      testId="leave-project-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          {/* In the footer, whose height is fixed, so a refusal does not
              grow the window under the pointer. */}
          <p role="alert" className="mr-auto min-w-px truncate text-sm text-danger">
            {said}
          </p>
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button
            data-testid="leave-project-go"
            disabled={busy}
            onClick={() => void go()}
            style={{ background: 'var(--danger)', color: '#fff' }}
          >
            {busy ? W.leaving : W.leaveProject}
          </Button>
        </div>
      }
    >
      <p className="px-4 pt-2 pb-4 text-base leading-5 text-ink-2">{owner ? W.leaveSaysOwner : W.leaveSays}</p>
    </Dialog>
  )
}
