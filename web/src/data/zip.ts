/**
 * A `.zip`, read in the browser — the entries' names, and the ones asked for
 * opened.
 *
 * Written here rather than installed: a Slack export is a plain zip of JSON
 * files, stored or deflated, and the browser decompresses deflate itself
 * (`DecompressionStream`). Forty lines against a dependency for one door.
 * Zip64 — archives past four gigabytes — is not read.
 */
export type Zip = {
  names: string[]
  /** The entry's text, or null when there is no such entry. */
  text: (name: string) => Promise<string | null>
}

type Entry = { method: number; size: number; at: number }

export async function openZip(file: Blob): Promise<Zip> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  /* The directory's end, searched for from the back: a comment may follow it. */
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('not a zip')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)

  const decoder = new TextDecoder()
  const entries = new Map<string, Entry>()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('a broken zip')
    const method = view.getUint16(at + 10, true)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    entries.set(name, { method, size, at: local })
    at += 46 + nameLength + extra + comment
  }

  return {
    names: [...entries.keys()],
    text: async (name) => {
      const e = entries.get(name)
      if (!e) return null
      const start = e.at + 30 + view.getUint16(e.at + 26, true) + view.getUint16(e.at + 28, true)
      const packed = bytes.subarray(start, start + e.size)
      if (e.method === 0) return decoder.decode(packed)
      if (e.method !== 8) throw new Error('an entry packed a way this cannot read')
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Response(stream).text()
    },
  }
}
