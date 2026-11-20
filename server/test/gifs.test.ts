import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onlyKlipy } from '../src/http/chat.js'

/* `docs/specs/gifs.md`: a GIF in a message is KLIPY's address and nothing else. */
test('a message may carry a GIF from KLIPY and from nowhere else', () => {
  const gif = (url: unknown) => ({ type: 'doc', content: [{ type: 'gif', attrs: { url, width: 4, height: 3 } }] })
  assert.equal(onlyKlipy(gif('https://static.klipy.com/ii/abc/x.webp')), true)
  assert.equal(onlyKlipy(gif('https://static2.klipy.com/ii/abc/x.gif')), true)
  assert.equal(onlyKlipy(gif('https://evil.example/pixel.gif')), false)
  assert.equal(onlyKlipy(gif('https://static.klipy.com.evil.example/x.gif')), false)
  assert.equal(onlyKlipy(gif(42)), false)
  assert.equal(onlyKlipy({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }), true)
})
