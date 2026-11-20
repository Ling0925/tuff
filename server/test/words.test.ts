import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_TEMPLATES } from '@tracker/shared-schema'
import { app } from '../src/http/routes.js'
import { outbox } from '../src/mail.js'
import { issueApiToken, registerUser } from '../src/auth/flows.js'
import { ERRORS_FR, ERRORS_FR_LIKE, frenchError } from '../src/words.js'
import { edition } from '../src/edition.js'
import { LABELS_FR, LISTS_FR, SAMPLE, SAMPLE_FR, TEMPLATES_FR } from '../src/templates.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, stamp, uuidv7, withActor } from './helpers.js'

after(async () => {
  await closeDb()
})

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '../src')
const MIGRATIONS = join(here, '../migrations')

/* ------------------------------------------------- every message, heard */

/** Every `.ts` the server answers from, the MCP layer's own aside. */
function sources(dir = SRC): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return relative(SRC, path) === 'mcp' ? [] : sources(path)
    return e.name.endsWith('.ts') ? [{ file: relative(SRC, path), text: readFileSync(path, 'utf8') }] : []
  })
}

/**
 * The expression after `message:`, up to the comma, brace or bracket that
 * ends it — read past strings and brackets, so a ternary between two
 * literals is one expression.
 */
function expressionAt(text: string, from: number): string {
  let depth = 0
  let i = from
  while (i < text.length) {
    const ch = text[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      i++
      while (i < text.length && text[i] !== ch) i += text[i] === '\\' ? 2 : 1
    } else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']' || ch === '}' || ch === ',' || ch === ';' || ch === '\n') {
      if (depth === 0) break
      if (ch === ')' || ch === ']') depth--
    }
    i++
  }
  return text.slice(from, i).trim()
}

/** The literals in an expression, a template's `${…}` given a sample value. */
function literals(expr: string): string[] {
  const found: string[] = []
  for (const m of expr.matchAll(/'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g)) {
    if (m[1] !== undefined) found.push(m[1].replace(/\\'/g, "'"))
    else found.push(m[2]!.replace(/\$\{[^}]*\}/g, '2'))
  }
  return found
}

/** The body of `function name` or `const name = (…) =>`, up to its closing line. */
function bodyOf(text: string, name: string): string | null {
  const start = text.search(new RegExp(`(?:function ${name}\\(|const ${name} = )`))
  if (start < 0) return null
  const end = text.indexOf('\n}\n', start)
  const blank = text.indexOf('\n\n', start)
  return text.slice(start, Math.min(end < 0 ? text.length : end, blank < 0 ? text.length : blank))
}

/**
 * What is said after `message:` that is not words the server writes: a
 * type, the database's own words (read from the migrations below), the
 * middleware that answers in French, a report to the operators, and a push
 * service's envelope.
 */
const NOT_WORDS = new Set(['string', '(e as Error).message', 'frenchError(message)', 'message.slice(0, 8000)', ''])

/** Everything `{ error: { message } }` can carry, as the code writes it. */
function messages(): { where: string; message: string }[] {
  const all = sources()
  const constant = (name: string): string | null => {
    for (const { text } of all) {
      const m = new RegExp(`const ${name} = '((?:\\\\.|[^'\\\\])*)'`).exec(text)
      if (m) return m[1]!.replace(/\\'/g, "'")
    }
    return null
  }
  const out: { where: string; message: string }[] = []
  for (const { file, text } of all) {
    for (const m of text.matchAll(/\bmessage:\s*/g)) {
      const expr = expressionAt(text, m.index + m[0].length)
      const where = `${file}: message: ${expr.slice(0, 60)}`
      if (NOT_WORDS.has(expr) || expr.startsWith('{')) continue
      // Literals, and a choice between literals; a call's own arguments are not.
      const bare = expr.replace(/\.\w+\([^()]*\)/g, '')
      if (/^['`]/.test(bare) || /\?\s*['`]/.test(bare)) {
        for (const message of literals(bare)) out.push({ where, message })
        continue
      }
      // A constant, written once somewhere: `AGENTS_ARE_PAID`, `NOT_YOURS`.
      if (/^[A-Z][A-Z0-9_]*$/.test(expr)) {
        const message = constant(expr)
        assert.ok(message, `${where}: no constant ${expr}`)
        out.push({ where, message })
        continue
      }
      // A refusal worked out by a function of the file's own: `denied`, `no`.
      const called = /^[a-z]\w*$/.test(expr) ? new RegExp(`const ${expr} = (\\w+)\\(`).exec(text)?.[1] : /^(\w+)\(\w*\)$/.exec(expr)?.[1]
      const body = called ? bodyOf(text, called) : null
      assert.ok(body, `${where}: not a message this test knows how to read`)
      for (const r of body.matchAll(/return\s+([A-Z][A-Z0-9_]+)\b/g)) out.push({ where, message: constant(r[1]!)! })
      for (const message of literals(body.replace(/\.\w+\([^()]*\)/g, ''))) {
        if (/^[A-Z].* /.test(message)) out.push({ where, message })
      }
    }
  }
  return out
}

/**
 * The database's own refusals that `onError` answers with as they are —
 * `raise exception '…' using errcode = 'check_violation'`. Not a word
 * like `workspace_full`, which the code that calls it catches and says
 * in its own words.
 */
function refusals(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .flatMap((f) => [...readFileSync(join(MIGRATIONS, f), 'utf8').matchAll(/raise exception '([^']+)' using errcode = 'check_violation'/g)])
    .map((m) => m[1]!)
    .filter((m) => m.includes(' '))
}

/**
 * The same in French as in English, on purpose. Empty: every message has
 * words to translate. Something like a product's name alone would go here,
 * with why.
 */
const SAME_IN_FRENCH = new Set<string>([])

test('every message an error can carry has its French', () => {
  const found = messages()
  // Enough found that the reading worked, not a list that came back empty.
  assert.ok(found.length > 100, `only ${found.length} messages found`)
  const unheard = found.filter(({ message }) => !SAME_IN_FRENCH.has(message) && frenchError(message) === message)
  assert.deepEqual(unheard, [])
  for (const message of refusals()) assert.notEqual(frenchError(message), message, `the database's "${message}"`)
  // And the template one, with a number in it as the code writes it.
  assert.equal(
    frenchError('That file is too big. Files can be up to 0.5 MB.'),
    'Ce fichier est trop volumineux. Les fichiers ne doivent pas dépasser 0,5 Mo.',
  )
})

test('the French is written to the rules of the web’s', () => {
  /* The core's, and the edition's own routes' beside them. */
  const like = [...ERRORS_FR_LIKE, ...edition.errorsFrLike]
  const french = [
    ...Object.values(ERRORS_FR),
    ...Object.values(edition.errorsFr),
    ...like.map(([, write]) => write(['', '2'] as unknown as RegExpExecArray)),
  ]
  for (const f of french) {
    assert.ok(f.endsWith('.'), `${f}: an error ends with a full stop`)
    assert.ok(!f.includes("'"), `${f}: the apostrophe is ’`)
    assert.ok(!f.includes('...'), `${f}: the ellipsis is one character`)
    assert.ok(!/ [?!;:]/.test(f), `${f}: a no-break space before ? ! ; :`)
  }
})

/* ------------------------------------------------------------ the choice */

const PASSWORD = 'correct-horse-battery-staple'
const request = (path: string, init: { method?: string; body?: unknown; token?: string; tongue?: string } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.tongue ? { 'x-tongue': init.tongue } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

async function someone(tag: string) {
  const s = stamp()
  const email = `${tag}${s}@example.com`
  const u = await registerUser({ email, password: PASSWORD, name: 'Camille', workspace_name: `${tag} ${s}` })
  return { email, ...u }
}

const languageIn = async (token: string) =>
  ((await (await request('/api/me', { token })).json()) as { actor: { language: string | null } }).actor.language

test('a person says what they read, and only they can', async () => {
  const me = await someone('lang')
  assert.equal(await languageIn(me.access_token), null)

  assert.equal((await request('/api/me', { method: 'PATCH', token: me.access_token, body: { language: 'fr' } })).status, 200)
  assert.equal(await languageIn(me.access_token), 'fr')

  // Null is "never said" again, not English.
  assert.equal((await request('/api/me', { method: 'PATCH', token: me.access_token, body: { language: null } })).status, 200)
  assert.equal(await languageIn(me.access_token), null)

  const wrong = await request('/api/me', { method: 'PATCH', token: me.access_token, body: { language: 'es' } })
  assert.equal(wrong.status, 400)
  assert.equal(await languageIn(me.access_token), null)

  // Not through a token: what somebody reads their mail in is not their agent's to say.
  const { ctx, workspaceId, token } = await makeOwner()
  const tool = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  assert.equal((await request('/api/me', { method: 'PATCH', token: tool, body: { language: 'fr' } })).status, 403)
  assert.equal(await languageIn(token), null)
})

test('an error is in the language the request asks for, and its code is not', async () => {
  const me = await someone('tongue')
  const blank = { method: 'PATCH', token: me.access_token, body: { name: '   ' } }

  const english = await request('/api/me', blank)
  assert.equal(english.status, 400)
  assert.deepEqual(((await english.json()) as { error: unknown }).error, { code: 'invalid', message: 'Enter your name.' })

  const french = await request('/api/me', { ...blank, tongue: 'fr' })
  assert.equal(french.status, 400)
  assert.deepEqual(((await french.json()) as { error: unknown }).error, { code: 'invalid', message: 'Saisissez votre nom.' })

  // Anything else is English, as nothing is.
  const other = await request('/api/me', { ...blank, tongue: 'de' })
  assert.equal(((await other.json()) as { error: { message: string } }).error.message, 'Enter your name.')
})

/* ------------------------------------------------------------------ mail */

const last = (to: string) => outbox.filter((m) => m.to === to).at(-1)

test('a mail is in the language of the account it goes to, and else the screen’s that asked', async () => {
  // Said French: a reset asked from anywhere is in French.
  const fr = await someone('reset-fr')
  await request('/api/me', { method: 'PATCH', token: fr.access_token, body: { language: 'fr' } })
  assert.equal((await request('/auth/password/forgot', { method: 'POST', body: { email: fr.email } })).status, 200)
  const mail = last(fr.email)!
  assert.equal(mail.subject, 'Choisissez un nouveau mot de passe pour Tuff')
  assert.match(mail.text, /^Quelqu’un a demandé à changer le mot de passe de votre compte Tuff\./)
  assert.match(mail.text, /\nChoisir un nouveau mot de passe : http/)
  assert.match(mail.html, /<html lang="fr">/)
  assert.match(mail.html, /Si le bouton ne fonctionne pas, ouvrez ce lien :/)

  // Never said: the screen's language decides.
  const unsaid = await someone('reset-unsaid')
  await request('/auth/password/forgot', { method: 'POST', body: { email: unsaid.email }, tongue: 'fr' })
  assert.equal(last(unsaid.email)!.subject, 'Choisissez un nouveau mot de passe pour Tuff')

  // Said English: a French screen does not outrank the account.
  const en = await someone('reset-en')
  await request('/api/me', { method: 'PATCH', token: en.access_token, body: { language: 'en' } })
  await request('/auth/password/forgot', { method: 'POST', body: { email: en.email }, tongue: 'fr' })
  assert.equal(last(en.email)!.subject, 'Set a new password for Tuff')
  assert.doesNotMatch(last(en.email)!.html, /lang=/)
})

/* ----------------------------------------------------------- the notes */

test('a note is written in the language of whoever it reaches', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  await request('/api/me', { method: 'PATCH', token, body: { language: 'fr' } })
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p], ['task.create', 'edit.any'])
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const task = async () => {
    const id = uuidv7()
    await withActor(
      ctx.actorId,
      (tx) =>
        tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key)
         values (${id}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Do it', 'a0')`,
    )
    return id
  }
  const what = (actor: string, id: string) =>
    withActor(actor, (tx) => tx<{ what: string }[]>`select what from notification where actor_id = ${actor} and object_id = ${id}`)

  // Sam gives the owner a task: the owner reads French.
  const mine = await task()
  assert.equal((await request(`/api/tasks/${mine}`, { method: 'PATCH', token: samToken, body: { assignee_id: ctx.actorId } })).status, 200)
  assert.deepEqual(
    (await what(ctx.actorId, mine)).map((n) => n.what),
    ['member vous l’a attribuée'],
  )

  // The owner gives Sam one: Sam never said, and reads English.
  const theirs = await task()
  assert.equal((await request(`/api/tasks/${theirs}`, { method: 'PATCH', token, body: { assignee_id: sam.actorId } })).status, 200)
  const told = await what(sam.actorId, theirs)
  assert.equal(told.length, 1)
  assert.match(told[0]!.what, /^Owner \w+ gave it to you$/)
})

/* --------------------------------------------------- what a project holds */

test('a project made by somebody who reads French starts in French', async () => {
  const { token } = await makeOwner()
  await request('/api/me', { method: 'PATCH', token, body: { language: 'fr' } })

  const made = await request('/api/projects', { method: 'POST', token, body: { name: 'Lancement', template: 'launch' } })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  const lists = (await (await request(`/api/projects/${id}/lists`, { token })).json()) as { lists: { name: string }[] }
  assert.deepEqual(
    lists.lists.map((l) => l.name),
    ['Backlog', 'À faire', 'En cours', 'En revue', 'Terminé', 'Annulé'],
  )

  const owner = (await (await request('/api/me', { token })).json()) as { actor: { id: string } }
  const [held] = await withActor(
    owner.actor.id,
    (tx) =>
      tx<{ labels: string[]; tasks: string[]; docs: string[] }[]>`
      select array(select name::text from label where project_id = ${id} and deleted_at is null order by name) as labels,
             array(select title from task where project_id = ${id} order by title) as tasks,
             array(select name from file where project_id = ${id}) as docs`,
  )
  assert.deepEqual(held!.labels, ['Amélioration', 'Bug', 'Fonctionnalité'])
  assert.deepEqual(
    held!.tasks,
    Object.values(TEMPLATES_FR.launch.tasks).sort((a, b) => a.localeCompare(b, 'fr')),
  )
  assert.deepEqual(held!.docs, [TEMPLATES_FR.launch.doc.name])

  // The sample too, its tasks carrying the labels they were given.
  const sample = await request('/api/projects/sample', { method: 'POST', token })
  assert.equal(sample.status, 201)
  const s = (await sample.json()) as { id: string; name: string }
  assert.equal(s.name, SAMPLE_FR.name)
  const [labelled] = await withActor(
    owner.actor.id,
    (tx) =>
      tx<{ n: number }[]>`
      select count(*)::int as n from task_label tl join task t on t.id = tl.task_id where t.project_id = ${s.id}`,
  )
  assert.equal(labelled!.n, SAMPLE_FR.tasks.filter((t) => t.label).length)

  // And somebody who never said starts in English, as before.
  const en = await makeOwner()
  const plain = await request('/api/projects', { method: 'POST', token: en.token, body: { name: 'Launch' } })
  const plainLists = (await (
    await request(`/api/projects/${((await plain.json()) as { id: string }).id}/lists`, { token: en.token })
  ).json()) as {
    lists: { name: string }[]
  }
  assert.deepEqual(
    plainLists.lists.map((l) => l.name),
    ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled'],
  )
})

test('the French for what a project starts with is all there', () => {
  assert.deepEqual(Object.keys(LISTS_FR).sort(), ['Backlog', 'Canceled', 'Done', 'In Progress', 'In Review', 'Todo'])
  assert.deepEqual(Object.keys(LABELS_FR).sort(), ['Bug', 'Feature', 'Improvement'])
  for (const [key, plan] of Object.entries(PROJECT_TEMPLATES)) {
    const fr = TEMPLATES_FR[key as keyof typeof TEMPLATES_FR]
    assert.deepEqual(Object.keys(fr.tasks).sort(), plan.tasks.map((t) => t.title).sort(), key)
    assert.equal(fr.doc.body.length, plan.doc.body.length, key)
  }
  // The sample in the same states: the same lists, labels, dates and parts.
  const shape = (s: typeof SAMPLE) =>
    s.tasks.map((t) => [t.list, t.label, t.priority, t.dueIn, t.doneDaysAgo, t.parts?.map((x) => Boolean(x.done))])
  assert.deepEqual(shape(SAMPLE_FR), shape(SAMPLE))
  // And every task the chat and the comments name is one it has.
  const titles = new Set(SAMPLE_FR.tasks.map((t) => t.title))
  for (const named of [...SAMPLE_FR.chat.map((m) => m.task), ...SAMPLE_FR.comments.map((c) => c.task)]) {
    if (named) assert.ok(titles.has(named), named)
  }
})

test('a browser’s first language is read by its weight, not its order', async () => {
  const { firstLanguage } = await import('../src/words.js')
  assert.equal(firstLanguage('fr-FR,fr;q=0.9,en;q=0.8'), 'fr')
  assert.equal(firstLanguage('en-US,en;q=0.9,fr;q=0.8'), 'en')
  assert.equal(firstLanguage('en;q=0.5, fr-CA'), 'fr')
  assert.equal(firstLanguage('*'), '')
  assert.equal(firstLanguage(''), '')
})
