import { test, after } from 'node:test'
import assert from 'node:assert/strict'

/*
 * The MCP server behind the Cloudflare gate.
 *
 * Production answers only requests carrying `ORIGIN_SECRET`, and the gate
 * asks the request each tool makes inside the process as well. Every tool
 * came back "404: refused" there and passed here, because no other test
 * runs with a secret set. This file is its own process, so it can.
 */
process.env.ORIGIN_SECRET = 'edge-secret-for-this-test'
const { app } = await import('../src/http/routes.js')
const { closeDb, makeOwner, makeProject } = await import('./helpers.js')

after(async () => {
  await closeDb()
})

test('a tool answers behind the gate, with the secret the outer request carried', async () => {
  const owner = await makeOwner()
  await makeProject(owner.ctx, owner.workspaceId, 'Behind the edge')
  const edge = { 'x-origin-secret': 'edge-secret-for-this-test' }
  const made = await app.request('/api/tokens', {
    method: 'POST',
    headers: { ...edge, 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ name: 'agent' }),
  })
  const token = ((await made.json()) as { token: string }).token

  const call = (headers: Record<string, string>) =>
    app.request('/mcp', {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      }),
    })

  // Without the secret the gate answers as if nothing were here.
  assert.equal((await call({})).status, 404)
  const r = await call(edge)
  assert.equal(r.status, 200)
  const body = (await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }
  assert.notEqual(body.result.isError, true, body.result.content[0]!.text)
  assert.ok(body.result.content[0]!.text.includes('Behind the edge'))
})
