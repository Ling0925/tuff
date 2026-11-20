import { useRef, useState } from 'react'
import { api } from '../data/api.js'
import { openZip, type Zip } from '../data/zip.js'
import { channelsOf, messagesOf, type Brought, type SlackChannel, type SlackFile } from '../data/slack.js'
import { kindOf, showLater } from '../data/upload.js'
import { fileUrl } from '../data/files.js'
import { SLACK_IMPORT as W } from '../words/slackImport.js'

type Kept = { id: string; name: string; kind: 'image' | 'video' | 'file'; pixelWidth?: number; pixelHeight?: number }
import { Button, Dialog } from './kit.jsx'
import { Icon } from './glyphs.jsx'

/**
 * An empty room's way to its history in Slack.
 *
 * The export is opened here, in the browser; the window lists its channels,
 * and the one picked is sent over in batches, oldest first, each reply
 * naming the parent the batch before was given.
 */
export function SlackImport({ roomId, onDone }: { roomId: string; onDone: () => void }) {
  const pick = useRef<HTMLInputElement>(null)
  const [zip, setZip] = useState<Zip | null>(null)
  const [channels, setChannels] = useState<SlackChannel[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [going, setGoing] = useState<{ done: number; of: number; what: 'files' | 'messages' } | null>(null)

  const close = () => {
    if (going) return
    setZip(null)
    setChannels(null)
    setChosen(null)
    setSaid(null)
  }

  async function opened(file: File) {
    setSaid(null)
    try {
      const z = await openZip(file)
      const found = await channelsOf(z)
      setZip(z)
      setChannels(found)
      setChosen(found[0]?.name ?? null)
      if (found.length === 0) setSaid(W.noChannels)
    } catch {
      setZip(null)
      setChannels([])
      setSaid(W.notAnExport)
    }
  }

  async function bring() {
    const channel = channels?.find((c) => c.name === chosen)
    if (!zip || !channel) return
    const all = await messagesOf(zip, channel)
    const keys = new Set(all.map((m) => m.key))
    const ids: Record<string, string> = {}

    /*
     * The files first, four at a time, each fetched from Slack by the
     * server. One Slack would not give — an expired key, an export made
     * without them — is named in the words instead, as before.
     */
    const carried = all.flatMap((m) => (m.files ?? []).map((f) => ({ m, f })))
    const kept = new Map<SlackFile, Kept | null>()
    let fetched = 0
    setGoing({ done: 0, of: carried.length, what: 'files' })
    const one = async ({ f }: { m: Brought; f: SlackFile }) => {
      const r = await api<{ id: string; name: string; content_type: string }>(`/conversations/${roomId}/import/file`, {
        method: 'POST',
        body: JSON.stringify({ url: f.url, name: f.name }),
      }).catch(() => null)
      /*
       * And its copy for showing, made here as an upload's is: the server
       * fetched the original and cannot shrink a picture, so without this
       * every list and body drew a seven-megabyte PNG, and Docs took a
       * second to open on four of them. In the background; the import does
       * not wait for it.
       */
      if (r && kindOf(r.content_type) === 'image') {
        void fileUrl(r.id)
          .then((url) => fetch(url))
          .then((b) => b.blob())
          .then((blob) => showLater(r.id, new File([blob], r.name, { type: r.content_type })))
          .catch(() => {})
      }
      kept.set(
        f,
        r
          ? {
              id: r.id,
              name: r.name,
              kind: kindOf(r.content_type),
              ...(f.width && f.height ? { pixelWidth: f.width, pixelHeight: f.height } : {}),
            }
          : null,
      )
      setGoing({ done: ++fetched, of: carried.length, what: 'files' })
    }
    const queue = [...carried]
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) await one(next)
      }),
    )
    const ready = all.map((m) => {
      const files = (m.files ?? []).map((f) => kept.get(f)).filter((k): k is Kept => Boolean(k))
      const missed = (m.files ?? []).filter((f) => !kept.get(f)).map((f) => W.attachedInSlack(f.name))
      const { files: _from, ...rest } = m
      return {
        ...rest,
        text: [m.text, ...missed].filter(Boolean).join('\n'),
        ...(files.length ? { files } : {}),
      }
    })

    setGoing({ done: 0, of: ready.length, what: 'messages' })
    try {
      for (let i = 0; i < ready.length; i += 1000) {
        const batch = ready.slice(i, i + 1000).map(({ parent_key, ...m }) =>
          /* A reply to something not in the channel's export stands alone. */
          !parent_key || !keys.has(parent_key) ? m : ids[parent_key] ? { ...m, parent_id: ids[parent_key] } : { ...m, parent_key },
        )
        const r = await api<{ ids: Record<string, string> }>(`/conversations/${roomId}/import`, {
          method: 'POST',
          body: JSON.stringify({ messages: batch }),
        })
        Object.assign(ids, r.ids)
        setGoing({ done: Math.min(i + 1000, ready.length), of: ready.length, what: 'messages' })
      }
      setGoing(null)
      close()
      onDone()
    } catch {
      setGoing(null)
      setSaid(W.stopped)
    }
  }

  const [help, setHelp] = useState(false)
  return (
    <>
      {help && <SlackHelp onClose={() => setHelp(false)} />}
      <span className="inline-flex flex-col items-center gap-3">
        <Button tone="quiet" data-testid="import-slack" onClick={() => pick.current?.click()}>
          <Icon name="upload" size={16} />
          {W.importFromSlack}
        </Button>
        {/* How to get the file this asks for — it is not where anybody would
            look for it in Slack. Words under the button, not a round "?"
            beside it: a question mark says there is help, and not what about. */}
        <button
          type="button"
          data-testid="import-slack-help"
          onClick={() => setHelp(true)}
          className="text-sm underline underline-offset-4 text-ink-3"
        >
          {W.howTo}
        </button>
      </span>
      <input
        ref={pick}
        type="file"
        accept=".zip,application/zip"
        data-testid="import-slack-file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void opened(f)
        }}
      />
      {channels && (
        <Dialog
          title={W.importFromSlack}
          testId="slack-import"
          onClose={close}
          footer={
            <>
              <span className="text-sm text-ink-3">{going ? W.progress(going.done, going.of, going.what) : W.brings}</span>
              <div className="flex-1" />
              <Button tone="primary" data-testid="import-slack-go" disabled={!chosen || Boolean(going)} onClick={() => void bring()}>
                {W.import}
              </Button>
            </>
          }
        >
          <div className="flex flex-col pb-2">
            {said && <p className="px-4 pb-2 text-base text-ink-2">{said}</p>}
            <div className="max-h-[320px] overflow-y-auto">
              {channels.map((c) => (
                <label
                  key={c.name}
                  data-slack-channel={c.name}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors mouse:hover:bg-[var(--hover)]"
                >
                  <input
                    type="radio"
                    name="slack-channel"
                    className="size-4 shrink-0"
                    checked={chosen === c.name}
                    onChange={() => setChosen(c.name)}
                  />
                  <span className="min-w-px flex-1 truncate text-base text-ink">#{c.name}</span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-3">{W.days(c.days.length)}</span>
                </label>
              ))}
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ help */

/** A step's picture: Slack's screen drawn plainly, the place to press lit. */
function Shot({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden className="flex w-full flex-col gap-2 overflow-hidden p-4 text-xs bg-sunken text-ink-2" style={{ borderRadius: 12 }}>
      {children}
    </div>
  )
}

/** A thing in the drawing; `on` is the one to press. */
function Spot({ children, on = false, wide = false }: { children: React.ReactNode; on?: boolean; wide?: boolean }) {
  return (
    <span
      className={`flex h-8 items-center gap-2 rounded-[8px] px-3 ${wide ? 'w-full' : 'self-start'}`}
      style={{
        background: on ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))' : 'var(--surface)',
        boxShadow: on ? '0 0 0 2px var(--accent)' : undefined,
        color: on ? 'var(--ink)' : 'var(--ink-2)',
        fontWeight: on ? 500 : 400,
      }}
    >
      {children}
    </span>
  )
}

const STEPS: { title: string; said: string; shot: React.ReactNode }[] = [
  {
    title: W.step1,
    said: W.step1Said,
    shot: (
      <div className="flex gap-3">
        <div className="flex w-[112px] shrink-0 flex-col gap-2">
          <Spot wide>{W.home}</Spot>
          <Spot wide>{W.dms}</Spot>
          <Spot wide on>
            {W.admin}
          </Spot>
        </div>
        <div className="flex flex-1 flex-col gap-2 pt-12">
          <Spot wide>{W.manageMembers}</Spot>
          <Spot wide on>
            {W.workspaceSettings}
          </Spot>
          <Spot wide>{W.billing}</Spot>
        </div>
      </div>
    ),
  },
  {
    title: W.step2,
    said: W.step2Said,
    shot: (
      <>
        <div className="flex gap-2">
          <Spot>{W.settings}</Spot>
          <Spot on>{W.security}</Spot>
          <Spot>{W.permissions}</Spot>
        </div>
        <Spot wide>{W.authentication}</Spot>
        <Spot wide on>
          {W.importExport}
        </Spot>
      </>
    ),
  },
  {
    title: W.step3,
    said: W.step3Said,
    shot: (
      <>
        <div className="flex gap-2">
          <Spot>{W.import}</Spot>
          <Spot on>{W.export}</Spot>
        </div>
        <Spot wide>{W.dateRange}</Spot>
        <Spot on>{W.startExport}</Spot>
      </>
    ),
  },
  {
    title: W.step4,
    said: W.step4Said,
    shot: (
      <>
        <Spot wide>{W.exportReady}</Spot>
        <div className="flex items-center gap-2">
          <Spot>{W.workspaceExport}</Spot>
          <Spot on>{W.readyForDownload}</Spot>
        </div>
      </>
    ),
  },
  {
    title: W.step5,
    said: W.step5Said,
    shot: (
      <>
        <Spot on>{W.importFromSlack}</Spot>
        <Spot wide>{W.exampleChannel}</Spot>
        <Spot on>{W.import}</Spot>
      </>
    ),
  },
]

/**
 * Where Slack keeps the export, step by step.
 * Drawn rather than photographed: Slack's screens change under a picture of
 * them, and a drawing says which button to press without a logo on it.
 */
function SlackHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title={W.howTo}
      testId="slack-help"
      onClose={onClose}
      footer={
        <>
          <div className="flex-1" />
          <Button tone="primary" onClick={onClose}>
            {W.gotIt}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-6 overflow-y-auto px-4 pt-1 pb-4">
        {STEPS.map((s, i) => (
          <section key={s.title} data-slack-step={i + 1} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-md font-medium text-ink">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs bg-accent text-on-accent">
                {i + 1}
              </span>
              {s.title}
            </h3>
            <p className="text-base text-ink-2">{s.said}</p>
            <Shot>{s.shot}</Shot>
          </section>
        ))}
        <p className="text-sm text-ink-3">{W.freePlan}</p>
      </div>
    </Dialog>
  )
}
