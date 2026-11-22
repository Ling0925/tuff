import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'

/* The app's secrets, before anything reads the environment: a webhook
   secret, and a key of its own to sign the app's token with for the fake
   GitHub below. */
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret'
process.env.GITHUB_APP_ID = '1'
process.env.GITHUB_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs1',
  format: 'pem',
}) as string

const { app } = await import('../src/http/routes.js')
const { asAuthActor, withActor } = await import('../src/db.js')
const { githubWork } = await import('../src/githubWork.js')
const { githubOut } = await import('../src/githubIssues.js')
const { branchName, forwardTo, handlesIn } = await import('../src/github.js')
const { closeDb, makeOwner, makeProject } = await import('./helpers.js')

after(async () => {
  await closeDb()
})

test('a handle is found in any case, and only the project’s own', () => {
  const text = 'Fixes red-12, refs RED-13 and OTHER-4; branch yuri/red-14-sign-in; RED-120x and RED-9abc'
  const { named, closes } = handlesIn(text, 'RED')
  assert.deepEqual(
    named.sort((a, b) => a - b),
    [12, 13, 14],
  )
  assert.deepEqual(closes, [12])
  assert.deepEqual(handlesIn('Closed: RED-5. resolves RED-6', 'RED').closes.sort(), [5, 6])
  // A body of spaces is not a pattern's afternoon: it took two seconds a pass (`bench/parsers.bench.ts`).
  assert.deepEqual(handlesIn(`fix${' '.repeat(200_000)}x`, 'RED').named, [])
})

test('GitHub moves a task only forwards, by the marks of the lists', () => {
  const lists = [
    { id: 'b', icon: 'backlog' },
    { id: 'd', icon: 'doing' },
    { id: 'r', icon: 'review' },
    { id: 'x', icon: 'done' },
  ]
  assert.equal(forwardTo(lists, { icon: 'backlog' }, ['started', 'doing']), 'd')
  assert.equal(forwardTo(lists, { icon: 'backlog' }, ['review', 'doing']), 'r')
  // Already in review: a branch pushed later does not drag it back.
  assert.equal(forwardTo(lists, { icon: 'review' }, ['started', 'doing']), null)
  assert.equal(forwardTo(lists, { icon: 'done' }, ['done']), null)
  // No list with that mark, and no fallback: left where it is.
  assert.equal(forwardTo([{ id: 'b', icon: 'backlog' }], { icon: 'backlog' }, ['done']), null)
})

test('a branch is named as Linear names it', () => {
  assert.equal(branchName('Yuri', 'RED', 12, 'Sign-in errors: say which field!'), 'yuri/red-12-sign-in-errors-say-which-field')
  assert.equal(branchName('', 'RED', 3, 'Ça marche'), 'red-3-ca-marche')
})

const sign = (body: string) => `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`
const hook = (event: string, payload: unknown, signature?: string) => {
  const body = JSON.stringify(payload)
  return app.request('/hooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': uuidv7(),
      'x-hub-signature-256': signature ?? sign(body),
    },
    body,
  })
}

test('the webhook believes only what GitHub signed', async () => {
  assert.equal((await hook('pull_request', { installation: { id: 1 } }, 'sha256=00')).status, 403)
  assert.equal((await hook('ping', { zen: 'hi' })).status, 202)
  // With no signature at all, refused before twenty-five megabytes are read.
  const unsigned = await app.request('/hooks/github', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': 'ping', 'x-github-delivery': 'd' },
    body: 'x'.repeat(1024),
  })
  assert.equal(unsigned.status, 403)
})

test('a pull request that names a task is on it, and moves it, as the person who linked it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Repo')
  const installation = Math.floor(Math.random() * 1e9)
  const repo = Math.floor(Math.random() * 1e9)
  const [backlog, doing, review, done] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()]
  const task = uuidv7()
  const key = await withActor(ctx.actorId, workspaceId, async (tx) => {
    for (const [id, name, icon, key, finishes] of [
      [backlog, 'Backlog', 'backlog', 'a0', false],
      [doing, 'Doing', 'doing', 'a1', false],
      [review, 'In review', 'review', 'a2', false],
      [done, 'Done', 'done', 'a3', true],
    ] as const) {
      await tx`insert into task_list (id, workspace_id, project_id, author_id, name, icon, sort_key, finishes)
               values (${id}, ${workspaceId}, ${project}, ${ctx.actorId}, ${name}, ${icon}, ${key}, ${finishes})`
    }
    await tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key, list_id)
             values (${task}, ${workspaceId}, ${project}, ${ctx.actorId}, 'Sign in', 'a0', ${backlog})`
    const install = uuidv7()
    await tx`insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
             values (${install}, ${workspaceId}, ${installation}, 'acme', 'Organization', ${ctx.actorId})`
    await tx`insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, linked_by)
             values (${uuidv7()}, ${workspaceId}, ${project}, ${install}, ${repo}, 'acme/web', true, ${ctx.actorId})`
    const [t] = await tx<{ number: number }[]>`select number from task where id = ${task}`
    const [p] = await tx<{ key: string }[]>`select key from project where id = ${project}`
    return `${p!.key}-${t!.number}`
  })

  const pr = (over: Record<string, unknown>) => ({
    installation: { id: installation },
    repository: { id: repo, full_name: 'acme/web', default_branch: 'main' },
    pull_request: {
      number: 7,
      title: `Sign-in errors (${key})`,
      body: `Fixes ${key}`,
      html_url: 'https://github.com/acme/web/pull/7',
      state: 'open',
      draft: false,
      merged: false,
      user: { login: 'yuri', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
      head: { ref: 'yuri/sign-in', sha: 'abc', repo: { id: repo } },
      author_association: 'MEMBER',
      ...over,
    },
  })
  const listOf = async () =>
    (await withActor(ctx.actorId, workspaceId, (tx) => tx<{ list_id: string }[]>`select list_id from task where id = ${task}`))[0]!.list_id

  assert.equal((await hook('pull_request', { action: 'opened', ...pr({}) })).status, 202)
  await githubWork(20, '0')
  assert.equal(await listOf(), review, 'ready for review: into the review list')

  const read = await app.request(`/api/tasks/${task}`, { headers: { authorization: `Bearer ${token}` } })
  const body = (await read.json()) as { github: { pulls: { number: number; state: string; closes: boolean }[] } }
  assert.deepEqual(
    body.github.pulls.map((p) => [p.number, p.state, p.closes]),
    [[7, 'open', true]],
  )

  // The move is the linker's, said to have come from GitHub.
  const [line] = await withActor(
    ctx.actorId,
    workspaceId,
    (tx) =>
      tx<{ actor_id: string; origin: string }[]>`
      select actor_id, origin from activity_event where object_id = ${task} and action = 'task.update'
      order by id desc limit 1`,
  )
  assert.equal(line?.actor_id, ctx.actorId)
  assert.equal(line?.origin, 'github')

  // Checks on its commit, then merged: done, because it says it fixes it.
  await hook('check_suite', {
    action: 'completed',
    installation: { id: installation },
    repository: { id: repo },
    check_suite: { head_sha: 'abc', conclusion: 'failure' },
  })
  await hook('pull_request', { action: 'closed', ...pr({ state: 'closed', merged: true, merged_at: new Date().toISOString() }) })
  await githubWork(20, '0')
  assert.equal(await listOf(), done)
  const [pull] = await withActor(
    ctx.actorId,
    workspaceId,
    (tx) =>
      tx<{ state: string; checks: string | null }[]>`select state, checks from github_pull where number = 7 and project_id = ${project}`,
  )
  assert.deepEqual(pull, { state: 'merged', checks: 'failure' })

  // A stranger's pull request from a fork moves nothing and hangs nothing on the task.
  await hook('pull_request', {
    action: 'opened',
    ...pr({ number: 99, head: { ref: 'x', sha: 'zzz', repo: { id: repo + 7 } }, author_association: 'NONE' }),
  })
  await githubWork(20, '0')
  const strangers = await withActor(
    ctx.actorId,
    workspaceId,
    (tx) => tx`select 1 from github_pull where number = 99 and project_id = ${project}`,
  )
  assert.equal(strangers.length, 0)

  // A repository nobody linked is nobody's business.
  await hook('pull_request', { action: 'opened', ...pr({}), repository: { id: repo + 1 } })
  assert.equal(await githubWork(20, '0'), 1)
})

test('a person links their own GitHub only from their own session', async () => {
  const { token } = await makeOwner()
  const me = async () =>
    (await (await app.request('/api/github/me', { headers: { authorization: `Bearer ${token}` } })).json()) as { linked: unknown }
  assert.equal((await me()).linked, null)
  // A state nobody signed, or made for somebody else, finishes nothing.
  const r = await app.request('/api/github/me', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'abc', state: 'e30.forged' }),
  })
  assert.equal(r.status, 400)
  // And GitHub's way back without a state of ours goes home, carrying nothing.
  const back = await app.request('/auth/github/callback?code=abc&state=nope')
  assert.equal(back.status, 302)
  assert.equal(back.headers.get('location'), '/')
})

/*
 * A fake GitHub: what the worker asks of api.github.com is answered here and
 * written down, so a test can say what was sent. Everything else still goes
 * to the app itself.
 */
type Sent = { method: string; path: string; body: Record<string, unknown> | null; auth?: string }
const sent: Sent[] = []
/* The installations the person's own GitHub can see. */
let theirs: number[] = []
let nextIssue = 100
let nextComment = 9000
const PERSON_ON_GITHUB = 4242
/* The repositories the installation was given, and each one's open issues
   as GitHub lists them for an import. */
let given: { id: number; full_name: string; private: boolean }[] = []
const openOn = new Map<string, Record<string, unknown>[]>()
/* The comments on an issue, by `owner/name#number`. */
const commentsOn = new Map<string, Record<string, unknown>[]>()
/* Answers GitHub gives instead, once each, by `METHOD path` — a refusal
   in the middle of something. */
const refuse = new Map<string, number[]>()
/* What GitHub says about an installation: an organisation's, made just now,
   unless a test says otherwise. */
let installOf: (id: number) => { account: { login: string; type: string; id?: number }; created_at: string } = () => ({
  account: { login: 'acme', type: 'Organization' },
  created_at: new Date().toISOString(),
})
/* Sub-issues as GitHub keeps them: each issue's id (what names a sub-issue),
   which issue each is under, and each parent's sub-issues in order. */
const ids = new Map<string, number>()
const byId = new Map<number, { repo: string; number: number }>()
const idOf = (repo: string, number: number) => {
  const key = `${repo}#${number}`
  if (!ids.has(key)) {
    const id = 5_000_000 + ids.size
    ids.set(key, id)
    byId.set(id, { repo, number })
  }
  return ids.get(key)!
}
const upOf = new Map<number, number>() // sub-issue id → parent id
const subsOf = new Map<number, number[]>() // parent id → sub-issue ids, in order
const subIssues = (repo: string, number: number) => (subsOf.get(idOf(repo, number)) ?? []).map((id) => byId.get(id)!)
const parentIssue = (repo: string, number: number) => {
  const up = upOf.get(idOf(repo, number))
  return up === undefined ? null : byId.get(up)!
}
const nestOn = (repo: string, parent: number, child: number, childRepo = repo) => {
  const c = idOf(childRepo, child)
  const p = idOf(repo, parent)
  const was = upOf.get(c)
  if (was !== undefined)
    subsOf.set(
      was,
      (subsOf.get(was) ?? []).filter((x) => x !== c),
    )
  upOf.set(c, p)
  subsOf.set(p, [...(subsOf.get(p) ?? []), c])
}
let refuseOnce: ((s: Sent) => Response | null) | null = null
const real = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  /* A picture in an issue: GitHub's address sends on to its storage. */
  if (url === 'https://github.com/user-attachments/assets/shot') {
    return new Response(null, {
      status: 302,
      headers: { location: 'https://github-production-user-asset-6210df.s3.amazonaws.com/shot.png?sig=1' },
    })
  }
  if (url.startsWith('https://github-production-user-asset-6210df.s3.amazonaws.com/')) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } })
  }
  if (!url.startsWith('https://api.github.com')) return real(input, init)
  const path = url.slice('https://api.github.com'.length)
  const method = init?.method ?? 'GET'
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
  /* Which token it carried: the installation's, or a person's own. */
  const auth = new Headers(init?.headers).get('authorization') ?? ''
  sent.push({ method, path, body, auth })
  /* A test may have GitHub refuse one request, once. */
  const once = refuseOnce?.({ method, path, body, auth })
  if (once) {
    refuseOnce = null
    return once
  }
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (path.endsWith('/access_tokens')) return json({ token: 'inst-token', expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201)
  if (/^\/app\/installations\/\d+$/.test(path)) {
    const id = Number(path.split('/').pop())
    return json({ id, ...installOf(id), suspended_at: null })
  }
  if (path.startsWith('/user/installations')) return json({ installations: theirs.map((id) => ({ id })) })
  if (path === '/app') return json({ slug: 'tuff' })
  if (path.startsWith('/installation/repositories')) return json({ total_count: given.length, repositories: given })
  const refused = refuse.get(`${method} ${path.split('?')[0]}`)?.shift()
  if (refused) return json({ message: 'no' }, refused)
  const listed = /^\/repos\/([^/]+\/[^/?]+)\/issues\?/.exec(path)
  if (method === 'GET' && listed) {
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1)
    const open = (openOn.get(listed[1]!) ?? []).filter((i) => i.state === 'open')
    return json(
      open.slice((page - 1) * 100, page * 100).map((i) => ({
        id: idOf(listed[1]!, Number(i.number)),
        repository_url: `https://api.github.com/repos/${listed[1]}`,
        ...i,
      })),
    )
  }
  const on = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments\?/.exec(path)
  if (method === 'GET' && on) return json(commentsOn.get(`${on[1]}#${on[2]}`) ?? [])
  const repoIn = /^\/repos\/([^/]+\/[^/?]+)/.exec(path)?.[1] ?? ''
  const issue = (n: number, b: Record<string, unknown> | null, repo = repoIn) => ({
    id: idOf(repo, n),
    repository_url: `https://api.github.com/repos/${repo}`,
    number: n,
    title: b?.title ?? 'T',
    body: b?.body ?? '',
    state: b?.state ?? 'open',
    state_reason: b?.state_reason ?? null,
    assignees: [],
    labels: ((b?.labels as string[]) ?? []).map((name) => ({ name })),
  })
  const sub = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/(sub_issues|sub_issue|parent|sub_issues\/priority)(\?.*)?$/.exec(path)
  if (sub) {
    const [, repo, n, what] = sub
    const parentId = idOf(repo!, Number(n))
    const child = Number(body?.sub_issue_id)
    if (what === 'parent') {
      const up = parentIssue(repo!, Number(n))
      return up ? json(issue(up.number, null, up.repo)) : json({ message: 'Not Found' }, 404)
    }
    if (what === 'sub_issues' && method === 'GET') {
      return json(
        subIssues(repo!, Number(n)).map((c) => ({
          ...issue(c.number, null, c.repo),
          ...openOn.get(c.repo)?.find((i) => i.number === c.number),
        })),
      )
    }
    if (what === 'sub_issues' && method === 'POST') {
      if (!byId.has(child)) return json({ message: 'Validation Failed' }, 422)
      if (upOf.has(child) && body?.replace_parent !== true) return json({ message: 'Issue may not contain duplicate sub-issues' }, 422)
      if ((subsOf.get(parentId) ?? []).length >= 100) return json({ message: 'Parent cannot have more than 100 sub-issues' }, 422)
      const c = byId.get(child)!
      nestOn(repo!, Number(n), c.number, c.repo)
      return json(issue(Number(n), null), 201)
    }
    if (what === 'sub_issue' && method === 'DELETE') {
      if (upOf.get(child) !== parentId) return json({ message: 'Not Found' }, 404)
      upOf.delete(child)
      subsOf.set(
        parentId,
        (subsOf.get(parentId) ?? []).filter((x) => x !== child),
      )
      return json(issue(Number(n), null))
    }
    if (what === 'sub_issues/priority' && method === 'PATCH') {
      const list = (subsOf.get(parentId) ?? []).filter((x) => x !== child)
      const at = body?.after_id ? list.indexOf(Number(body.after_id)) + 1 : list.indexOf(Number(body?.before_id))
      list.splice(Math.max(0, at), 0, child)
      subsOf.set(parentId, list)
      return json(issue(Number(n), null))
    }
  }
  if (method === 'POST' && /\/issues$/.test(path)) return json(issue(nextIssue++, body), 201)
  const one = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(path)
  const known = one && openOn.get(one[1]!)?.find((i) => i.number === Number(one[2]))
  /* An issue GitHub has: changed as asked, and closed ones leave the open list. */
  if (method === 'PATCH' && known) return json({ id: idOf(one[1]!, Number(one[2])), ...Object.assign(known, body) })
  if (method === 'PATCH' && /\/issues\/\d+$/.test(path)) return json(issue(Number(path.split('/').pop()), body))
  if (method === 'GET' && known) return json({ id: idOf(one[1]!, Number(one[2])), ...known })
  if (method === 'GET' && /\/issues\/\d+$/.test(path))
    return json(issue(Number(path.split('/').pop()), { title: 'T', body: 'As GitHub has it' }))
  /* A comment is the app's when the installation wrote it, else the person's. */
  if (method === 'POST' && /\/comments$/.test(path))
    return json({ id: nextComment++, user: auth.endsWith('inst-token') ? { id: 1, type: 'Bot' } : { id: PERSON_ON_GITHUB } }, 201)
  return json({}, 200)
}) as typeof fetch

test('issues and tasks are kept the same both ways', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Synced')
  const installation = Math.floor(Math.random() * 1e9)
  const repo = Math.floor(Math.random() * 1e9)
  const [backlog, done, stopped] = [uuidv7(), uuidv7(), uuidv7()]
  await withActor(ctx.actorId, workspaceId, async (tx) => {
    for (const [id, name, icon, key, finishes] of [
      [backlog, 'Backlog', 'backlog', 'a0', false],
      [done, 'Done', 'done', 'a1', true],
      [stopped, 'Canceled', 'stopped', 'a2', true],
    ] as const) {
      await tx`insert into task_list (id, workspace_id, project_id, author_id, name, icon, sort_key, finishes)
               values (${id}, ${workspaceId}, ${project}, ${ctx.actorId}, ${name}, ${icon}, ${key}, ${finishes})`
    }
    const install = uuidv7()
    await tx`insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
             values (${install}, ${workspaceId}, ${installation}, 'acme', 'Organization', ${ctx.actorId})`
    await tx`insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, issues, linked_by)
             values (${uuidv7()}, ${workspaceId}, ${project}, ${install}, ${repo}, 'acme/web', true, true, ${ctx.actorId})`
  })
  const base = {
    installation: { id: installation },
    repository: { id: repo, full_name: 'acme/web' },
    sender: { type: 'User', login: 'octo' },
  }
  const issue = (over: Record<string, unknown>) => ({
    number: 1,
    title: 'Login breaks on Safari',
    body: 'Steps:\n\n1. Open it',
    state: 'open',
    state_reason: null,
    assignees: [],
    labels: [{ name: 'bug' }],
    ...over,
  })
  const tasks = () =>
    withActor(
      ctx.actorId,
      workspaceId,
      (tx) =>
        tx<
          { id: string; title: string; list_id: string | null }[]
        >`select id, title, list_id from task where project_id = ${project} and deleted_at is null order by created_at`,
    )

  // Opened on GitHub: a task, with its label made in the project.
  await hook('issues', { action: 'opened', issue: issue({}), ...base })
  await githubWork(20, '0')
  const [made] = await tasks()
  assert.equal(made?.title, 'Login breaks on Safari')
  // Our change GitHub caused is not owed back to it.
  sent.length = 0
  await githubOut()
  assert.equal(sent.filter((x) => x.method !== 'POST' || !x.path.endsWith('/access_tokens')).length, 0)

  // Renamed and closed as not planned there: renamed and Canceled here.
  await hook('issues', { action: 'closed', issue: issue({ title: 'Login breaks', state: 'closed', state_reason: 'not_planned' }), ...base })
  // Somebody who is nobody here comments: their login, from GitHub.
  await hook('issue_comment', {
    action: 'created',
    issue: issue({}),
    comment: { id: 77, body: 'Same here', user: { id: 5, login: 'octo' } },
    ...base,
  })
  await githubWork(20, '0')
  const [after] = await tasks()
  assert.equal(after?.title, 'Login breaks')
  assert.equal(after?.list_id, stopped)
  const read = (await (await app.request(`/api/tasks/${made!.id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
    comments: { author_name: string; origin: string }[]
  }
  assert.deepEqual(
    read.comments.map((c) => [c.author_name, c.origin]),
    [['@octo', 'github']],
  )

  // Changed on GitHub by somebody who did not write it: not put in octo's mouth here.
  const said = async () =>
    (
      (await (await app.request(`/api/tasks/${made!.id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
        comments: { body: unknown }[]
      }
    ).comments.map((c) => JSON.stringify(c.body))
  await hook('issue_comment', {
    action: 'edited',
    issue: issue({}),
    comment: { id: 77, body: 'Forged', user: { id: 5, login: 'octo' } },
    ...base,
    sender: { type: 'User', id: 6 },
  })
  await githubWork(20, '0')
  assert.ok(!(await said()).some((b) => b.includes('Forged')))
  // By octo: it is changed.
  await hook('issue_comment', {
    action: 'edited',
    issue: issue({}),
    comment: { id: 77, body: 'Same here, on 18', user: { id: 5, login: 'octo' } },
    ...base,
    sender: { type: 'User', id: 5 },
  })
  await githubWork(20, '0')
  assert.ok((await said()).some((b) => b.includes('on 18')))

  // Renamed here: the issue renamed there, and only that.
  sent.length = 0
  const r = await app.request(`/api/tasks/${made!.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Login breaks on Safari 18' }),
  })
  assert.equal(r.status, 200)
  await githubOut()
  const patch = sent.find((x) => x.method === 'PATCH' && x.path === '/repos/acme/web/issues/1')
  assert.deepEqual(patch?.body, { title: 'Login breaks on Safari 18' })

  // A task made here is an issue there.
  sent.length = 0
  await app.request(`/api/projects/${project}/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Made in Tuff' }),
  })
  await githubOut()
  const opened = sent.find((x) => x.method === 'POST' && x.path === '/repos/acme/web/issues')
  assert.equal(opened?.body?.title, 'Made in Tuff')
})

test('a person named on GitHub is a mention here, and a link stops when its person cannot act', async () => {
  const { githubOut: _unused, linkerCan } = await import('../src/githubIssues.js')
  const { ctx, workspaceId } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Named')
  const installation = Math.floor(Math.random() * 1e9)
  const repo = Math.floor(Math.random() * 1e9)
  const githubId = Math.floor(Math.random() * 1e9)
  const link = uuidv7()
  await asAuthActor(ctx.actorId, workspaceId, async (tx) => {
    await tx`insert into task_list (id, workspace_id, project_id, author_id, name, icon, sort_key)
             values (${uuidv7()}, ${workspaceId}, ${project}, ${ctx.actorId}, 'Backlog', 'backlog', 'a0')`
    const install = uuidv7()
    await tx`insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
             values (${install}, ${workspaceId}, ${installation}, 'acme', 'Organization', ${ctx.actorId})`
    await tx`insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, issues, linked_by)
             values (${link}, ${workspaceId}, ${project}, ${install}, ${repo}, 'acme/api', true, true, ${ctx.actorId})`
    await tx`insert into github_person (actor_id, github_id, login) values (${ctx.actorId}, ${githubId}, ${`yuri${githubId}`})`
  })
  await hook('issues', {
    action: 'opened',
    installation: { id: installation },
    repository: { id: repo },
    sender: { type: 'User' },
    issue: { number: 3, title: 'Ask', body: `cc @yuri${githubId} please`, state: 'open', assignees: [], labels: [] },
  })
  await githubWork(20, '0')
  const [t] = await withActor(
    ctx.actorId,
    workspaceId,
    (tx) => tx<{ body: unknown }[]>`select body from task where project_id = ${project}`,
  )
  assert.match(JSON.stringify(t?.body), new RegExp(`"type":"mention","attrs":\\{"id":"${ctx.actorId}"`))

  // Somebody who is not in this workspace cannot be who a link acts as.
  const stranger = await makeOwner()
  assert.equal(await linkerCan(link, stranger.ctx.actorId, workspaceId, project), false)
  const [stopped] = await withActor(
    ctx.actorId,
    workspaceId,
    (tx) => tx<{ stopped_why: string | null }[]>`select stopped_why from github_link where id = ${link}`,
  )
  assert.equal(stopped?.stopped_why, 'linker')
})

test('a picture in an issue is a file here, and goes back as the address it came from', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Pictured')
  const installation = Math.floor(Math.random() * 1e9)
  const repo = Math.floor(Math.random() * 1e9)
  await withActor(ctx.actorId, workspaceId, async (tx) => {
    await tx`insert into task_list (id, workspace_id, project_id, author_id, name, icon, sort_key)
             values (${uuidv7()}, ${workspaceId}, ${project}, ${ctx.actorId}, 'Backlog', 'backlog', 'a0')`
    const install = uuidv7()
    await tx`insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
             values (${install}, ${workspaceId}, ${installation}, 'acme', 'Organization', ${ctx.actorId})`
    await tx`insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, issues, linked_by)
             values (${uuidv7()}, ${workspaceId}, ${project}, ${install}, ${repo}, 'acme/pics', true, true, ${ctx.actorId})`
  })
  await hook('issues', {
    action: 'opened',
    installation: { id: installation },
    repository: { id: repo },
    sender: { type: 'User' },
    issue: {
      number: 4,
      title: 'Broken header',
      state: 'open',
      assignees: [],
      labels: [],
      author_association: 'MEMBER',
      body: 'Looks like this:\n\n<img width="300" alt="shot" src="https://github.com/user-attachments/assets/shot" />',
    },
  })
  await githubWork(20, '0')
  const [t] = await withActor(
    ctx.actorId,
    workspaceId,
    (tx) =>
      tx<{ id: string; body: { content: { type: string; attrs?: { source?: string; kind?: string } }[] } }[]>`
      select id, body from task where project_id = ${project}`,
  )
  const pic = t!.body.content.find((n) => n.type === 'attachment')
  assert.equal(pic?.attrs?.kind, 'image')
  assert.equal(pic?.attrs?.source, 'https://github.com/user-attachments/assets/shot')

  // Renamed here: the title goes, and the description — drawn our way now — does not.
  sent.length = 0
  await app.request(`/api/tasks/${t!.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Broken header on Safari' }),
  })
  await githubOut()
  const patch = sent.find((x) => x.method === 'PATCH' && x.path === '/repos/acme/pics/issues/4')
  assert.deepEqual(patch?.body, { title: 'Broken header on Safari' })
})

test('an installation is claimed only by whoever installed it', async () => {
  const { sealSecret } = await import('../src/github.js')
  const { ctx, workspaceId, token } = await makeOwner()
  const call = (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  const started = (await (await call('/api/github/start')).json()) as { url: string }
  const state = new URL(started.url).searchParams.get('state')!
  const id = Math.floor(Math.random() * 1e9)
  const myGithub = Math.floor(Math.random() * 1e9)

  // With no GitHub of their own, nothing says this installation is theirs.
  const bare = await call('/api/github/installs', { installation_id: id, state })
  assert.equal(bare.status, 400)
  assert.equal(((await bare.json()) as { error: { code: string } }).error.code, 'link_first')

  await asAuthActor(
    ctx.actorId,
    workspaceId,
    (tx) => tx`
    insert into github_person (actor_id, github_id, login, token_enc, token_until)
    values (${ctx.actorId}, ${myGithub}, 'owner', ${sealSecret('person-token')}, now() + interval '1 hour')`,
  )
  // GitHub has not said who installed it yet: asked again, not refused.
  assert.equal((await call('/api/github/installs', { installation_id: id, state })).status, 202)
  // Somebody else installed it — a member who only sees it is not its installer.
  await hook('installation', { action: 'created', installation: { id }, sender: { id: myGithub + 1 } })
  assert.equal((await call('/api/github/installs', { installation_id: id, state })).status, 400)
  // They did.
  const mine = Math.floor(Math.random() * 1e9)
  await hook('installation', { action: 'created', installation: { id: mine }, sender: { id: myGithub } })
  assert.equal((await call('/api/github/installs', { installation_id: mine, state })).status, 201)

  // Installed long ago and connected again: GitHub sends back the old id.
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()
  const ownOld = Math.floor(Math.random() * 1e9)
  const theirOld = Math.floor(Math.random() * 1e9)
  const orgOld = Math.floor(Math.random() * 1e9)
  installOf = (n) =>
    n === ownOld
      ? { account: { login: 'owner', type: 'User', id: myGithub }, created_at: longAgo }
      : { account: { login: 'acme', type: 'Organization' }, created_at: longAgo }
  try {
    // Somebody else's old one, guessed by its number: refused, as before.
    await hook('installation', { action: 'created', installation: { id: theirOld }, sender: { id: myGithub + 1 } })
    assert.equal((await call('/api/github/installs', { installation_id: theirOld, state })).status, 400)
    // An old one GitHub never named an installer for, not on their account: refused.
    assert.equal((await call('/api/github/installs', { installation_id: orgOld, state })).status, 400)
    // Old, but on their own account: theirs.
    assert.equal((await call('/api/github/installs', { installation_id: ownOld, state })).status, 201)
    // Old, on an organisation, even one GitHub says they installed: refused —
    // that was the moment, not whether they still run the organisation.
    await hook('installation', { action: 'created', installation: { id: orgOld }, sender: { id: myGithub } })
    assert.equal((await call('/api/github/installs', { installation_id: orgOld, state })).status, 400)
  } finally {
    installOf = () => ({ account: { login: 'acme', type: 'Organization' }, created_at: new Date().toISOString() })
  }
})

/* A repository linked
   again brought every open issue across as a second task. */

/** A workspace with the app installed, a project with Backlog and Done, and the ways in. */
async function synced(name: string) {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, name)
  const [backlog, done] = [uuidv7(), uuidv7()]
  const installation = Math.floor(Math.random() * 1e9)
  await withActor(ctx.actorId, workspaceId, async (tx) => {
    for (const [id, list, icon, key, finishes] of [
      [backlog, 'Backlog', 'backlog', 'a0', false],
      [done, 'Done', 'done', 'a1', true],
    ] as const) {
      await tx`insert into task_list (id, workspace_id, project_id, author_id, name, icon, sort_key, finishes)
               values (${id}, ${workspaceId}, ${project}, ${ctx.actorId}, ${list}, ${icon}, ${key}, ${finishes})`
    }
    await tx`insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
             values (${uuidv7()}, ${workspaceId}, ${installation}, 'acme', 'Organization', ${ctx.actorId})`
  })
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const link = async (to: string, repo: number) => {
    assert.equal((await call('PUT', `/projects/${to}/github`, { repo_id: repo, issues: true })).status, 200)
    await drain()
  }
  const tasks = (of = project) =>
    withActor(
      ctx.actorId,
      workspaceId,
      (tx) =>
        tx<{ id: string; title: string; list_id: string | null; issue: number | null; repo: string | null }[]>`
        select t.id, t.title, t.list_id, g.number as issue, l.repo_name as repo
        from task t left join github_issue g on g.task_id = t.id left join github_link l on l.id = g.link_id and l.deleted_at is null
        where t.project_id = ${of} and t.deleted_at is null order by t.created_at`,
    )
  return { ctx, workspaceId, project, backlog, done, installation, call, link, tasks }
}
const drain = async () => {
  while ((await githubOut()) > 0) {}
}
const repoNamed = (name: string) => {
  const repo = { id: Math.floor(Math.random() * 1e9), full_name: `acme/${name}-${uuidv7().slice(-6)}`, private: true }
  given.push(repo)
  return repo
}
const openIssue = (number: number, title: string, body = '') => ({
  number,
  title,
  body,
  state: 'open',
  state_reason: null,
  assignees: [],
  labels: [],
  user: { type: 'User', login: 'octo' },
})

test('a repository linked again finds its issues’ tasks, and a task finished meanwhile closes its issue', async () => {
  const w = await synced('Relinked')
  const repo = repoNamed('tracker')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)

  // Three tasks made while it was linked: each an issue. One is finished
  // then, so its issue is closed and the next import never lists it.
  for (const title of ['Public Roadmap', 'Calendar', 'Shipped']) {
    assert.equal((await w.call('POST', `/projects/${w.project}/tasks`, { title, list_id: w.backlog })).status, 201)
  }
  await drain()
  const [roadmap, calendar, shipped] = await w.tasks()
  assert.ok(roadmap?.issue && calendar?.issue && shipped?.issue)
  assert.equal((await w.call('PATCH', `/tasks/${shipped.id}`, { list_id: w.done })).status, 200)
  await drain()

  // Unlinked; the roadmap is finished here while nothing is sent, and its issue stays open there.
  assert.equal((await w.call('DELETE', `/projects/${w.project}/github`)).status, 204)
  assert.equal((await w.call('PATCH', `/tasks/${roadmap.id}`, { list_id: w.done })).status, 200)
  // Somebody changed the calendar's issue while it was not linked, and filed a new one.
  const fresh = nextIssue++
  openOn.set(repo.full_name, [
    openIssue(roadmap.issue, 'Public Roadmap'),
    openIssue(calendar.issue, 'Calendar, renamed on GitHub', 'Changed there'),
    openIssue(fresh, 'Filed on GitHub'),
  ])
  sent.length = 0
  await w.link(w.project, repo.id)

  // No second Public Roadmap or Calendar: the new issue is the only new task.
  const after = await w.tasks()
  assert.deepEqual(
    after.map((t) => [t.title, t.issue, t.repo]),
    [
      ['Public Roadmap', roadmap.issue, repo.full_name],
      ['Calendar', calendar.issue, repo.full_name],
      ['Shipped', shipped.issue, null],
      ['Filed on GitHub', fresh, repo.full_name],
    ],
  )
  // The task was not moved, and its finished state went to GitHub.
  assert.equal(after[0]!.list_id, w.done)
  const closed = sent.find((x) => x.method === 'PATCH' && x.path === `/repos/${repo.full_name}/issues/${roadmap.issue}`)
  assert.equal(closed?.body?.state, 'closed')
  assert.equal(closed?.body?.state_reason, 'completed')
  // The task's title wins, and what GitHub's description said is kept here.
  const renamed = sent.find((x) => x.method === 'PATCH' && x.path === `/repos/${repo.full_name}/issues/${calendar.issue}`)
  assert.equal(renamed?.body?.title, 'Calendar')
  const said = await withActor(
    w.ctx.actorId,
    w.workspaceId,
    (tx) => tx<{ body: unknown }[]>`select body from comment where object_id = ${calendar.id} and deleted_at is null`,
  )
  assert.ok(said.some((c) => JSON.stringify(c.body).includes('Changed there')))
  // Nothing was opened on GitHub for a task that already had an issue.
  assert.equal(sent.filter((x) => x.method === 'POST' && x.path === `/repos/${repo.full_name}/issues`).length, 0)

  // The closed one reopened on GitHub later: its own task comes back from
  // Done — the reopening is the latest word — and no second task is made.
  sent.length = 0
  await hook('issues', {
    action: 'reopened',
    installation: { id: w.installation },
    repository: { id: repo.id, full_name: repo.full_name },
    sender: { type: 'User', login: 'octo' },
    issue: { ...openIssue(shipped.issue, 'Shipped'), user: undefined },
  })
  await githubWork(20, '0')
  const reopened = await w.tasks()
  assert.equal(reopened.length, 4)
  const back = reopened.find((t) => t.id === shipped.id)
  assert.equal(back?.list_id, w.backlog)
  assert.equal(back?.repo, repo.full_name)
  assert.ok(
    !sent.some((x) => x.method === 'PATCH' && x.path === `/repos/${repo.full_name}/issues/${shipped.issue}` && x.body?.state === 'closed'),
  )

  // Linked to another repository, an old number means nothing there: the
  // calendar gets an issue of its own instead of writing over somebody's #n.
  const other = repoNamed('other')
  openOn.set(other.full_name, [])
  await w.link(w.project, other.id)
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${calendar.id}`, { title: 'Calendar view' })).status, 200)
  await drain()
  assert.ok(!sent.some((x) => x.method === 'PATCH' && x.path === `/repos/${other.full_name}/issues/${calendar.issue}`))
  assert.ok(sent.some((x) => x.method === 'POST' && x.path === `/repos/${other.full_name}/issues` && x.body?.title === 'Calendar view'))
})

test('the same repository linked to another project, or in another workspace, imports as anybody would', async () => {
  const w = await synced('First')
  const repo = repoNamed('shared')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  assert.equal((await w.call('POST', `/projects/${w.project}/tasks`, { title: 'Public Roadmap', list_id: w.backlog })).status, 201)
  await drain()
  const [roadmap] = await w.tasks()
  assert.ok(roadmap?.issue)
  assert.equal((await w.call('DELETE', `/projects/${w.project}/github`)).status, 204)
  openOn.set(repo.full_name, [openIssue(roadmap.issue, 'Public Roadmap')])

  // Another project of the same workspace: its own task for the issue; the first project's is left alone.
  const second = await makeProject(w.ctx, w.workspaceId, 'Second')
  await withActor(w.ctx.actorId, w.workspaceId, async (tx) => {
    await tx`insert into task_list (id, workspace_id, project_id, author_id, name, icon, sort_key)
             values (${uuidv7()}, ${w.workspaceId}, ${second}, ${w.ctx.actorId}, 'Backlog', 'backlog', 'a0')`
  })
  await w.link(second, repo.id)
  assert.deepEqual(
    (await w.tasks(second)).map((t) => [t.title, t.issue]),
    [['Public Roadmap', roadmap.issue]],
  )
  const first = await w.tasks()
  assert.equal(first.length, 1)
  assert.equal(first[0]!.id, roadmap.id)
  assert.equal(first[0]!.repo, null, 'the first project’s pairing stays under its own old link')
  assert.equal((await w.call('DELETE', `/projects/${second}/github`)).status, 204)

  // Another workspace linking the same repository: never the first one's task.
  const y = await synced('Elsewhere')
  await y.link(y.project, repo.id)
  const theirs = await y.tasks()
  assert.deepEqual(
    theirs.map((t) => [t.title, t.issue]),
    [['Public Roadmap', roadmap.issue]],
  )
  assert.notEqual(theirs[0]!.id, roadmap.id)
  assert.equal((await w.tasks()).length, 1)
})

/** Tasks made in the project while it is linked, each an issue on GitHub. */
async function madeWhileLinked(w: Awaited<ReturnType<typeof synced>>, titles: string[]) {
  for (const title of titles) {
    assert.equal((await w.call('POST', `/projects/${w.project}/tasks`, { title, list_id: w.backlog })).status, 201)
  }
  await drain()
  const all = await w.tasks()
  return titles.map((title) => {
    const t = all.find((x) => x.title === title)
    assert.ok(t?.issue, `${title} has an issue`)
    return t as typeof t & { issue: number }
  })
}
const pairingOf = async (w: Awaited<ReturnType<typeof synced>>, task: string) =>
  (
    await withActor(
      w.ctx.actorId,
      w.workspaceId,
      (tx) => tx<{ link_id: string; number: number; seen: { reattach?: string } }[]>`
        select link_id, number, seen from github_issue where task_id = ${task}`,
    )
  )[0]
const currentLink = async (w: Awaited<ReturnType<typeof synced>>) =>
  (
    await withActor(
      w.ctx.actorId,
      w.workspaceId,
      (tx) => tx<{ id: string }[]>`select id from github_link where project_id = ${w.project} and deleted_at is null`,
    )
  )[0]!.id

type Synced = Awaited<ReturnType<typeof synced>>
const parentOf = async (w: Synced, task: string) =>
  (
    await withActor(w.ctx.actorId, w.workspaceId, (tx) => tx<{ parent_id: string | null }[]>`select parent_id from task where id = ${task}`)
  )[0]?.parent_id ?? null
const saidOn = async (w: Synced, task: string) =>
  (
    await withActor(
      w.ctx.actorId,
      w.workspaceId,
      (tx) => tx<{ body: unknown }[]>`select body from comment where object_id = ${task} and deleted_at is null`,
    )
  ).map((c) => JSON.stringify(c.body))
const event = (w: Synced, repo: { id: number; full_name: string }, payload: Record<string, unknown>, sender = 'User') =>
  hook(payload.sub_issue ? 'sub_issues' : 'issues', {
    installation: { id: w.installation },
    repository: { id: repo.id, full_name: repo.full_name },
    sender: { type: sender, login: sender === 'Bot' ? 'tuff[bot]' : 'octo' },
    ...payload,
  })
const issueOf = async (w: Synced, task: string) => (await w.tasks()).find((t) => t.id === task)?.issue ?? null

test('a subtask is a sub-issue: made under its parent’s issue, moved, let stand alone, and closed with its parent', async () => {
  const w = await synced('Nested')
  const repo = repoNamed('nested')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  for (const title of ['Sign in', 'Sign up']) {
    assert.equal((await w.call('POST', `/projects/${w.project}/tasks`, { title, list_id: w.backlog })).status, 201)
  }
  await drain()
  const [a, b] = await w.tasks()
  assert.ok(a?.issue && b?.issue)

  // Made under A: an issue of its own, a sub-issue of A's.
  sent.length = 0
  const made = await w.call('POST', `/tasks/${a.id}/steps`, { title: 'Google button' })
  assert.equal(made.status, 201)
  const step = ((await made.json()) as { id: string }).id
  await drain()
  const number = (await issueOf(w, step))!
  assert.ok(sent.some((x) => x.method === 'POST' && x.path === `/repos/${repo.full_name}/issues` && x.body?.title === 'Google button'))
  const added = sent.find((x) => x.method === 'POST' && x.path === `/repos/${repo.full_name}/issues/${a.issue}/sub_issues`)
  assert.equal(added?.body?.sub_issue_id, idOf(repo.full_name, number), 'named by its id, not its number')
  assert.deepEqual(parentIssue(repo.full_name, number), { repo: repo.full_name, number: a.issue })

  // Ticked: its issue closed, though it stays in its parent's open list.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/steps/${step}`, { done: true })).status, 200)
  await drain()
  assert.equal(sent.find((x) => x.method === 'PATCH' && x.path === `/repos/${repo.full_name}/issues/${number}`)?.body?.state, 'closed')

  // Moved under B: under B's issue there, and said so in the feed.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${step}`, { parent_id: b.id })).status, 200)
  await drain()
  assert.equal(await parentOf(w, step), b.id)
  assert.deepEqual(parentIssue(repo.full_name, number), { repo: repo.full_name, number: b.issue })
  assert.equal(sent.find((x) => x.path.endsWith('/sub_issues'))?.body?.replace_parent, true)
  const [line] = await withActor(
    w.ctx.actorId,
    w.workspaceId,
    (tx) => tx<{ meta: { nested_under?: number } }[]>`
      select meta from activity_event where object_id = ${step} and action = 'task.update' order by id desc limit 1`,
  )
  assert.equal(typeof line?.meta.nested_under, 'number')
  // Written again, nothing about where it sits is sent: it has not moved.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${step}`, { title: 'Google sign-in button' })).status, 200)
  await drain()
  assert.ok(!sent.some((x) => x.path.includes('sub_issue')))

  // A task of its own: out from under B's issue, and finished where it stands.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${step}`, { parent_id: null })).status, 200)
  await drain()
  assert.equal(await parentOf(w, step), null)
  assert.ok(sent.some((x) => x.method === 'DELETE' && x.path === `/repos/${repo.full_name}/issues/${b.issue}/sub_issue`))
  assert.equal(parentIssue(repo.full_name, number), null)
  assert.equal((await w.tasks()).find((t) => t.id === step)?.list_id, w.done)

  // One level, from both ends: a task with subtasks is nobody's subtask.
  const nest = await w.call('PATCH', `/tasks/${b.id}`, { parent_id: step })
  assert.equal(nest.status, 200)
  const deeper = await w.call('PATCH', `/tasks/${step}`, { parent_id: a.id })
  assert.equal(deeper.status, 400)
  assert.equal(((await deeper.json()) as { error: { code: string } }).error.code, 'nested')
  await drain()

  // A parent deleted takes its subtasks, and both issues are closed as not planned.
  const second = ((await (await w.call('POST', `/tasks/${a.id}/steps`, { title: 'Apple button' })).json()) as { id: string }).id
  await drain()
  const secondIssue = (await issueOf(w, second))!
  sent.length = 0
  assert.equal((await w.call('DELETE', `/tasks/${a.id}`)).status, 200)
  await drain()
  for (const n of [a.issue, secondIssue]) {
    const closed = sent.find((x) => x.method === 'PATCH' && x.path === `/repos/${repo.full_name}/issues/${n}`)
    assert.deepEqual(closed?.body, { state: 'closed', state_reason: 'not_planned' })
  }
})

test('a sub-issue added or removed on GitHub nests the task here, one level deep, and says what it cannot do', async () => {
  const w = await synced('From GitHub')
  const repo = repoNamed('hub')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  for (const n of [1, 2, 3]) await event(w, repo, { action: 'opened', issue: openIssue(n, `Issue ${n}`) })
  await githubWork(20, '0')
  const [one, two, three] = (await w.tasks()).sort((x, y) => (x.issue ?? 0) - (y.issue ?? 0))
  assert.deepEqual([one?.issue, two?.issue, three?.issue], [1, 2, 3])

  // #2 under #1, told from both sides: a subtask here, once, and nothing sent back.
  await event(w, repo, {
    action: 'sub_issue_added',
    parent_issue: openIssue(1, 'Issue 1'),
    sub_issue: openIssue(2, 'Issue 2'),
    sub_issue_repo: { id: repo.id },
  })
  await event(w, repo, {
    action: 'parent_issue_added',
    parent_issue: openIssue(1, 'Issue 1'),
    sub_issue: openIssue(2, 'Issue 2'),
    parent_issue_repo: { id: repo.id },
  })
  await githubWork(20, '0')
  assert.equal(await parentOf(w, two!.id), one!.id)
  sent.length = 0
  await drain()
  assert.ok(!sent.some((x) => x.path.includes('sub_issue')))

  // #3 under #2, which is a subtask here: Tuff keeps one level, and says so — once.
  for (let i = 0; i < 2; i++) {
    await event(w, repo, {
      action: 'sub_issue_added',
      parent_issue: openIssue(2, 'Issue 2'),
      sub_issue: openIssue(3, 'Issue 3'),
      sub_issue_repo: { id: repo.id },
    })
    await githubWork(20, '0')
  }
  assert.equal(await parentOf(w, three!.id), null)
  assert.equal((await saidOn(w, three!.id)).filter((b) => b.includes('one level deep')).length, 1)
  // And written here afterwards, GitHub's nesting is left as it is.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${three!.id}`, { title: 'Issue three' })).status, 200)
  await drain()
  assert.ok(!sent.some((x) => x.path.includes('sub_issue')))

  // Under an issue of another repository: it stands alone here.
  await event(w, repo, {
    action: 'parent_issue_added',
    parent_issue: openIssue(77, 'Elsewhere'),
    parent_issue_repo: { id: repo.id + 1 },
    sub_issue: openIssue(3, 'Issue 3'),
  })
  await githubWork(20, '0')
  assert.equal(await parentOf(w, three!.id), null)

  // Our own change, come back as the app: nothing.
  await event(
    w,
    repo,
    {
      action: 'sub_issue_removed',
      parent_issue: openIssue(1, 'Issue 1'),
      sub_issue: openIssue(2, 'Issue 2'),
      sub_issue_repo: { id: repo.id },
    },
    'Bot',
  )
  await githubWork(20, '0')
  assert.equal(await parentOf(w, two!.id), one!.id)
  // Removed by somebody else's app: a change like anybody's, made here.
  await hook('sub_issues', {
    installation: { id: w.installation },
    repository: { id: repo.id, full_name: repo.full_name },
    sender: { type: 'Bot', login: 'their-automation[bot]' },
    action: 'sub_issue_removed',
    parent_issue: openIssue(1, 'Issue 1'),
    sub_issue: openIssue(2, 'Issue 2'),
    sub_issue_repo: { id: repo.id },
  })
  await githubWork(20, '0')
  assert.equal(await parentOf(w, two!.id), null)

  // A sub-issue nobody had here yet, added to a synced issue: a subtask made for it.
  await event(w, repo, {
    action: 'sub_issue_added',
    parent_issue: openIssue(1, 'Issue 1'),
    sub_issue: openIssue(4, 'Filed as a sub-issue'),
    sub_issue_repo: { id: repo.id },
  })
  await githubWork(20, '0')
  const four = (await w.tasks()).find((t) => t.issue === 4)
  assert.equal(four?.title, 'Filed as a sub-issue')
  assert.equal(await parentOf(w, four!.id), one!.id)

  // The parent issue deleted: its task goes, its sub-issues' tasks stand alone.
  await event(w, repo, { action: 'deleted', issue: openIssue(1, 'Issue 1') })
  await githubWork(20, '0')
  const left = await w.tasks()
  assert.ok(!left.some((t) => t.id === one!.id))
  assert.equal(await parentOf(w, four!.id), null)
})

test('linking brings open issues across nested, and linking again keeps the tasks’ nesting', async () => {
  const w = await synced('Imported nested')
  const repo = repoNamed('imported')
  const elsewhere = repoNamed('elsewhere')
  const [p, c1, c2, loner] = [nextIssue++, nextIssue++, nextIssue++, nextIssue++]
  openOn.set(repo.full_name, [
    openIssue(p, 'Parent'),
    openIssue(c1, 'Child one'),
    openIssue(c2, 'Child two'),
    openIssue(loner, 'Under another repo'),
  ])
  nestOn(repo.full_name, p, c1)
  nestOn(repo.full_name, p, c2)
  nestOn(elsewhere.full_name, 9, loner, repo.full_name)
  await w.link(w.project, repo.id)
  const byIssue = async () => new Map((await w.tasks()).map((t) => [t.issue, t.id]))
  let tasks = await byIssue()
  assert.equal(tasks.size, 4)
  assert.equal(await parentOf(w, tasks.get(c1)!), tasks.get(p))
  assert.equal(await parentOf(w, tasks.get(c2)!), tasks.get(p))
  assert.equal(await parentOf(w, tasks.get(loner)!), null, 'a parent in another repository is not a task here')

  // Written here, the one under another repository's issue is left under it.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${tasks.get(loner)}`, { title: 'Still under another repo' })).status, 200)
  await drain()
  assert.ok(!sent.some((x) => x.path.includes('sub_issue')))
  assert.equal(parentIssue(repo.full_name, loner)?.repo, elsewhere.full_name)

  // Unlinked; child one is made a task of its own here meanwhile. Linked
  // again: no second task of anything, child two still nested, and the
  // task's nesting put over GitHub's for child one.
  assert.equal((await w.call('DELETE', `/projects/${w.project}/github`)).status, 204)
  assert.equal((await w.call('PATCH', `/tasks/${tasks.get(c1)}`, { parent_id: null })).status, 200)
  sent.length = 0
  await w.link(w.project, repo.id)
  tasks = await byIssue()
  assert.equal((await w.tasks()).length, 4)
  assert.equal(await parentOf(w, tasks.get(c1)!), null)
  assert.equal(await parentOf(w, tasks.get(c2)!), tasks.get(p))
  assert.ok(sent.some((x) => x.method === 'DELETE' && x.path === `/repos/${repo.full_name}/issues/${p}/sub_issue`))
  assert.equal(parentIssue(repo.full_name, c1), null)
  assert.equal(parentIssue(repo.full_name, c2)?.number, p)
  assert.equal(parentIssue(repo.full_name, loner)?.repo, elsewhere.full_name)
})

test('an issue with a hundred sub-issues takes no more, and the subtask says so once', async () => {
  const w = await synced('Full')
  const repo = repoNamed('full')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  assert.equal((await w.call('POST', `/projects/${w.project}/tasks`, { title: 'Epic', list_id: w.backlog })).status, 201)
  await drain()
  const [epic] = await w.tasks()
  for (let i = 0; i < 100; i++) nestOn(repo.full_name, epic!.issue!, 900_000 + i)
  const step = ((await (await w.call('POST', `/tasks/${epic!.id}/steps`, { title: 'One too many' })).json()) as { id: string }).id
  await drain()
  const number = (await issueOf(w, step))!
  assert.ok(number, 'its issue is made all the same')
  assert.equal(parentIssue(repo.full_name, number), null)
  assert.equal(await parentOf(w, step), epic!.id, 'still a subtask here')
  const said = () => saidOn(w, step).then((all) => all.filter((b) => b.includes('100 sub-issues')))
  assert.equal((await said()).length, 1)
  assert.ok((await said())[0]!.includes('Parent cannot have more than 100 sub-issues'), 'GitHub’s own words with it')
  // Written again within the hour, and its parent too: not asked again, said no second time.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${step}`, { title: 'Still one too many' })).status, 200)
  assert.equal((await w.call('PATCH', `/tasks/${epic!.id}`, { title: 'Epic, full' })).status, 200)
  await drain()
  assert.ok(!sent.some((x) => x.path.endsWith('/sub_issues')))
  assert.equal((await said()).length, 1)
  // An hour on, with room made on GitHub: the next write puts it there.
  subsOf.set(idOf(repo.full_name, epic!.issue!), [])
  await withActor(
    w.ctx.actorId,
    w.workspaceId,
    (tx) => tx`update github_issue set nest_refused_at = now() - interval '2 hours' where task_id = ${step}`,
  )
  assert.equal((await w.call('PATCH', `/tasks/${step}`, { title: 'Room now' })).status, 200)
  await drain()
  assert.equal(parentIssue(repo.full_name, number)?.number, epic!.issue)
})

test('sub-issues reach no other project and no other workspace', async () => {
  const w = await synced('Ours')
  const y = await synced('Theirs')
  const ours = repoNamed('ours')
  const theirs = repoNamed('theirs')
  openOn.set(ours.full_name, [])
  openOn.set(theirs.full_name, [])
  await w.link(w.project, ours.id)
  await y.link(y.project, theirs.id)
  for (const n of [1, 2]) {
    await event(w, ours, { action: 'opened', issue: openIssue(n, `Ours ${n}`) })
    await event(y, theirs, { action: 'opened', issue: openIssue(n, `Theirs ${n}`) })
  }
  await githubWork(20, '0')
  // #2 under #1 in our repository: only our task moves, though theirs has the same numbers.
  await event(w, ours, {
    action: 'sub_issue_added',
    parent_issue: openIssue(1, 'Ours 1'),
    sub_issue: openIssue(2, 'Ours 2'),
    sub_issue_repo: { id: ours.id },
  })
  await githubWork(20, '0')
  const [o1, o2] = (await w.tasks()).sort((x, z) => (x.issue ?? 0) - (z.issue ?? 0))
  const [t1, t2] = (await y.tasks()).sort((x, z) => (x.issue ?? 0) - (z.issue ?? 0))
  assert.equal(await parentOf(w, o2!.id), o1!.id)
  assert.equal(await parentOf(y, t2!.id), null)
  // Their installation naming our repository reaches nothing: it is not theirs.
  await hook('sub_issues', {
    action: 'sub_issue_removed',
    installation: { id: y.installation },
    repository: { id: ours.id, full_name: ours.full_name },
    sender: { type: 'User' },
    parent_issue: openIssue(1, 'Ours 1'),
    sub_issue: openIssue(2, 'Ours 2'),
    sub_issue_repo: { id: ours.id },
  })
  await githubWork(20, '0')
  assert.equal(await parentOf(w, o2!.id), o1!.id)

  // Here, a task cannot be put under another project's, nor another workspace's.
  const other = await makeProject(w.ctx, w.workspaceId, 'Next door')
  const next = await w.call('POST', `/projects/${other}/tasks`, { title: 'Next door task' })
  const nextId = ((await next.json()) as { id: string }).id
  assert.equal((await w.call('PATCH', `/tasks/${o2!.id}`, { parent_id: nextId })).status, 400)
  assert.equal((await w.call('PATCH', `/tasks/${o2!.id}`, { parent_id: t1!.id })).status, 400)
  assert.equal(await parentOf(w, o2!.id), o1!.id)
})

/* What the independent review of found. */

test('a re-parent refused for another reason is not half saved, and two at once leave one level', async () => {
  const w = await synced('Refused whole')
  const make = async (title: string) =>
    ((await (await w.call('POST', `/projects/${w.project}/tasks`, { title, list_id: w.backlog })).json()) as { id: string }).id
  const [a, b] = [await make('A'), await make('B')]
  // A label of another project beside the move: 400, and the task has not moved.
  const other = await makeProject(w.ctx, w.workspaceId, 'Labels elsewhere')
  const label = (await (await w.call('POST', `/projects/${other}/labels`, { name: 'elsewhere' })).json()) as {
    id?: string
    label?: { id: string }
  }
  const labelId = label.id ?? label.label!.id
  const r = await w.call('PATCH', `/tasks/${b}`, { parent_id: a, labels: [labelId] })
  assert.equal(r.status, 400)
  assert.equal(await parentOf(w, b), null)

  // A under B and B under A at the same moment: one is put, the other told
  // why — never a cycle, never two levels, never a 500.
  const [x, y] = await Promise.all([w.call('PATCH', `/tasks/${a}`, { parent_id: b }), w.call('PATCH', `/tasks/${b}`, { parent_id: a })])
  assert.deepEqual([x.status, y.status].sort(), [200, 400])
  const [pa, pb] = [await parentOf(w, a), await parentOf(w, b)]
  assert.ok((pa === b && pb === null) || (pb === a && pa === null), 'one level, no cycle')
  const lost = x.status === 400 ? x : y
  assert.equal(((await lost.json()) as { error: { code: string } }).error.code, 'nested')

  // Its own message for a task that has subtasks.
  const top = pa === b ? b : a
  const third = await make('C')
  const refused = await w.call('PATCH', `/tasks/${top}`, { parent_id: third })
  assert.equal(refused.status, 400)
  assert.equal(((await refused.json()) as { error: { message: string } }).error.message, 'A task with subtasks can’t be a subtask.')
})

test('a subtask put back from Trash after its parent was nested stands on its own', async () => {
  const w = await synced('Put back')
  const make = async (title: string) =>
    ((await (await w.call('POST', `/projects/${w.project}/tasks`, { title, list_id: w.backlog })).json()) as { id: string }).id
  const [x, y] = [await make('X'), await make('Y')]
  const s = ((await (await w.call('POST', `/tasks/${x}/steps`, { title: 'S' })).json()) as { id: string }).id
  assert.equal((await w.call('DELETE', `/tasks/${s}`)).status, 200)
  // With S in Trash, X has no subtask standing, so it may go under Y.
  assert.equal((await w.call('PATCH', `/tasks/${x}`, { parent_id: y })).status, 200)
  assert.equal((await w.call('POST', `/tasks/${s}/restore`)).status, 200)
  assert.equal(await parentOf(w, s), null, 'not two levels deep')
  assert.equal(await parentOf(w, x), y)
})

test('an issue made and then refused its close for now is closed on the retry, not made twice', async () => {
  const w = await synced('Retried')
  const repo = repoNamed('retried')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  sent.length = 0
  refuseOnce = (x) =>
    x.method === 'PATCH' && /\/issues\/\d+$/.test(x.path) && x.body?.state === 'closed'
      ? new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 429 })
      : null
  assert.equal((await w.call('POST', `/projects/${w.project}/tasks`, { title: 'Done already', list_id: w.done })).status, 201)
  await drain()
  assert.equal(refuseOnce, null, 'the close was refused once')
  assert.equal(sent.filter((x) => x.method === 'POST' && x.path === `/repos/${repo.full_name}/issues`).length, 1)
  const closes = sent.filter((x) => x.method === 'PATCH' && /\/issues\/\d+$/.test(x.path) && x.body?.state === 'closed')
  assert.equal(closes.length, 2, 'refused, then sent again on the same issue')
  assert.equal(closes[0]!.path, closes[1]!.path)
})

test('only new subtasks go with their parent; an older one goes when it is itself written', async () => {
  const w = await synced('Old subtasks')
  const repo = repoNamed('old')
  openOn.set(repo.full_name, [])
  // Made before the repository was linked: a task and its subtask.
  const parent = (
    (await (await w.call('POST', `/projects/${w.project}/tasks`, { title: 'Parent', list_id: w.backlog })).json()) as { id: string }
  ).id
  const old = ((await (await w.call('POST', `/tasks/${parent}/steps`, { title: 'Old step' })).json()) as { id: string }).id
  await new Promise((r) => setTimeout(r, 20))
  await w.link(w.project, repo.id)

  // The parent written: it gets its issue, and the old subtask stays put.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${parent}`, { title: 'Parent, written' })).status, 200)
  await drain()
  assert.ok(await issueOf(w, parent))
  assert.equal(await issueOf(w, old), null)
  assert.equal(sent.filter((x) => x.method === 'POST' && x.path === `/repos/${repo.full_name}/issues`).length, 1)

  // A new subtask goes, at once, under the parent's issue.
  const fresh = ((await (await w.call('POST', `/tasks/${parent}/steps`, { title: 'New step' })).json()) as { id: string }).id
  await drain()
  const freshIssue = await issueOf(w, fresh)
  assert.ok(freshIssue)
  assert.equal(parentIssue(repo.full_name, freshIssue!)?.number, await issueOf(w, parent))
  // Written again, the parent still leaves the old one alone.
  assert.equal((await w.call('PATCH', `/tasks/${parent}`, { title: 'Parent, again' })).status, 200)
  await drain()
  assert.equal(await issueOf(w, old), null)

  // The old one written itself: now it goes, under its parent's issue.
  assert.equal((await w.call('PATCH', `/tasks/${old}`, { title: 'Old step, written' })).status, 200)
  await drain()
  const oldIssue = await issueOf(w, old)
  assert.ok(oldIssue)
  assert.equal(parentIssue(repo.full_name, oldIssue!)?.number, await issueOf(w, parent))
})

test('taken out from under a parent GitHub had already moved it from, it comes out from under the one it is under now', async () => {
  const w = await synced('Stale parent')
  const repo = repoNamed('stale')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  for (const title of ['A', 'C'])
    assert.equal((await w.call('POST', `/projects/${w.project}/tasks`, { title, list_id: w.backlog })).status, 201)
  await drain()
  const [a, c] = await w.tasks()
  const step = ((await (await w.call('POST', `/tasks/${a!.id}/steps`, { title: 'Moving' })).json()) as { id: string }).id
  await drain()
  const number = (await issueOf(w, step))!
  // Moved under C on GitHub by an event that never came.
  nestOn(repo.full_name, c!.issue!, number)
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${step}`, { parent_id: null })).status, 200)
  await drain()
  assert.ok(sent.some((x) => x.method === 'GET' && x.path === `/repos/${repo.full_name}/issues/${number}/parent`))
  assert.equal(parentIssue(repo.full_name, number), null)
})

test('linking again reads every page before closing anything, so no open issue is skipped', async () => {
  const w = await synced('Paged')
  const repo = repoNamed('paged')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  const finished = await madeWhileLinked(w, ['One', 'Two', 'Three'])
  assert.equal((await w.call('DELETE', `/projects/${w.project}/github`)).status, 204)
  for (const t of finished) assert.equal((await w.call('PATCH', `/tasks/${t.id}`, { list_id: w.done })).status, 200)

  // 105 open: the three finished here first, on page one, then 102 new ones.
  const fresh = Array.from({ length: 102 }, () => nextIssue++)
  openOn.set(repo.full_name, [...finished.map((t) => openIssue(t.issue, t.title)), ...fresh.map((n) => openIssue(n, `Filed ${n}`))])
  await w.link(w.project, repo.id)

  const after = await w.tasks()
  assert.equal(after.length, 105)
  for (const n of fresh) assert.equal(after.filter((t) => t.issue === n).length, 1, `#${n} once`)
  for (const t of finished) {
    assert.equal(after.find((x) => x.id === t.id)?.list_id, w.done)
    assert.equal(openOn.get(repo.full_name)!.find((i) => i.number === t.issue)?.state, 'closed')
  }
})

test('a re-attach GitHub refuses halfway is finished by the next try, and one issue’s refusal does not stop the rest', async () => {
  const w = await synced('Refused')
  const repo = repoNamed('refused')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  const [roadmap, calendar] = await madeWhileLinked(w, ['Public Roadmap', 'Calendar'])
  assert.equal((await w.call('DELETE', `/projects/${w.project}/github`)).status, 204)
  assert.equal((await w.call('PATCH', `/tasks/${roadmap!.id}`, { list_id: w.done })).status, 200)

  const fresh = nextIssue++
  const broken = nextIssue++
  openOn.set(repo.full_name, [
    openIssue(roadmap!.issue, 'Public Roadmap', 'Changed there'),
    openIssue(calendar!.issue, 'Calendar'),
    openIssue(fresh, 'Filed on GitHub'),
    openIssue(broken, 'Its comments will not come'),
  ])
  commentsOn.set(`${repo.full_name}#${roadmap!.issue}`, [
    { id: 880001, body: 'Said while unlinked', user: { id: 7, login: 'octo', type: 'User' } },
  ])
  // GitHub refuses the roadmap's close once (rate limited), and an issue's comments for good.
  refuse.set(`PATCH /repos/${repo.full_name}/issues/${roadmap!.issue}`, [503])
  refuse.set(`GET /repos/${repo.full_name}/issues/${broken}/comments`, [404])
  sent.length = 0
  await w.link(w.project, repo.id)

  const after = await w.tasks()
  assert.deepEqual(after.map((t) => t.title).sort(), ['Calendar', 'Filed on GitHub', 'Its comments will not come', 'Public Roadmap'])
  // Finished on the second try: closed there, the mark gone, and each thing said once.
  const closes = sent.filter((x) => x.method === 'PATCH' && x.path === `/repos/${repo.full_name}/issues/${roadmap!.issue}`)
  assert.equal(closes.length, 2, 'refused once, then sent again')
  assert.equal(openOn.get(repo.full_name)!.find((i) => i.number === roadmap!.issue)?.state, 'closed')
  for (const t of [roadmap!, calendar!]) {
    const p = await pairingOf(w, t.id)
    assert.equal(p?.link_id, await currentLink(w))
    assert.equal(p?.seen.reattach, undefined)
  }
  const said = await saidOn(w, roadmap!.id)
  assert.equal(said.filter((b) => b.includes('Changed there')).length, 1)
  assert.equal(said.filter((b) => b.includes('Said while unlinked')).length, 1)

  // The import again, as if queued twice: nothing new, nothing said twice.
  await withActor(
    w.ctx.actorId,
    w.workspaceId,
    (tx) => tx`insert into github_out (id, workspace_id, project_id, kind, object_id, actor_id)
               values (${uuidv7()}, ${w.workspaceId}, ${w.project}, 'import', ${w.project}, ${w.ctx.actorId})`,
  )
  await drain()
  assert.equal((await w.tasks()).length, 4)
  assert.equal((await saidOn(w, roadmap!.id)).filter((b) => b.includes('Said while unlinked')).length, 1)
})

test('a task whose issue another task holds now sends nothing, and deleting either closes nothing', async () => {
  const w = await synced('Held')
  const repo = repoNamed('held')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  const [original] = await madeWhileLinked(w, ['Public Roadmap'])
  assert.equal((await w.call('DELETE', `/projects/${w.project}/github`)).status, 204)
  await w.link(w.project, repo.id)
  // Production as left it: a duplicate holding the issue under the new link.
  const duplicate = uuidv7()
  const link = await currentLink(w)
  await withActor(w.ctx.actorId, w.workspaceId, async (tx) => {
    await tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key, list_id)
             values (${duplicate}, ${w.workspaceId}, ${w.project}, ${w.ctx.actorId}, 'Public Roadmap', 'a9', ${w.backlog})`
    await tx`insert into github_issue (workspace_id, project_id, link_id, task_id, number, seen)
             values (${w.workspaceId}, ${w.project}, ${link}, ${duplicate}, ${original!.issue}, ${tx.json({ title: 'Public Roadmap', state: 'open' })})`
  })
  const touched = () =>
    sent.filter((x) => x.path.startsWith(`/repos/${repo.full_name}/issues`) && (x.method === 'POST' || x.method === 'PATCH'))

  // The original changed: not sent over the duplicate's issue, nor made a new one.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${original!.id}`, { title: 'Public Roadmap, the original' })).status, 200)
  await drain()
  assert.deepEqual(touched(), [])

  // The duplicate deleted by hand: the original still has the issue under its old link.
  assert.equal((await w.call('DELETE', `/tasks/${duplicate}`)).status, 200)
  await drain()
  assert.deepEqual(touched(), [], 'no "Deleted in Tuff.", no close')

  // The duplicate let go of it: the original's next change goes to the issue again…
  openOn.set(repo.full_name, [openIssue(original!.issue, 'Public Roadmap')])
  assert.equal((await w.call('PATCH', `/tasks/${original!.id}`, { title: 'Public Roadmap, again' })).status, 200)
  await drain()
  const renamed = touched().find((x) => x.method === 'PATCH' && x.path === `/repos/${repo.full_name}/issues/${original!.issue}`)
  assert.equal(renamed?.body?.title, 'Public Roadmap, again')
  assert.equal((await pairingOf(w, original!.id))?.link_id, link)
  // …and what GitHub does to it lands on the original.
  await hook('issues', {
    action: 'edited',
    installation: { id: w.installation },
    repository: { id: repo.id, full_name: repo.full_name },
    sender: { type: 'User', login: 'octo' },
    issue: openIssue(original!.issue, 'Renamed on GitHub'),
  })
  await githubWork(20, '0')
  assert.equal((await w.tasks()).find((t) => t.id === original!.id)?.title, 'Renamed on GitHub')

  // Paired with another repository's issue, then the project moved to a new one: deleting closes nothing there.
  const v = await synced('Moved')
  const first = repoNamed('first')
  const second = repoNamed('second')
  openOn.set(first.full_name, [])
  openOn.set(second.full_name, [])
  await v.link(v.project, first.id)
  const [moved] = await madeWhileLinked(v, ['Kept'])
  await v.link(v.project, second.id)
  sent.length = 0
  assert.equal((await v.call('DELETE', `/tasks/${moved!.id}`)).status, 200)
  await drain()
  assert.ok(!sent.some((x) => x.path.startsWith(`/repos/${second.full_name}/issues/${moved!.issue}`)))
})

test('a comment on an issue closed before linking again finds its task, and is said once', async () => {
  const w = await synced('Commented')
  const repo = repoNamed('commented')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  const [shipped] = await madeWhileLinked(w, ['Shipped'])
  assert.equal((await w.call('PATCH', `/tasks/${shipped!.id}`, { list_id: w.done })).status, 200)
  await drain()
  assert.equal((await w.call('DELETE', `/projects/${w.project}/github`)).status, 204)
  // Closed on GitHub, so the next import does not list it.
  openOn.set(repo.full_name, [{ ...openIssue(shipped!.issue, 'Shipped'), state: 'closed', state_reason: 'completed' }])
  await w.link(w.project, repo.id)

  const comment = { id: 880101, body: 'Still broken on Safari', user: { id: 8, login: 'octo', type: 'User' } }
  commentsOn.set(`${repo.full_name}#${shipped!.issue}`, [comment])
  await hook('issue_comment', {
    action: 'created',
    installation: { id: w.installation },
    repository: { id: repo.id, full_name: repo.full_name },
    sender: { type: 'User', id: 8, login: 'octo' },
    issue: { ...openIssue(shipped!.issue, 'Shipped'), state: 'closed', state_reason: 'completed' },
    comment,
  })
  await githubWork(20, '0')

  assert.equal((await w.tasks()).length, 1, 'no second task')
  const p = await pairingOf(w, shipped!.id)
  assert.equal(p?.link_id, await currentLink(w))
  assert.equal(p?.seen.reattach, undefined)
  assert.equal((await saidOn(w, shipped!.id)).filter((b) => b.includes('Still broken on Safari')).length, 1)
})

test('a duplicate already in Trash holds no issue: its original takes it back, and deleting the last live one closes it', async () => {
  const w = await synced('Binned')
  const repo = repoNamed('binned')
  openOn.set(repo.full_name, [])
  await w.link(w.project, repo.id)
  const [kept, dropped] = await madeWhileLinked(w, ['Kept', 'Dropped'])
  assert.equal((await w.call('DELETE', `/projects/${w.project}/github`)).status, 204)
  await w.link(w.project, repo.id)
  // As production may hold it: each issue still paired with a duplicate in Trash, under the new link.
  const link = await currentLink(w)
  await withActor(w.ctx.actorId, w.workspaceId, async (tx) => {
    for (const o of [kept!, dropped!]) {
      const d = uuidv7()
      await tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key, list_id, deleted_at)
               values (${d}, ${w.workspaceId}, ${w.project}, ${w.ctx.actorId}, ${o.title}, 'a9', ${w.backlog}, now())`
      await tx`insert into github_issue (workspace_id, project_id, link_id, task_id, number, seen)
               values (${w.workspaceId}, ${w.project}, ${link}, ${d}, ${o.issue}, ${tx.json({ title: o.title, state: 'open' })})`
    }
  })
  openOn.set(repo.full_name, [openIssue(kept!.issue, 'Kept'), openIssue(dropped!.issue, 'Dropped')])
  const issueWrites = (n: number) =>
    sent.filter((x) => x.path.startsWith(`/repos/${repo.full_name}/issues/${n}`) && (x.method === 'POST' || x.method === 'PATCH'))

  // Written to: the original takes its issue back from the one in Trash.
  sent.length = 0
  assert.equal((await w.call('PATCH', `/tasks/${kept!.id}`, { title: 'Kept, renamed' })).status, 200)
  await drain()
  assert.equal(issueWrites(kept!.issue).find((x) => x.method === 'PATCH')?.body?.title, 'Kept, renamed')
  assert.equal((await pairingOf(w, kept!.id))?.link_id, link)

  // Deleted while only a task in Trash holds its issue: nobody live has it, so it is closed.
  sent.length = 0
  assert.equal((await w.call('DELETE', `/tasks/${dropped!.id}`)).status, 200)
  await drain()
  const closing = issueWrites(dropped!.issue)
  assert.ok(closing.some((x) => x.method === 'POST' && x.body?.body === 'Deleted in Tuff.'))
  assert.ok(closing.some((x) => x.method === 'PATCH' && x.body?.state === 'closed' && x.body?.state_reason === 'not_planned'))
})

/*
 * A comment goes to GitHub in its author's name only when they said it
 * themselves, and while they are still in the workspace and on the project
 * — "Comments". Owners and whoever runs a project may edit
 * anybody's words here and put back a deleted comment; those went to GitHub
 * with our own token, in their name, and went on doing so after the
 * author was removed. Here, not in a file of their own: `githubOut` takes
 * the queue's jobs whoever made them, and two files draining it at once
 * each send the other's to their own fake GitHub.
 */
const H = await import('./helpers.js')
const { sealSecret } = await import('../src/github.js')

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const api = async (method: string, path: string, token: string, body?: unknown) => {
  const r = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
}
const comments = () => sent.filter((s) => /\/comments(\/\d+)?$/.test(s.path))
const asApp = (s: Sent) => (s.auth ?? '').endsWith('inst-token')

/* A workspace whose project is linked to a repository with issues, and a
   member on it with their GitHub linked. */
async function linked() {
  const { ctx, workspaceId, token: owner } = await H.makeOwner()
  const project = await H.makeProject(ctx, workspaceId, 'Synced')
  const person = await H.addPerson(ctx, workspaceId, 'member', [project])
  await H.asTableOwner()`update actor set name = 'Ada' where id = ${person.actorId}`
  const theirs = await H.bearerFor(person.actorId, workspaceId)
  const install = H.uuidv7()
  await H.withActor(ctx.actorId, async (tx) => {
    await tx`insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
             values (${install}, ${workspaceId}, ${Math.floor(Math.random() * 1e9)}, 'acme', 'Organization', ${ctx.actorId})`
    await tx`insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, issues, linked_by)
             values (${H.uuidv7()}, ${workspaceId}, ${project}, ${install}, ${Math.floor(Math.random() * 1e9)}, 'acme/web', true, true, ${ctx.actorId})`
  })
  const personal = `tok-${H.stamp()}`
  await H.asTableOwner()`
    insert into github_person (actor_id, github_id, login, token_enc, token_until)
    values (${person.actorId}, ${Math.floor(Math.random() * 1e9)}, ${`ada-${H.stamp()}`}, ${sealSecret(personal)}, now() + interval '1 hour')`
  const task = await api('POST', `/api/projects/${project}/tasks`, theirs, { title: 'Synced task' })
  assert.equal(task.status, 201, JSON.stringify(task.body))
  await drain()
  return { ctx, workspaceId, owner, project, person, theirs, personal, task: task.body.id as string }
}

const linkedGithub = async (actor: string) =>
  (await H.asTableOwner()<{ n: number }[]>`select count(*)::int as n from github_person where actor_id = ${actor}`)[0]!.n

test('a comment and its edits go as its author when they made them, and as the app under their name when somebody else did', async () => {
  const { owner, theirs, personal, task } = await linked()
  const asThem = (s: Sent) => s.auth === `Bearer ${personal}`

  // Their own comment: as them, in their words.
  sent.length = 0
  const said = await api('POST', `/api/tasks/${task}/comments`, theirs, { body: doc('mine') })
  assert.equal(said.status, 201)
  await drain()
  const posted = comments().find((s) => s.method === 'POST')
  assert.ok(posted && asThem(posted), 'their comment goes with their token')
  assert.equal(posted.body?.body, 'mine')

  // Their own edit: as them.
  sent.length = 0
  assert.equal((await api('PATCH', `/api/comments/${said.body.id}`, theirs, { body: doc('mine, fixed') })).status, 200)
  await drain()
  const fixed = comments().find((s) => s.method === 'PATCH')
  assert.ok(fixed && asThem(fixed), 'their own edit goes with their token')
  assert.equal(fixed.body?.body, 'mine, fixed')

  // The owner rewrites it: nothing with their token; their comment taken
  // down there and the words posted by the app, under their name.
  sent.length = 0
  assert.equal((await api('PATCH', `/api/comments/${said.body.id}`, owner, { body: doc('words Ada never wrote') })).status, 200)
  await drain()
  assert.ok(!comments().some(asThem), 'somebody else’s edit never carries the author’s token')
  assert.ok(
    comments().some((s) => s.method === 'DELETE' && asApp(s)),
    'their comment on GitHub is taken down',
  )
  const reposted = comments().find((s) => s.method === 'POST')
  assert.ok(reposted && asApp(reposted))
  assert.equal(reposted.body?.body, '**Ada** on Tuff:\n\nwords Ada never wrote')

  // A sync with nothing changed sends nothing.
  sent.length = 0
  assert.equal((await api('PATCH', `/api/tasks/${task}`, theirs, { title: 'Synced task, renamed' })).status, 200)
  await drain()
  assert.equal(comments().length, 0)

  // They delete a comment of their own; the owner puts it back: as the app.
  const second = await api('POST', `/api/tasks/${task}/comments`, theirs, { body: doc('second') })
  assert.equal(second.status, 201)
  await drain()
  assert.equal((await api('DELETE', `/api/comments/${second.body.id}`, theirs)).status, 200)
  await drain()
  sent.length = 0
  assert.equal((await api('POST', `/api/comments/${second.body.id}/restore`, owner)).status, 200)
  await drain()
  assert.ok(!comments().some(asThem), 'a comment put back by somebody else is not written as its author')
  const back = comments().find((s) => s.method === 'POST')
  assert.ok(back && asApp(back))
  assert.equal(back.body?.body, '**Ada** on Tuff:\n\nsecond')
})

test('somebody removed from the workspace is never written as again, and their linked GitHub goes', async () => {
  const { owner, person, theirs, personal, task } = await linked()
  const asThem = (s: Sent) => s.auth === `Bearer ${personal}`
  const said = await api('POST', `/api/tasks/${task}/comments`, theirs, { body: doc('before I left') })
  assert.equal(said.status, 201)
  await drain()

  assert.equal((await api('DELETE', `/api/people/${person.actorId}`, owner)).status, 200)
  assert.equal(await linkedGithub(person.actorId), 0, 'their only workspace ended: their GitHub goes')

  sent.length = 0
  assert.equal((await api('PATCH', `/api/comments/${said.body.id}`, owner, { body: doc('after Ada left') })).status, 200)
  await drain()
  assert.ok(!comments().some(asThem))
  assert.equal(comments().find((s) => s.method === 'POST')?.body?.body, '**Ada** on Tuff:\n\nafter Ada left')
})

test('a comment of their own, sent after they were taken out, goes as the app; a GitHub they use elsewhere stays', async () => {
  const { owner, person, theirs, personal, task } = await linked()
  const asThem = (s: Sent) => s.auth === `Bearer ${personal}`
  // In another company's workspace too.
  const other = await H.makeOwner()
  await H.asTableOwner()`
    insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (${H.uuidv7()}, ${other.workspaceId}, ${person.actorId}, 'member'::role_kind, now())`

  // Said by them, and not yet sent when they are removed.
  const said = await api('POST', `/api/tasks/${task}/comments`, theirs, { body: doc('said while here') })
  assert.equal(said.status, 201)
  assert.equal((await api('DELETE', `/api/people/${person.actorId}`, owner)).status, 200)
  assert.equal(await linkedGithub(person.actorId), 1, 'still in another workspace: their GitHub is theirs there')

  sent.length = 0
  await drain()
  assert.ok(!comments().some(asThem), 'a workspace they left does not write as them')
  assert.equal(comments().find((s) => s.method === 'POST')?.body?.body, '**Ada** on Tuff:\n\nsaid while here')
})

test('a comment of their own, sent after they were taken off the project, goes as the app', async () => {
  const { project, person, theirs, personal, task } = await linked()
  const said = await api('POST', `/api/tasks/${task}/comments`, theirs, { body: doc('said while on it') })
  assert.equal(said.status, 201)
  await H.asTableOwner()`
    update project_member set deleted_at = now() where project_id = ${project} and actor_id = ${person.actorId}`
  sent.length = 0
  await drain()
  assert.ok(!comments().some((s) => s.auth === `Bearer ${personal}`))
  assert.equal(comments().find((s) => s.method === 'POST')?.body?.body, '**Ada** on Tuff:\n\nsaid while on it')
  assert.equal(await linkedGithub(person.actorId), 1, 'still in the workspace: their GitHub stays')
})

test('leaving the last workspace drops a linked GitHub', async () => {
  const { workspaceId, person } = await linked()
  const [r] = await H.inWorkspace(person.actorId, workspaceId, (tx) => tx<{ ok: boolean }[]>`select leave_workspace() as ok`)
  assert.equal(r?.ok, true)
  assert.equal(await linkedGithub(person.actorId), 0)
})

/* An old comment that names somebody: the Markdown made of it changes when
   they unlink or leave, and the words do not. */
async function mentioning() {
  const s = await linked()
  const bob = await H.addPerson(s.ctx, s.workspaceId, 'member', [s.project])
  await H.asTableOwner()`update actor set name = 'Bob' where id = ${bob.actorId}`
  const login = `bob-${H.stamp()}`
  await H.asTableOwner()`
    insert into github_person (actor_id, github_id, login) values (${bob.actorId}, ${Math.floor(Math.random() * 1e9)}, ${login})`
  const said = await api('POST', `/api/tasks/${s.task}/comments`, s.theirs, {
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ask ' },
            { type: 'mention', attrs: { id: bob.actorId, label: 'Bob' } },
          ],
        },
      ],
    },
  })
  assert.equal(said.status, 201, JSON.stringify(said.body))
  sent.length = 0
  await drain()
  const posted = comments().find((x) => x.method === 'POST')
  assert.equal(posted?.auth, `Bearer ${s.personal}`)
  assert.equal(posted?.body?.body, `ask @${login}`)
  return { ...s, bob, comment: said.body.id as string }
}
/* Something else about the task changes, so its comments are looked at again. */
const touch = async (task: string, as: string, title: string) => {
  assert.equal((await api('PATCH', `/api/tasks/${task}`, as, { title })).status, 200)
  sent.length = 0
  await drain()
}

test('a comment whose words nobody changed is never taken down: a name it mentions unlinking only reads differently', async () => {
  const { bob, theirs, owner, personal, person, task } = await mentioning()
  await H.asTableOwner()`delete from github_person where actor_id = ${bob.actorId}`
  await touch(task, theirs, 'Renamed once')
  assert.ok(!comments().some((x) => x.method === 'DELETE' || x.method === 'POST'), 'not taken down, not posted again')
  // Its author may still be written as: the new reading goes as them, in place.
  const patched = comments().find((x) => x.method === 'PATCH')
  assert.equal(patched?.auth, `Bearer ${personal}`)
  assert.equal(patched?.body?.body, 'ask **Bob**')

  // Its author gone, and the name reading differently again: left exactly
  // as GitHub has it.
  assert.equal((await api('DELETE', `/api/people/${person.actorId}`, owner)).status, 200)
  await H.asTableOwner()`
    insert into github_person (actor_id, github_id, login) values (${bob.actorId}, ${Math.floor(Math.random() * 1e9)}, ${`bob-${H.stamp()}`})`
  await touch(task, owner, 'Renamed twice')
  assert.equal(comments().length, 0)
})

test('a comment from before the words were tracked is neither taken down nor written as its author when it reads differently', async () => {
  const { bob, owner, personal, task, comment } = await mentioning()
  /* As 292 found it: no `said_hash`, and `changed_by` never set. Past the
     trigger, as only the tables' owner can be. */
  await H.asTableOwner().begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    await tx`update comment set changed_by = null where id = ${comment}`
    await tx`update github_comment set said_hash = null where comment_id = ${comment}`
  })
  /* The person mentioned leaves; the author is still here, and may be
     written as. Whose words the row holds is not known — an owner's edit
     queued when 292 arrived, or one the old sync already wrote as them —
     so not as them. */
  assert.equal((await api('DELETE', `/api/people/${bob.actorId}`, owner)).status, 200)
  await touch(task, owner, 'Renamed')
  assert.ok(!sent.some((x) => x.auth === `Bearer ${personal}`), 'not as its author')
  assert.equal(comments().length, 0, 'left as GitHub has it')
})

test('the owner’s words the app edited into their comment are never later written as its author', async () => {
  const { bob, owner, personal, task, comment } = await mentioning()
  // GitHub will not take theirs down; the app edits it, signed.
  refuseOnce = (x) => (x.method === 'DELETE' ? new Response('{"message":"no"}', { status: 422 }) : null)
  sent.length = 0
  const rewritten = await api('PATCH', `/api/comments/${comment}`, owner, {
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'the owner asks ' },
            { type: 'mention', attrs: { id: bob.actorId, label: 'Bob' } },
          ],
        },
      ],
    },
  })
  assert.equal(rewritten.status, 200)
  await drain()
  const edited = comments().find((x) => x.method === 'PATCH')
  assert.ok(edited && asApp(edited), 'the app edits it')
  assert.match(String(edited.body?.body), /^\*\*Ada\*\* on Tuff:/)
  // The mentioned person unlinks: the words are unchanged since, and still not Ada's.
  await H.asTableOwner()`delete from github_person where actor_id = ${bob.actorId}`
  await touch(task, owner, 'Renamed')
  assert.ok(!sent.some((x) => x.auth === `Bearer ${personal}`), 'never with the author’s token')
  assert.equal(comments().length, 0, 'left as GitHub has it')
})

test('GitHub busy while their comment is taken down is a retry, not an edit by the app', async () => {
  const { owner, theirs, personal, task } = await linked()
  const said = await api('POST', `/api/tasks/${task}/comments`, theirs, { body: doc('mine') })
  assert.equal(said.status, 201)
  await drain()
  refuseOnce = (x) => (x.method === 'DELETE' ? new Response('{}', { status: 503 }) : null)
  sent.length = 0
  assert.equal((await api('PATCH', `/api/comments/${said.body.id}`, owner, { body: doc('words Ada never wrote') })).status, 200)
  await drain()
  const deletes = comments().filter((x) => x.method === 'DELETE')
  assert.equal(deletes.length, 2, 'refused for now, then taken down on the retry')
  assert.ok(!comments().some((x) => x.method === 'PATCH'), 'no edit by the app on their comment')
  assert.ok(!comments().some((x) => x.auth === `Bearer ${personal}`))
  assert.equal(comments().find((x) => x.method === 'POST')?.body?.body, '**Ada** on Tuff:\n\nwords Ada never wrote')
})

test('an imported comment is never written as whoever imported it', async () => {
  const { person, project, workspaceId, theirs, personal, task } = await linked()
  await H.withActor(
    person.actorId,
    (tx) => tx`
    insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, origin, said_as)
    values (${H.uuidv7()}, ${workspaceId}, ${project}, 'task', ${task}, ${person.actorId},
            ${tx.json(doc('from Linear') as never)}, 'import', 'Grace')`,
  )
  await touch(task, theirs, 'Renamed')
  const posted = comments().find((x) => x.method === 'POST')
  assert.ok(posted && asApp(posted), 'as the app')
  assert.notEqual(posted.auth, `Bearer ${personal}`)
})

test('who changed a comment last is the database’s to say, not a request’s', async () => {
  const { owner, person, theirs, task } = await linked()
  const said = await api('POST', `/api/tasks/${task}/comments`, theirs, { body: doc('mine') })
  assert.equal((await api('PATCH', `/api/comments/${said.body.id}`, owner, { body: doc('edited by the owner') })).status, 200)
  const by = async () =>
    (await H.asTableOwner()<{ changed_by: string }[]>`select changed_by from comment where id = ${said.body.id}`)[0]!.changed_by
  const ownerId = await by()
  assert.notEqual(ownerId, person.actorId)
  // The author, writing the column itself through their own policy: it stays.
  await H.withActor(person.actorId, (tx) => tx`update comment set changed_by = ${person.actorId} where id = ${said.body.id}`)
  assert.equal(await by(), ownerId)
})

test('the worker asks for a person’s token only for a workspace and project', async () => {
  const { person } = await linked()
  await assert.rejects(
    H.asWorker((tx) => tx`select * from github_person_token(${person.actorId})`),
    /permission denied/,
  )
})
