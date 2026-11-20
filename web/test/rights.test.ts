import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AGENT_RIGHTS, RIGHTS, rightsFor } from '../src/data/rights.js'

/* An agent's row offers what the server lets it hold. */
test('an agent is offered only the rights the server lets it hold', () => {
  assert.deepEqual(
    rightsFor(true).map(([r]) => r),
    ['task.create', 'edit.any'],
  )
  assert.equal(rightsFor(false), RIGHTS)
  assert.equal(rightsFor(undefined), RIGHTS)
})

test('the client’s list is the server’s', () => {
  const server = readFileSync(new URL('../../server/src/http/agents.ts', import.meta.url), 'utf8')
  const said = /const AGENT_RIGHTS = (\[[^\]]*\])/.exec(server)?.[1]
  assert.ok(said, 'AGENT_RIGHTS is no longer in server/src/http/agents.ts — point data/rights.ts at where it went')
  assert.deepEqual(JSON.parse(said.replace(/'/g, '"')), [...AGENT_RIGHTS])
})
