import { api } from '../../data/api.js'
import { recall, remember } from '../../data/memory.js'
import { type Message } from './lines.jsx'

/*
 * A thread's replies, read and kept.
 *
 * The pane opened on the message it hangs off and an empty space under it,
 * and the replies grew in a round trip later: a few milliseconds on a
 * laptop, a block popping in on the deployment. Now they are read while the
 * pointer is on "N replies", the press waits for them (up to 400 ms), and
 * the pane opens on the last answer it was given.
 */
const reading = new Map<string, Promise<Message[]>>()
export const threadKey = (headId: string) => `thread:${headId}`
export function readThread(roomId: string, headId: string): Promise<Message[]> {
  let r = reading.get(headId)
  if (r) return r
  r = api<{ messages: Message[] }>(`/conversations/${roomId}/messages?thread=${headId}&limit=200`)
    .then((a) => remember(threadKey(headId), a.messages))
    .finally(() => reading.delete(headId))
  reading.set(headId, r)
  return r
}
export const knownThread = (headId: string) => recall<Message[]>(threadKey(headId))

/** Resolved when the replies are in hand, or after 400 ms — whichever is first. */
export function threadReady(roomId: string, headId: string): Promise<void> {
  if (knownThread(headId)) return Promise.resolve()
  return Promise.race([
    readThread(roomId, headId).then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((r) => setTimeout(r, 400)),
  ])
}
