import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * Mail through the team's own SMTP server.
 *
 * A fake SMTP server on a local port, speaking just enough of the protocol
 * to take a letter, stands where the team's would. Nothing here leaves the
 * machine. Each test file is a process of its own, so `SMTP_URL` is set
 * here before `env.ts` is read, and Resend is taken out of the way — with
 * both, the service's edition would send through Resend.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

type Got = { from: string; to: string[]; data: string }

function fakeSmtp(opts: { auth?: boolean } = {}) {
  const got: Got[] = []
  const auth: string[] = []
  let connections = 0
  const server: Server = createServer((sock) => {
    connections++
    let buf = ''
    let inData = false
    let cur: Got = { from: '', to: [], data: '' }
    const say = (l: string) => sock.write(`${l}\r\n`)
    sock.on('error', () => {})
    say('220 fake ESMTP')
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n')
          if (end < 0) return
          cur.data = buf.slice(0, end)
          buf = buf.slice(end + 5)
          inData = false
          got.push(cur)
          cur = { from: '', to: [], data: '' }
          say('250 2.0.0 queued')
          continue
        }
        const i = buf.indexOf('\r\n')
        if (i < 0) return
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const verb = line.slice(0, 4).toUpperCase()
        if (verb === 'EHLO') {
          say('250-fake')
          if (opts.auth) say('250-AUTH PLAIN LOGIN')
          say('250 8BITMIME')
        } else if (verb === 'HELO') say('250 fake')
        else if (verb === 'MAIL') {
          cur.from = line
          say('250 ok')
        } else if (verb === 'RCPT') {
          if (/refused/.test(line)) say(`550 5.1.1 ${line.slice(8)} no such mailbox`)
          else {
            cur.to.push(line)
            say('250 ok')
          }
        } else if (verb === 'DATA') {
          inData = true
          say('354 go on')
        } else if (verb === 'RSET' || verb === 'NOOP') say('250 ok')
        else if (verb === 'AUTH') {
          auth.push(line)
          say('535 no')
        } else if (verb === 'QUIT') {
          say('221 bye')
          sock.end()
        } else say('502 not here')
      }
    })
  })
  return new Promise<{ port: number; got: Got[]; auth: string[]; connections: () => number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({ port, got, auth, connections: () => connections, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}

/** The letter's headers, unfolded, as `[name, value]`. */
function headersOf(data: string): [string, string][] {
  const head = data.split('\r\n\r\n')[0]!.replace(/\r\n[ \t]+/g, ' ')
  return head.split('\r\n').map((l) => {
    const i = l.indexOf(':')
    return [l.slice(0, i).toLowerCase(), l.slice(i + 1).trim()]
  })
}

const plain = await fakeSmtp()
const withAuth = await fakeSmtp({ auth: true })
after(async () => {
  await plain.close()
  await withAuth.close()
})

delete process.env.RESEND_API_KEY
process.env.SMTP_URL = `smtp://127.0.0.1:${plain.port}`
process.env.MAIL_FROM = 'Tuff <tuff@example.com>'
const { env, readSmtp, readMailFrom } = await import('../src/env.js')
const { send, senderFor, senderAddress, mailSender, mailConfigured, smtpOptions, nearbyHost, personName, fromPerson, SMTP_TIMEOUTS } =
  await import('../src/mail.js')
const { edition } = await import('../src/edition.js')
/* The tests run the service's edition, which never reads SMTP_URL; mail
   through SMTP is your own server's, so this file says it is one. */
const serviceMail = edition.mail
;(edition as { mail: string }).mail = 'smtp'
after(() => {
  ;(edition as { mail: string }).mail = serviceMail
})

test('a letter goes out through SMTP with the right To, From and Subject', async () => {
  assert.equal(mailSender(), 'smtp')
  const before = plain.got.length
  const ok = await send({ to: 'reader@example.com', subject: 'Your sign-in code', text: 'hello', html: '<p>hello</p>' })
  assert.equal(ok, true)
  const letter = plain.got[before]!
  assert.equal(letter.from, 'MAIL FROM:<tuff@example.com>')
  assert.deepEqual(letter.to, ['RCPT TO:<reader@example.com>'])
  const h = headersOf(letter.data)
  assert.deepEqual(
    h.filter(([k]) => k === 'to'),
    [['to', 'reader@example.com']],
  )
  assert.deepEqual(
    h.filter(([k]) => k === 'from'),
    [['from', 'Tuff <tuff@example.com>']],
  )
  assert.deepEqual(
    h.filter(([k]) => k === 'subject'),
    [['subject', 'Your sign-in code']],
  )
})

test('a line break in a name or a subject starts no header of its own', async () => {
  const before = plain.got.length
  const ok = await send({
    to: 'reader@example.com',
    subject: 'Hello\r\nBcc: victim@example.com',
    fromName: 'Ana\r\nBcc: victim@example.com\n"x" <evil@example.com>',
    replyTo: 'ana@example.com',
    headers: { 'List-Unsubscribe': '<https://example.com/u>\r\nBcc: victim@example.com' },
    text: 'hello',
    html: '<p>hello</p>',
  })
  assert.equal(ok, true)
  const letter = plain.got[before]!
  assert.deepEqual(letter.to, ['RCPT TO:<reader@example.com>'], 'one recipient, the one Tuff named')
  const h = headersOf(letter.data)
  assert.equal(h.filter(([k]) => k === 'bcc').length, 0)
  assert.equal(h.filter(([k]) => k === 'cc').length, 0)
  const subject = h.filter(([k]) => k === 'subject')
  assert.deepEqual(subject, [['subject', 'Hello Bcc: victim@example.com']])
  const from = h.filter(([k]) => k === 'from')
  assert.equal(from.length, 1)
  assert.match(from[0]![1], /^"Ana Bcc: victim example\.com x evil example\.com via Tuff" <tuff@example\.com>$/)
  assert.deepEqual(
    h.filter(([k]) => k === 'reply-to'),
    [['reply-to', 'ana@example.com']],
  )
  assert.deepEqual(
    h.filter(([k]) => k === 'list-unsubscribe'),
    [['list-unsubscribe', '<https://example.com/u> Bcc: victim@example.com']],
  )
})

test('an address that is not a plain one is never handed to nodemailer', async () => {
  const before = plain.connections()
  for (const to of [
    'Name <reader@example.com>',
    'a@example.com, b@example.com',
    'a@example.com\r\nBcc: b@example.com',
    '"a"@example.com',
    'a\u0000b@example.com',
    'a\u0001@example.com',
    'a\u007f@example.com',
    'a\tb@example.com',
  ]) {
    assert.equal(await send({ to, subject: 's', text: 't', html: 'h' }), false, to)
  }
  assert.equal(await send({ to: 'reader@example.com', replyTo: 'x <y@example.com>', subject: 's', text: 't', html: 'h' }), false)
  assert.equal(plain.connections(), before, 'nothing was sent')
})

test('a password never crosses in the clear, and never reaches the log', async () => {
  const url = `smtp://tuff%40example.com:s3cret-Pass%2Fword@127.0.0.1:${withAuth.port}`
  const said: string[] = []
  const was = console.error
  console.error = (...a: unknown[]) => void said.push(a.map(String).join(' '))
  const smtpWas = env.smtp
  try {
    ;(env as { smtp: unknown }).smtp = readSmtp(url, 'tuff@example.com')
    const ok = await send({ to: 'reader@example.com', subject: 's', text: 't', html: 'h' })
    assert.equal(ok, false, 'no STARTTLS offered, and a password to send: refused')
  } finally {
    console.error = was
    ;(env as { smtp: unknown }).smtp = smtpWas
  }
  assert.deepEqual(withAuth.auth, [], 'AUTH was never sent over a plain connection')
  assert.equal(withAuth.got.length, 0)
  assert.ok(said.length > 0)
  for (const line of said) {
    assert.doesNotMatch(line, /s3cret/)
    assert.doesNotMatch(line, /Pass%2Fword/)
  }
})

test('SMTP_URL is smtp: or smtps:, and nothing else starts', () => {
  for (const bad of [
    'http://u:s3cret@smtp.example.com',
    'sendmail://localhost',
    'file:///usr/sbin/sendmail',
    'direct://x',
    'javascript:alert(1)',
    'smtp.example.com:587',
    'not a url',
  ]) {
    assert.throws(
      () => readSmtp(bad, 'tuff@example.com'),
      (e: Error) => {
        assert.match(e.message, /SMTP_URL/)
        assert.doesNotMatch(e.message, /s3cret/)
        return true
      },
      bad,
    )
  }
  /* Options in the query are nodemailer's — `?sendmail=true` would make it a shell command. */
  assert.throws(() => readSmtp('smtp://smtp.example.com:587?sendmail=true', 'tuff@example.com'), /no path or options/)
  assert.throws(() => readSmtp('smtps://smtp.example.com/path', 'tuff@example.com'), /no path or options/)
  assert.equal(readSmtp('', 'x'), null)
  assert.equal(readSmtp(undefined, undefined), null)
  assert.deepEqual(readSmtp('smtps://u:p@smtp.example.com', 'Tuff <tuff@example.com>'), {
    url: 'smtps://u:p@smtp.example.com',
    from: { name: 'Tuff', address: 'tuff@example.com' },
  })
})

test('the server refuses to start on a URL that is not SMTP, and does not repeat it', () => {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', `await import(${JSON.stringify(join(src, 'env.ts'))})`],
    {
      env: { ...process.env, SMTP_URL: 'https://admin:hunter2-secret@mail.example.com', MAIL_FROM: 'tuff@example.com' },
      encoding: 'utf8',
    },
  )
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /SMTP_URL must start with smtp:\/\/ or smtps:\/\//)
  assert.doesNotMatch(r.stderr + r.stdout, /hunter2/)
})

test('MAIL_FROM is said, and is one address', () => {
  assert.throws(() => readSmtp('smtp://smtp.example.com', undefined), /MAIL_FROM is not set/)
  assert.throws(() => readSmtp('smtp://smtp.example.com', '  '), /MAIL_FROM is not set/)
  for (const bad of ['Tuff', 'a@b.c, d@e.f', 'Tuff\r\nBcc: x@y.z <a@b.c>', 'T"u"ff <a@b.c>', '<a@b.c>>', 'a@b.c\nx', 'Tu<ff <a@b.c>']) {
    assert.equal(readMailFrom(bad), null, bad)
    assert.throws(() => readSmtp('smtp://smtp.example.com', bad), /MAIL_FROM is not an address/, bad)
  }
  assert.deepEqual(readMailFrom('tuff@example.com'), { name: '', address: 'tuff@example.com' })
  assert.deepEqual(readMailFrom('"Tuff, Inc" <tuff@example.com>'), { name: 'Tuff, Inc', address: 'tuff@example.com' })
  assert.deepEqual(readMailFrom('Tuff <hello@usetuff.com>'), { name: 'Tuff', address: 'hello@usetuff.com' })
})

test('which way mail goes', () => {
  assert.equal(senderFor(false, false, 'resend'), null)
  assert.equal(senderFor(false, false, 'smtp'), null)
  assert.equal(senderFor(true, false, 'smtp'), 'resend', 'your own server with only a key: Resend')
  assert.equal(senderFor(true, true, 'smtp'), 'smtp', 'your own server: its SMTP')
  assert.equal(senderFor(true, false, 'resend'), 'resend')
  assert.equal(senderFor(true, true, 'resend'), 'resend', 'the service: Resend, whatever else is set')
  assert.equal(senderFor(false, true, 'resend'), null, 'the service never sends through SMTP, even with no key')
})

/*
 * Who letters are from with no MAIL_FROM: the service's own address on the
 * service, and on your own server — which has none of the service's —
 * nobody, so a server that sends mail stops at start until it is told.
 */
test('MAIL_FROM falls back to the service’s address only on the service', () => {
  assert.equal(senderAddress('Ops <ops@example.com>', 'Tuff <hello@usetuff.com>', true), 'Ops <ops@example.com>')
  assert.equal(senderAddress('', 'Tuff <hello@usetuff.com>', true), 'Tuff <hello@usetuff.com>')
  assert.equal(senderAddress('Ops <ops@example.com>', null, true), 'Ops <ops@example.com>')
  assert.throws(() => senderAddress('', null, true), /MAIL_FROM is not set/)
  assert.equal(senderAddress('', null, false), '', 'no mail, nothing to be from')
})

test('the service ignores SMTP_URL altogether', async () => {
  ;(edition as { mail: string }).mail = 'resend'
  try {
    assert.equal(mailSender(), null)
    assert.equal(mailConfigured(), false)
    const before = plain.connections()
    /* Not production: the letter goes to the log, as with no mail at all. */
    const was = console.log
    console.log = () => {}
    try {
      assert.equal(await send({ to: 'reader@example.com', subject: 's', text: 't', html: 'h' }), true)
    } finally {
      console.log = was
    }
    assert.equal(plain.connections(), before, 'nothing reached the SMTP server')
  } finally {
    ;(edition as { mail: string }).mail = 'smtp'
  }
})

test('the transport: TLS as the scheme says, timeouts, and no other way out', () => {
  const s = smtpOptions('smtps://u%40x.com:p%3Aw@smtp.example.com')
  assert.equal(s.secure, true)
  assert.equal(s.port, 465)
  assert.equal(s.requireTLS, false)
  assert.deepEqual(s.auth, { user: 'u@x.com', pass: 'p:w' })
  const t = smtpOptions('smtp://u:p@smtp.example.com')
  assert.equal(t.secure, false)
  assert.equal(t.port, 587)
  assert.equal(t.requireTLS, true, 'a password demands STARTTLS')
  const relay = smtpOptions('smtp://relay:25')
  assert.equal(relay.requireTLS, false)
  assert.equal(relay.port, 25)
  assert.equal('auth' in relay, false)
  for (const [k, v] of Object.entries(SMTP_TIMEOUTS)) {
    assert.equal((s as Record<string, unknown>)[k], v)
    assert.ok(v > 0 && v <= 30_000, k)
  }
  for (const o of [s, t, relay]) {
    for (const k of ['url', 'sendmail', 'streamTransport', 'jsonTransport', 'SES', 'pool', 'dkim', 'service'])
      assert.equal(k in o, false, k)
  }
})

test('STARTTLS is demanded but from a relay nearby with no password', () => {
  for (const h of [
    '127.0.0.1',
    '127.8.9.1',
    'localhost',
    '[::1]',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    'postfix',
    'mail-relay',
  ])
    assert.equal(nearbyHost(h), true, h)
  for (const h of [
    'smtp.example.com',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '8.8.8.8',
    '11.0.0.1',
    '[2001:db8::1]',
    '[::ffff:7f00:1]',
    'postfix.',
  ])
    assert.equal(nearbyHost(h), false, h)
  assert.equal(smtpOptions('smtp://smtp.example.com').requireTLS, true, 'no password, out on the internet: STARTTLS or nothing')
  assert.equal(smtpOptions('smtp://smtp.example.com:25').requireTLS, true)
  assert.equal(smtpOptions('smtp://8.8.8.8:25').requireTLS, true)
  assert.equal(smtpOptions('smtp://postfix:25').requireTLS, false, 'a Docker service')
  assert.equal(smtpOptions('smtp://192.168.1.20:25').requireTLS, false)
  assert.equal(smtpOptions('smtp://u:p@postfix:25').requireTLS, true, 'a password, even nearby')
  assert.equal(smtpOptions('smtps://smtp.example.com').requireTLS, false, 'TLS from the first byte already')
})

test('a caller adds only a digest’s way out, never who a letter is to or from', async () => {
  const before = plain.got.length
  const ok = await send({
    to: 'reader@example.com',
    subject: 's',
    text: 't',
    html: 'h',
    headers: {
      'List-Unsubscribe': '<https://example.com/u>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      Bcc: 'victim@example.com',
      Cc: 'victim@example.com',
      To: 'victim@example.com',
      From: 'boss@example.com',
      'Reply-To': 'victim@example.com',
      Sender: 'boss@example.com',
      'X-Other': 'x',
    },
  })
  assert.equal(ok, true)
  const letter = plain.got[before]!
  assert.deepEqual(letter.to, ['RCPT TO:<reader@example.com>'])
  const h = headersOf(letter.data)
  assert.doesNotMatch(letter.data, /victim|boss/)
  assert.deepEqual(
    h.filter(([k]) => k === 'to'),
    [['to', 'reader@example.com']],
  )
  assert.deepEqual(
    h.filter(([k]) => k === 'from'),
    [['from', 'Tuff <tuff@example.com>']],
  )
  assert.equal(h.filter(([k]) => k === 'x-other').length, 0)
  assert.deepEqual(
    h.filter(([k]) => k.startsWith('list-')),
    [
      ['list-unsubscribe', '<https://example.com/u>'],
      ['list-unsubscribe-post', 'List-Unsubscribe=One-Click'],
    ],
  )
})

test('an encoded word in a name is not left for the mail client to decode', async () => {
  const sly = '=?utf-8?q?Your_Bank?= Ana'
  assert.doesNotMatch(personName(sly), /=\?/)
  assert.doesNotMatch(personName('==??x=?=?'), /=\?/)
  assert.doesNotMatch(fromPerson(sly, 'Tuff <tuff@example.com>'), /=\?/, 'Resend’s From too')
  const before = plain.got.length
  assert.equal(await send({ to: 'reader@example.com', fromName: sly, subject: 's', text: 't', html: 'h' }), true)
  const from = headersOf(plain.got[before]!.data).find(([k]) => k === 'from')![1]
  assert.doesNotMatch(from, /=\?utf-8\?q\?Your/i)
  assert.match(from, /via Tuff/)
})

test('a refused recipient is logged by its code, not its address', async () => {
  const said: string[] = []
  const was = console.error
  console.error = (...a: unknown[]) => void said.push(a.map(String).join(' '))
  try {
    assert.equal(await send({ to: 'refused-reader@example.com', subject: 's', text: 't', html: 'h' }), false)
  } finally {
    console.error = was
  }
  assert.ok(said.length > 0)
  for (const line of said) assert.doesNotMatch(line, /refused-reader|example\.com/)
  assert.match(said.join('\n'), /SMTP did not send: [A-Z]+/)
})

/*
 * Whether nodemailer was loaded at all, asked of a fresh process: a hook
 * on resolving modules notes every specifier, and the process says whether
 * `nodemailer` was among them after a letter was sent.
 */
async function loadsNodemailer(smtpUrl: string | undefined, mail: 'resend' | 'smtp'): Promise<boolean> {
  const script = `
    import { registerHooks } from 'node:module'
    let seen = false
    registerHooks({ resolve(spec, ctx, next) { if (spec === 'nodemailer' || spec.includes('/nodemailer/')) seen = true; return next(spec, ctx) } })
    const { edition } = await import(${JSON.stringify(join(src, 'edition.ts'))})
    edition.mail = ${JSON.stringify(mail)}
    const { send } = await import(${JSON.stringify(join(src, 'mail.ts'))})
    await send({ to: 'reader@example.com', subject: 's', text: 't', html: 'h' })
    console.log('NODEMAILER=' + seen)
    process.exit(0)
  `
  const childEnv: NodeJS.ProcessEnv = { ...process.env, MAIL_FROM: 'tuff@example.com' }
  delete childEnv.RESEND_API_KEY
  delete childEnv.SMTP_URL
  if (smtpUrl) childEnv.SMTP_URL = smtpUrl
  const r = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { env: childEnv })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('close', () => resolve({ stdout, stderr }))
  })
  const said = /NODEMAILER=(true|false)/.exec(r.stdout)
  assert.ok(said, `the child said nothing: ${r.stderr.slice(0, 2000)}`)
  return said[1] === 'true'
}

/* The four children side by side: each is seconds of tsx starting, and
   one after the other they were the slowest test in the suite. */
test('without SMTP_URL, or on the service, nothing loads nodemailer', async () => {
  const [none, noneOnService, onService, own] = await Promise.all([
    loadsNodemailer(undefined, 'smtp'),
    loadsNodemailer(undefined, 'resend'),
    loadsNodemailer(`smtp://127.0.0.1:${plain.port}`, 'resend'),
    loadsNodemailer(`smtp://127.0.0.1:${plain.port}`, 'smtp'),
  ])
  assert.equal(none, false)
  assert.equal(noneOnService, false)
  assert.equal(onService, false, 'the service, with SMTP_URL set by mistake')
  /* And the hook does see it, when there is something to see. */
  assert.equal(own, true)
})
