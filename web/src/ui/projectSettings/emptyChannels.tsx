import { useCallback, useEffect, useState } from 'react'
import { api, unlessOffline } from '../../data/api.js'
import { Button, Hairline, Panel, SectionHead } from '../kit.jsx'
import { EMPTY_CHANNELS as W } from '../../words/emptyChannels.js'

type Empty = { id: string; name: string }

/**
 * A project's channels of chosen people whose people have all gone.
 * Nobody can open one, so
 * it is ended here, by the owner or whoever may delete the project's
 * channels: opened to the project, or deleted. The server lists them only
 * to those people, by name; anybody else is answered none, and this draws
 * nothing — as it does for a project that has none, which is nearly all.
 */
export function EmptyChannels({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [rooms, setRooms] = useState<Empty[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  /* Opening shows everything said in it to the whole project: asked once
     more, in words, before it is done. Deleting takes it from everybody. */
  const [asking, setAsking] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api<{ channels: Empty[] }>(`/projects/${projectId}/empty-channels`)
        .then((r) => setRooms(r.channels))
        .catch(unlessOffline(() => {})),
    [projectId],
  )
  useEffect(() => void load(), [load])

  if (rooms.length === 0) return null

  const end = async (id: string, open: boolean) => {
    setBusy(id)
    setAsking(null)
    setFailed(false)
    try {
      await api(
        `/conversations/${id}${open ? '/members' : ''}`,
        open ? { method: 'PUT', body: JSON.stringify({ member_ids: null }) } : { method: 'DELETE' },
      )
      /* Gone from here the moment it is ended: it is no longer a room nobody is in. */
      setRooms((all) => all.filter((r) => r.id !== id))
    } catch {
      setFailed(true)
      void load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section data-testid="empty-channels" className="flex flex-col gap-3">
      <SectionHead>{W.head}</SectionHead>
      <Panel>
        {rooms.map((r, i) => (
          <div key={r.id}>
            {i > 0 && <Hairline inset={16} />}
            <div data-testid="empty-channel" className="flex min-h-[56px] flex-wrap items-center gap-3 px-4 py-2">
              <div className="flex min-w-px flex-1 flex-col gap-1">
                <span className="truncate text-base text-ink">#{r.name}</span>
                <span className="text-sm text-ink-3">{W.nobody}</span>
              </div>
              {asking === r.id ? (
                <>
                  <Button data-testid="empty-channel-cancel" disabled={busy !== null} onClick={() => setAsking(null)}>
                    {W.cancel}
                  </Button>
                  <Button tone="primary" data-testid="empty-channel-open-go" disabled={busy !== null} onClick={() => void end(r.id, true)}>
                    {W.open}
                  </Button>
                </>
              ) : (
                <>
                  <Button tone="danger" data-testid="empty-channel-delete" disabled={busy !== null} onClick={() => void end(r.id, false)}>
                    {W.remove}
                  </Button>
                  <Button data-testid="empty-channel-open" disabled={busy !== null} onClick={() => setAsking(r.id)}>
                    {W.open}
                  </Button>
                </>
              )}
            </div>
            {asking === r.id && (
              <p data-testid="empty-channel-reveals" className="px-4 pb-3 text-sm text-ink-2">
                {W.reveals(projectName)}
              </p>
            )}
          </div>
        ))}
      </Panel>
      {failed && <span className="text-sm text-danger">{W.failed}</span>}
    </section>
  )
}
