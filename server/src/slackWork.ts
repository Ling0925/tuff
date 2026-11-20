import { asWorker } from './db.js'
import { openSecret } from './github.js'
import { addressOf, CHANNEL_DEAD, messageOf, postMessage, previewOf, TOKEN_DEAD, unfurl, type Owed, type Preview } from './slack.js'

/**
 * What is owed to Slack, posted.
 *
 * The claim hands over the oldest waiting message of each channel and no
 * more, so a pass every second or two keeps under Slack's one a second in
 * a channel without counting anything here.
 */

type Row = Owed & {
  id: string
  tries: number
  token_enc: string
  connection_id: string
  link_id: string
  channel_id: string
  gone: boolean
}

/** Longer after every failure: a minute, two, four, eight, ten. */
const backoff = (tries: number) => `${Math.min(10, 2 ** Math.max(0, tries - 1))} minutes`

/*
 * Six tries, about half an hour, and then given up: a channel's messages
 * go in order, so one that will not go holds every one behind it.
 */
const TRIES = 6

export async function slackOut(n: number): Promise<number> {
  const rows = await asWorker((tx) => tx<Row[]>`select * from slack_out_claim(${n})`)
  let sent = 0
  for (const r of rows) {
    const done = (error: string | null, wait: string | null) =>
      asWorker((tx) => tx`select slack_out_done(${r.id}, ${error}, ${wait}::interval)`)
    /* Removed since it was queued: nothing to tell. */
    if (r.gone) {
      await done('gone', null)
      continue
    }
    const token = openSecret(r.token_enc)
    if (!token) {
      await asWorker((tx) => tx`select slack_broken(${r.connection_id}, null, 'unsealable')`)
      await done('unsealable', '1 minute')
      continue
    }
    let a
    try {
      a = await postMessage(token, r.channel_id, messageOf(r))
    } catch (e) {
      await done(e instanceof Error ? e.name : 'failed', r.tries >= TRIES ? null : backoff(r.tries))
      continue
    }
    if (a.ok) {
      await done(null, null)
      sent++
      continue
    }
    const why = String(a.error ?? 'failed').slice(0, 80)
    if (why === 'ratelimited') {
      await done(why, `${a.retryAfter ?? 30} seconds`)
    } else if (TOKEN_DEAD.has(why)) {
      /* Kept, not given up: connected again, it is sent. */
      await asWorker((tx) => tx`select slack_broken(${r.connection_id}, null, ${why})`)
      await done(why, '1 minute')
    } else if (CHANNEL_DEAD.has(why)) {
      await asWorker((tx) => tx`select slack_broken(null, ${r.link_id}, ${why})`)
      await done(why, '1 minute')
    } else {
      await done(why, r.tries >= TRIES ? null : backoff(r.tries))
    }
  }
  return sent
}

/**
 * Previews owed. Each address is read by
 * `slack_preview`, which answers only for the project whose channel the
 * message is in; an address it does not answer stays a plain link. Not
 * tried again: a preview is worth something while the message is new.
 */
export async function slackUnfurl(n: number): Promise<number> {
  const rows = await asWorker(
    (tx) =>
      tx<{ id: string; token_enc: string; channel_id: string; message_ts: string; urls: string[] }[]>`
      select * from slack_unfurl_claim(${n})`,
  )
  let answered = 0
  for (const r of rows) {
    const done = (error: string | null) => asWorker((tx) => tx`select slack_unfurl_done(${r.id}, ${error})`)
    const unfurls: Record<string, { blocks: unknown[] }> = {}
    for (const url of r.urls) {
      const a = addressOf(url)
      if (!a) continue
      const [p] = await asWorker((tx) => tx<Preview[]>`select * from slack_preview(${r.id}, ${a.ws}, ${a.project}, ${a.kind}, ${a.number})`)
      if (p) unfurls[url] = previewOf(p)
    }
    const token = openSecret(r.token_enc)
    if (!Object.keys(unfurls).length || !token) {
      await done(token ? 'nothing' : 'unsealable')
      continue
    }
    /* A refusal here marks nothing broken: the posting finds that out, and
       a connection made before previews is refused for want of a scope. */
    const said = await unfurl(token, r.channel_id, r.message_ts, unfurls).catch((e: unknown) => ({
      ok: false,
      error: e instanceof Error ? e.name : 'failed',
    }))
    await done(said.ok ? null : String(said.error ?? 'failed').slice(0, 80))
    if (said.ok) answered++
  }
  return answered
}
