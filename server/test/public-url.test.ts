import { test } from 'node:test'
import assert from 'node:assert/strict'
import { botAgent } from '../src/publicUrl.js'

test('the link previewer names this server, or only itself', () => {
  assert.equal(botAgent('https://usetuff.com'), 'TuffBot/1.0 (+https://usetuff.com)')
  assert.equal(botAgent('https://tuff.example.org'), 'TuffBot/1.0 (+https://tuff.example.org)')
  assert.equal(botAgent(''), 'TuffBot/1.0')
})
