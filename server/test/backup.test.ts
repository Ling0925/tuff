import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import {
  BackupFailed,
  backupSettings,
  cleanOldBackups,
  dumpConnection,
  migrateWithBackup,
  isMountPoint,
  pgTool,
  readDumpName,
  type BackupSettings,
  type DumpTool,
} from '../src/backup.js'
import { migrate, outsideATransaction } from '../src/db/migrate.js'
import { edition } from '../src/edition.js'
import { edition as community } from '../src/edition.js'

/*
 * A backup before every migration, on your own server.
 *
 * On a database of its own, made here and dropped at the end, migrated
 * from a folder of this test's own small migrations, so "pending" is
 * whatever the test says it is. Its first migration makes the one column
 * pair of the settings row this reads — the version that last served, and
 * when — so a test can say "a start served here". The dump is handed in:
 * a stand-in that writes what `pg_dump` writes first, one that fails, one
 * that writes nothing. The real `pg_dump` is the image's, and the real run
 * in the spec is where it was tried against a real server.
 */

const shared = process.env.DATABASE_URL!
const admin = postgres(shared, { max: 1, onnotice: () => {} })
const DB = `tracker_backup_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const url = (() => {
  const u = new URL(shared)
  u.pathname = `/${DB}`
  return u.href
})()
const files = mkdtempSync(join(tmpdir(), 'tuff-migrations-'))
const dumps = mkdtempSync(join(tmpdir(), 'tuff-backups-'))
const db = postgres(url, { max: 1, onnotice: () => {} })
after(async () => {
  await db.end()
  await admin.unsafe(`drop database if exists ${DB} with (force)`)
  await admin.end()
  rmSync(files, { recursive: true, force: true })
  rmSync(dumps, { recursive: true, force: true })
})
await admin.unsafe(`create database ${DB}`)

/* The community edition's facts, without its step after migrating, which
   needs the real schema: these migrations make small tables. */
const own = { ...community, backups: true, instance: false, migrated: async () => {} }
const settings = (over: Partial<BackupSettings> = {}): BackupSettings => ({
  dir: dumps,
  retentionDays: 30,
  skip: false,
  ...over,
})

/** A stand-in `pg_dump` that writes a dump's first bytes, says what mode the file had when it began, and counts. */
function tool(write: (file: string) => void = (f) => writeFileSync(f, 'PGDMP\u0001rest of a dump'), major = 99) {
  const asked: string[] = []
  const modes: number[] = []
  const t: DumpTool = {
    dump: async ({ file }) => {
      asked.push(file)
      modes.push(statSync(file).mode & 0o777)
      write(file)
    },
    major: async () => major,
  }
  return { asked, modes, t }
}
const quietly = async <T>(f: () => Promise<T>): Promise<{ r: T | Error; lines: string[] }> => {
  const lines: string[] = []
  const [log, error] = [console.log, console.error]
  console.log = (...a: unknown[]) => void lines.push(a.join(' '))
  console.error = (...a: unknown[]) => void lines.push(a.join(' '))
  try {
    return { r: await f().catch((e: Error) => e), lines }
  } finally {
    console.log = log
    console.error = error
  }
}

let n = 0
/** Another migration waiting: a table of its own, or the SQL given. */
function pending(body?: string): string {
  n++
  const name = `${String(n).padStart(3, '0')}_t${n}.sql`
  writeFileSync(join(files, name), body ?? `create table t${n} (id int);`)
  return name
}
/** A start served here, a minute ago, as `version`. */
const served = (version: string) => db`update instance_setting set ran_version = ${version}, ran_at = now() - interval '1 minute'`
const applied = async () => (await db<{ name: string }[]>`select name from schema_migration order by name`).map((r) => r.name)
const there = async (table: string) => (await db<{ ok: boolean }[]>`select to_regclass(${table}) is not null as ok`)[0]!.ok
/** The folder, but each dump's note of the container that took it. */
const inDumps = () =>
  readdirSync(dumps)
    .filter((f) => !f.endsWith('.host'))
    .sort()
/*
 * The test's folder is a volume unless a test says otherwise. Left to the
 * real check it is whatever the machine's temp folder is: on a Mac nothing
 * is known and the dump went ahead, on Linux — CI — `/tmp` shares `/`'s
 * device, every dump was refused as "not a volume", and nine tests failed
 * there and nowhere else.
 */
const onVolume = async () => true
const go = (t: DumpTool, over: Partial<BackupSettings> = {}, mounted: () => Promise<boolean | null> = onVolume) =>
  migrateWithBackup(url, own, { settings: settings(over), tool: t, dir: files, mounted })

writeFileSync(
  join(files, '000_settings.sql'),
  'create table instance_setting (id boolean primary key default true, ran_version text, ran_at timestamptz); insert into instance_setting default values;',
)

test('a new database is migrated with no backup: there is nothing to keep', async () => {
  pending()
  const d = tool()
  const r = await go(d.t)
  assert.deepEqual(r.applied, ['000_settings.sql', '001_t1.sql'])
  assert.equal(r.backup, null)
  assert.equal(r.noBackup, null)
  assert.equal(d.asked.length, 0)
  assert.deepEqual(inDumps(), [])
})

test('a pending migration is backed up first, named by the version before and its newest migration, the owner’s alone from the first byte', async () => {
  await served('1.0.0')
  pending()
  const d = tool()
  let tableAtDump: boolean | null = null
  const watching: DumpTool = {
    ...d.t,
    dump: async (a) => {
      tableAtDump = await there('t2')
      await d.t.dump(a)
    },
  }
  const r = await go(watching)
  assert.deepEqual(r.applied, ['002_t2.sql'])
  assert.equal(tableAtDump, false, 'dumped before anything was applied')
  assert.equal(d.asked.length, 1)
  assert.ok(d.asked[0]!.endsWith('.partial'), 'written beside the final name')
  assert.deepEqual(d.modes, [0o600], 'made 0600 before pg_dump wrote a byte')
  assert.match(r.backup!, /\/tuff-1\.0\.0-m1-\d{8}-\d{6}\.dump$/)
  assert.deepEqual(inDumps(), [r.backup!.split('/').at(-1)])
  assert.equal(statSync(r.backup!).mode & 0o777, 0o600)
  assert.equal(statSync(dumps).mode & 0o777, 0o700, 'the folder too')
  assert.equal(await there('t2'), true)
  const named = readDumpName(r.backup!.split('/').at(-1)!)!
  assert.equal(named.from, '1.0.0')
  assert.equal(named.head, 1)
})

test('nothing pending, nothing dumped', async () => {
  const before = inDumps()
  const d = tool()
  const r = await go(d.t)
  assert.deepEqual(r.applied, [])
  assert.equal(r.backup, null)
  assert.equal(d.asked.length, 0)
  assert.deepEqual(inDumps(), before)
})

test('a dump that fails, or comes out empty, stops the migration with nothing applied and no file left', async () => {
  await served('1.1.0')
  const name = pending()
  const before = inDumps()
  const failing: DumpTool = {
    ...tool().t,
    dump: async ({ file }) => {
      writeFileSync(file, 'PGDMP half')
      throw new Error('pg_dump: error: could not write to output file: No space left on device')
    },
  }
  const { r, lines } = await quietly(() => go(failing))
  assert.ok(r instanceof BackupFailed)
  assert.equal(await there(`t${n}`), false, 'not applied')
  assert.equal((await applied()).includes(name), false)
  assert.deepEqual(inDumps(), before, 'no half-written dump left, under any name')
  const said = lines.join('\n')
  assert.match(said, /NO MIGRATION WAS APPLIED/)
  assert.match(said, /No space left on device/)
  assert.match(said, /SKIP_PRE_MIGRATION_BACKUP=1/, 'and how to skip it, deliberately')

  for (const write of [() => {}, (f: string) => writeFileSync(f, ''), (f: string) => writeFileSync(f, 'not a dump')]) {
    const d = tool(write)
    const again = await quietly(() => go(d.t))
    assert.ok(again.r instanceof BackupFailed)
    assert.equal(d.asked.length, 1)
    assert.equal(await there(`t${n}`), false)
    assert.deepEqual(inDumps(), before)
  }
  /* And once it works, the same migration goes. */
  const ok = await quietly(() => go(tool().t))
  assert.deepEqual((ok.r as { applied: string[] }).applied, [name])
})

test('a migration that fails is retried without another dump: one backup per update, the database left as it holds', async () => {
  await served('1.2.0')
  const good = pending()
  const bad = pending('select 1 / 0;')
  const first = tool()
  const one = await quietly(() => go(first.t))
  assert.ok(one.r instanceof Error && /division by zero/.test(one.r.message), 'the migration fails')
  assert.equal(first.asked.length, 1, 'the first start dumps')
  const dumped = inDumps().filter((f) => f.startsWith('tuff-1.2.0-'))
  assert.equal(dumped.length, 1)
  assert.equal(await there(`t${n - 1}`), false, 'one transaction: the good one before it is not applied either')
  assert.equal((await applied()).includes(good), false)

  /* The restart policy starts it again, and again. */
  for (let i = 0; i < 3; i++) {
    const again = tool()
    const r = await quietly(() => go(again.t))
    assert.ok(r.r instanceof Error)
    assert.equal(again.asked.length, 0, 'no second dump')
    assert.match(r.lines.join('\n'), /already holds the database from before this update/)
  }
  assert.deepEqual(
    inDumps().filter((f) => f.startsWith('tuff-1.2.0-')),
    dumped,
  )

  /* Fixed: it migrates, and the backup it names is the one from before. */
  writeFileSync(join(files, bad), 'select 1;')
  const fixed = tool()
  const done = await quietly(() => go(fixed.t))
  const r = done.r as Awaited<ReturnType<typeof go>>
  assert.deepEqual(r.applied, [good, bad])
  assert.equal(fixed.asked.length, 0)
  assert.equal(r.backup, join(dumps, dumped[0]!))
})

test('one transaction per file when a migration needs it, and a retry still uses the first backup', async () => {
  await served('1.3.0')
  await db`create type mood as enum ('calm')`
  const adds = pending(`alter type mood add value 'busy';`)
  const bad = pending('select 1 / 0;')
  const first = tool()
  const one = await quietly(() => go(first.t))
  assert.ok(one.r instanceof Error)
  assert.equal(first.asked.length, 1)
  assert.equal((await applied()).includes(adds), true, 'one at a time: the first went in')
  const dumped = inDumps().filter((f) => f.startsWith('tuff-1.3.0-'))
  assert.equal(dumped.length, 1)
  /* Its newest migration moved on, and the backup from before it still stands in. */
  const again = tool()
  const r = await quietly(() => go(again.t))
  assert.ok(r.r instanceof Error)
  assert.equal(again.asked.length, 0)
  assert.match(r.lines.join('\n'), new RegExp(dumped[0]!.replace(/\./g, '\\.')))
  writeFileSync(join(files, bad), 'select 1;')
  const fixed = await quietly(() => go(tool().t))
  assert.equal((fixed.r as { backup: string }).backup, join(dumps, dumped[0]!))
})

test('a start that served after the backup makes it stale: the next update takes its own', async () => {
  await served('1.4.0')
  pending()
  const first = tool()
  const a = await quietly(() => go(first.t))
  assert.equal(first.asked.length, 1)
  const backupA = (a.r as { backup: string }).backup
  /* The same version served again — a rollback, a week of work — then the update once more. */
  await db`update instance_setting set ran_at = now() + interval '1 second'`
  pending()
  const second = tool()
  const b = await quietly(() => go(second.t))
  assert.equal(second.asked.length, 1, 'a dump of its own: the old one predates what was served since')
  assert.notEqual((b.r as { backup: string }).backup, backupA)
})

test('SKIP_PRE_MIGRATION_BACKUP migrates with no dump, and says so', async () => {
  const name = pending()
  const before = inDumps()
  const d = tool()
  const { r } = await quietly(() => go(d.t, { skip: true }))
  assert.deepEqual((r as { applied: string[] }).applied, [name])
  assert.equal((r as { backup: null }).backup, null)
  assert.equal((r as { noBackup: string }).noBackup, 'skipped')
  assert.equal(d.asked.length, 0)
  assert.deepEqual(inDumps(), before)

  assert.equal(backupSettings({ SKIP_PRE_MIGRATION_BACKUP: '1' }).skip, true)
  assert.equal(backupSettings({ SKIP_PRE_MIGRATION_BACKUP: 'yes' }).skip, true)
  assert.equal(backupSettings({ SKIP_PRE_MIGRATION_BACKUP: '' }).skip, false)
  assert.equal(backupSettings({ SKIP_PRE_MIGRATION_BACKUP: '0' }).skip, false)
  assert.equal(backupSettings({}).skip, false)
})

test('with no BACKUP_DIR — a checkout, CI — nothing is dumped', async () => {
  const name = pending()
  const d = tool()
  const { r } = await quietly(() => go(d.t, { dir: null }))
  assert.deepEqual((r as { applied: string[] }).applied, [name])
  assert.equal((r as { noBackup: string }).noBackup, 'no_folder')
  assert.equal(d.asked.length, 0)
  assert.equal(backupSettings({}).dir, null)
  assert.equal(backupSettings({ BACKUP_DIR: '/backups' }).dir, '/backups')
})

test('a folder that is not a volume gets no dump — it would go with the container — and the start goes on, saying why', async () => {
  await served('1.5.0')
  const name = pending()
  const before = inDumps()
  const d = tool()
  const { r, lines } = await quietly(() => go(d.t, {}, async () => false))
  assert.deepEqual((r as { applied: string[] }).applied, [name])
  assert.equal((r as { noBackup: string }).noBackup, 'not_a_volume')
  assert.equal(d.asked.length, 0)
  assert.deepEqual(inDumps(), before)
  assert.match(lines.join('\n'), /isn't a volume/)
  /* Where it cannot be told (not Linux), the dump goes ahead. */
  pending()
  const unknown = tool()
  await quietly(() => go(unknown.t, {}, async () => null))
  assert.equal(unknown.asked.length, 1)
})

test('a Postgres newer than pg_dump is not backed up, and does not block the update', async () => {
  await served('1.6.0')
  const name = pending()
  const d = tool(undefined, 10)
  const { r, lines } = await quietly(() => go(d.t))
  assert.deepEqual((r as { applied: string[] }).applied, [name])
  assert.equal((r as { noBackup: string }).noBackup, 'postgres_newer')
  assert.equal(d.asked.length, 0)
  assert.match(lines.join('\n'), /pg_dump is 10/)
})

test('two starts at once: one migrates and dumps, the other waits and finds nothing pending', async () => {
  await served('1.7.0')
  const name = pending()
  const d = tool()
  const slow: DumpTool = {
    ...d.t,
    dump: async (a) => {
      await new Promise((r) => setTimeout(r, 300))
      await d.t.dump(a)
    },
  }
  const both = await quietly(() => Promise.all([go(slow), go(slow)]))
  const [a, b] = both.r as Awaited<ReturnType<typeof go>>[]
  assert.deepEqual([...a!.applied, ...b!.applied], [name])
  assert.equal(d.asked.length, 1)
})

test('retention deletes this server’s dumps past their days but never the newest two, a killed dump’s leftovers, and nothing else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tuff-retention-'))
  try {
    const now = Date.now()
    const day = 86_400_000
    const make = (name: string, age: number) => {
      writeFileSync(join(dir, name), 'PGDMP')
      const at = new Date(now - age)
      utimesSync(join(dir, name), at, at)
    }
    make('tuff-1.0.0-m280-20260101-101500.dump', 300 * day)
    make('tuff-1.1.0-m290-20260601-101500.dump', 150 * day)
    make('tuff-1.2.0-m301-20261001-101500.dump', 40 * day)
    make('tuff-1.3.0-m302-20261110-101500.dump', 35 * day)
    make('tuff-1.3.0-m303-20261120-090000.dump.partial', 2 * 3_600_000)
    make('tuff-1.3.0-m303-20261120-101400.dump.partial', 60_000)
    make('mine.dump', 400 * day)
    make('tuff-notes.txt', 400 * day)
    /* A link with a dump's name is somebody's, not this server's. */
    symlinkSync(join(dir, 'mine.dump'), join(dir, 'tuff-0.9.0-m270-20250101-000000.dump'))
    const gone = await cleanOldBackups(dir, 30, now)
    assert.deepEqual(gone.sort(), [
      'tuff-1.0.0-m280-20260101-101500.dump',
      'tuff-1.1.0-m290-20260601-101500.dump',
      'tuff-1.3.0-m303-20261120-090000.dump.partial',
    ])
    assert.deepEqual(readdirSync(dir).sort(), [
      'mine.dump',
      'tuff-0.9.0-m270-20250101-000000.dump',
      'tuff-1.2.0-m301-20261001-101500.dump',
      'tuff-1.3.0-m302-20261110-101500.dump',
      'tuff-1.3.0-m303-20261120-101400.dump.partial',
      'tuff-notes.txt',
    ])
    /* However short the days, the newest two stay. */
    assert.deepEqual(await cleanOldBackups(dir, 1, now), [])
    make('tuff-1.4.0-m304-20261120-100000.dump', 60_000)
    assert.deepEqual(await cleanOldBackups(dir, 1, now), ['tuff-1.2.0-m301-20261001-101500.dump'])
    /* A folder that is not there is nothing to clean. */
    assert.deepEqual(await cleanOldBackups(join(dir, 'nowhere'), 30, now), [])
    unlinkSync(join(dir, 'tuff-0.9.0-m270-20250101-000000.dump'))

    /* A migrating start cleans, whether or not anything is pending. */
    make('tuff-1.0.0-m100-20260101-000000.dump', 90 * day)
    await quietly(() => go(tool().t, { dir }))
    assert.equal(readdirSync(dir).includes('tuff-1.0.0-m100-20260101-000000.dump'), false)

    assert.equal(backupSettings({}).retentionDays, 30)
    assert.equal(backupSettings({ BACKUP_RETENTION_DAYS: '7' }).retentionDays, 7)
    assert.equal(backupSettings({ BACKUP_RETENTION_DAYS: '' }).retentionDays, 30)
    assert.equal(backupSettings({ BACKUP_RETENTION_DAYS: 'a week' }).retentionDays, 30)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('in one transaction, a deferred check left by one file is settled before the next, and a later file still defers its own', async () => {
  /* `file.held_by` since migration 287: a table that points at itself, deferred. */
  await db`create table held (id int primary key, held_by int references held (id) deferrable initially deferred)`
  await db`insert into held values (1, null), (2, 1), (3, null)`
  /* What a commit between files used to hide: the delete leaves a check pending, and the table can't be altered under it. */
  await assert.rejects(
    db.begin(async (tx) => {
      await tx`delete from held where id = 3`
      await tx`alter table held add column probe text`
    }),
    /pending trigger events/,
  )
  await served('1.9.0')
  const a = pending('delete from held where id = 3;')
  const b = pending('alter table held add column note text;')
  const c = pending('insert into held (id, held_by) values (10, 11); insert into held (id, held_by) values (11, null);')
  const { r } = await quietly(() => go(tool().t))
  assert.deepEqual((r as { applied: string[] }).applied, [a, b, c], 'one transaction, all three in')
  assert.equal((await db<{ n: number }[]>`select count(*)::int as n from held`)[0]!.n, 4)
  /* A file left with a broken reference is still refused at the end, as a commit would refuse it. */
  await served('1.9.1')
  pending('insert into held (id, held_by) values (20, 99);')
  const broken = await quietly(() => go(tool().t))
  assert.ok(broken.r instanceof Error && /foreign key/.test(broken.r.message))
  writeFileSync(join(files, `${String(n).padStart(3, '0')}_t${n}.sql`), 'select 1;')
  await quietly(() => go(tool().t))
})

test('the service migrates one file at a time, and never in one transaction', async () => {
  const service = { ...edition, backups: false, instance: false, migrated: async () => {} }
  const good = pending()
  const bad = pending('select 1 / 0;')
  const { r } = await quietly(() =>
    migrateWithBackup(url, service, { settings: settings(), tool: tool().t, dir: files, mounted: onVolume }),
  )
  assert.ok(r instanceof Error)
  assert.equal((await applied()).includes(good), true, 'the one before went in on its own')
  assert.equal((await applied()).includes(bad), false)
  writeFileSync(join(files, bad), 'select 1;')
  await quietly(() => migrateWithBackup(url, service, { settings: settings(), tool: tool().t, dir: files, mounted: onVolume }))
})

test('a migrator waits for another one saying so, gives up in the end, and no statement waits on a lock past ten seconds', async () => {
  const other = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await other`select pg_advisory_lock(7295000295)`
    pending()
    const d = tool()
    const { r, lines } = await quietly(() =>
      migrateWithBackup(url, own, { settings: settings(), tool: d.t, dir: files, mounted: onVolume, lockWait: 1_500 }),
    )
    assert.ok(r instanceof Error && /giving up/.test(r.message))
    assert.match(lines.join('\n'), /Waiting for another migrator/)
    assert.equal(d.asked.length, 0, 'nothing done without the lock')
    await other`select pg_advisory_unlock(7295000295)`
    /* Free again: the same pending file goes, and its connection waits ten seconds at most for a lock. */
    let timeout = ''
    const probe = await quietly(() =>
      migrate(url, undefined, {
        dir: files,
        before: async (p) => {
          timeout = (await p.sql<{ t: string }[]>`select current_setting('lock_timeout') as t`)[0]!.t
        },
      }),
    )
    assert.equal((probe.r as string[]).length, 1)
    assert.equal(timeout, '10s')
  } finally {
    await other.end()
  }
})

test('with the last serving start unknown, only a dump this same container took stands in', async () => {
  await db`update instance_setting set ran_version = '2.0.0', ran_at = null`
  const good = pending()
  const bad = pending('select 1 / 0;')
  const first = tool()
  await quietly(() =>
    migrateWithBackup(url, own, { settings: settings(), tool: first.t, dir: files, mounted: onVolume, host: 'container-a' }),
  )
  assert.equal(first.asked.length, 1)
  const dumped = inDumps().filter((f) => f.startsWith('tuff-2.0.0-') && f.endsWith('.dump'))
  assert.equal(dumped.length, 1)
  assert.deepEqual(
    readdirSync(dumps).filter((f) => f.startsWith('tuff-2.0.0-') && f.endsWith('.host')),
    [`${dumped[0]}.host`],
  )
  /* Restarted: the same container. */
  const again = tool()
  await quietly(() =>
    migrateWithBackup(url, own, { settings: settings(), tool: again.t, dir: files, mounted: onVolume, host: 'container-a' }),
  )
  assert.equal(again.asked.length, 0)
  /* Made again — the old version ran in between, then the update once more: a dump of its own. */
  const other = tool()
  await new Promise((r) => setTimeout(r, 1_100))
  await quietly(() =>
    migrateWithBackup(url, own, { settings: settings(), tool: other.t, dir: files, mounted: onVolume, host: 'container-b' }),
  )
  assert.equal(other.asked.length, 1)
  writeFileSync(join(files, bad), 'select 1;')
  const fixed = await quietly(() =>
    migrateWithBackup(url, own, { settings: settings(), tool: tool().t, dir: files, mounted: onVolume, host: 'container-b' }),
  )
  assert.deepEqual((fixed.r as { applied: string[] }).applied, [good, bad])
  await served('2.0.0')
})

test('a dump’s note of its container goes when the dump does, and only then', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tuff-sidecar-'))
  try {
    const now = Date.now()
    const make = (name: string, days: number) => {
      writeFileSync(join(dir, name), 'PGDMP')
      const at = new Date(now - days * 86_400_000)
      utimesSync(join(dir, name), at, at)
    }
    for (const [name, days] of [
      ['tuff-1.0.0-m1-20260101-000000.dump', 300],
      ['tuff-1.1.0-m2-20261101-000000.dump', 20],
      ['tuff-1.2.0-m3-20261110-000000.dump', 10],
    ] as const) {
      make(name, days)
      make(`${name}.host`, days)
    }
    make('tuff-0.9.0-m1-20250101-000000.dump.host', 400)
    await cleanOldBackups(dir, 30, now)
    assert.deepEqual(readdirSync(dir).sort(), [
      'tuff-1.1.0-m2-20261101-000000.dump',
      'tuff-1.1.0-m2-20261101-000000.dump.host',
      'tuff-1.2.0-m3-20261110-000000.dump',
      'tuff-1.2.0-m3-20261110-000000.dump.host',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a volume is told by its device, so a folder inside one counts; off Linux nothing is known', async () => {
  if (process.platform === 'linux') {
    assert.equal(await isMountPoint('/'), false)
    assert.equal(await isMountPoint('/nowhere-at-all'), false)
  } else {
    assert.equal(await isMountPoint(dumps), null)
  }
})

test('the service never dumps, with migrations pending and a folder to dump into', async () => {
  /* Where this tree has the service's edition, it is the one that says so. */
  if (!edition.instance) assert.equal(edition.backups, false)
  assert.equal(community.backups, true)
  const service = { ...edition, backups: false, instance: false, migrated: async () => {} }
  await served('1.8.0')
  const name = pending()
  const old = join(dumps, 'tuff-0.9.0-m1-20250101-000000.dump')
  writeFileSync(old, 'PGDMP')
  utimesSync(old, new Date(2025, 0, 1), new Date(2025, 0, 1))
  const before = inDumps()
  const d = tool()
  const { r } = await quietly(() =>
    migrateWithBackup(url, service, { settings: settings(), tool: d.t, dir: files, mounted: async () => true }),
  )
  assert.deepEqual((r as { applied: string[] }).applied, [name])
  assert.equal((r as { backup: null }).backup, null)
  assert.equal(d.asked.length, 0)
  assert.deepEqual(inDumps(), before, 'nothing written, and nothing cleared either')
})

test('only what cannot share a transaction splits a run, read from the code and not its comments', () => {
  assert.equal(outsideATransaction('create table a (id int);'), false)
  assert.equal(outsideATransaction('/* built not `concurrently` */ create index a_i on a (id);'), false)
  assert.equal(outsideATransaction('-- add value would be wrong here\ncreate table b (id int);'), false)
  assert.equal(outsideATransaction('create index concurrently a_i on a (id);'), true)
  assert.equal(outsideATransaction("alter type mood add value 'busy';"), true)
  assert.equal(outsideATransaction('vacuum analyze a;'), true)
})

test('pg_dump is given every part of the connection but the password, which goes in its environment', async () => {
  const c = dumpConnection('postgres://someone:hunter2%40secret@[::1]:5433/tracker?sslmode=verify-full&sslrootcert=/etc/ca.pem')
  assert.equal(c.env.PGPASSWORD, 'hunter2@secret')
  assert.equal(c.dbname.includes('hunter2'), false)
  assert.equal(c.dbname, 'postgres://someone@[::1]:5433/tracker?sslmode=verify-full&sslrootcert=/etc/ca.pem')

  const dir = mkdtempSync(join(tmpdir(), 'tuff-pgdump-'))
  try {
    const err = await pgTool.dump({ url: 'postgres://someone:hunter2secret@127.0.0.1:1/nothing', file: join(dir, 'x.dump') }).then(
      () => null,
      (e: Error) => e,
    )
    assert.ok(err, 'no server on port 1: refused')
    assert.equal(err.message.includes('hunter2secret'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
