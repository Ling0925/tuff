import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type postgres from 'postgres'
import { migrate, type Pending } from './db/migrate.js'
import type { Edition } from './editionShape.js'
import { wholeFromEnv } from './env.js'
import { running } from './updates.js'

/*
 * A backup before every migration, on your own server.
 *
 * The migrating start dumps the database with `pg_dump --format=custom`
 * into `BACKUP_DIR` (`/backups` in the image, the `db-backups` volume in
 * compose) before it applies anything, and only when something is
 * pending. One dump per update: a start that fails after it and is started
 * again uses the same dump rather than taking another. A dump that fails
 * or comes out empty, into a folder that is really a volume, stops the
 * start with nothing applied. Where a dump could not be kept or could not
 * be made — no volume there, a Postgres newer than the image's `pg_dump`
 * — the start says so and migrates without one, and so does the notice.
 * `SKIP_PRE_MIGRATION_BACKUP=1` skips it for somebody with backups of
 * their own. Old dumps go after `BACKUP_RETENTION_DAYS`, the newest two
 * never.
 *
 * The service never dumps: its edition says `backups: false`, and Railway
 * keeps its backups.
 */

/** What the environment says about backups. */
export type BackupSettings = {
  /** Where dumps go; null — a checkout, CI — takes none. */
  dir: string | null
  retentionDays: number
  skip: boolean
}

export function backupSettings(e: NodeJS.ProcessEnv = process.env): BackupSettings {
  const dir = (e.BACKUP_DIR ?? '').trim()
  return {
    dir: dir || null,
    retentionDays: wholeFromEnv(e.BACKUP_RETENTION_DAYS, 30),
    skip: ['1', 'true', 'yes', 'on'].includes((e.SKIP_PRE_MIGRATION_BACKUP ?? '').trim().toLowerCase()),
  }
}

/** Why migrations ran with no backup — `update_no_backup`, `ServerUpdate.no_backup`. */
export type NoBackup = 'skipped' | 'no_folder' | 'not_a_volume' | 'postgres_newer'

/** What the backup step came to: a dump's path, or why there is none. */
export type Took = { backup: string | null; noBackup: NoBackup | null }

/**
 * A dump this server wrote: the version that served before it (or
 * `unknown`), the newest migration applied when it was taken, and when,
 * in UTC — `tuff-1.2.0-m301-20261120-101500.dump`.
 */
const DUMP = /^tuff-([A-Za-z0-9.]{1,40})-m(\d{1,6})-(\d{8})-(\d{6})\.dump$/
const PARTIAL = /^tuff-[A-Za-z0-9.]{1,40}-m\d{1,6}-\d{8}-\d{6}\.dump\.partial$/

export function readDumpName(name: string): { from: string; head: number; at: Date } | null {
  const m = DUMP.exec(name)
  if (!m) return null
  const [d, t] = [m[3]!, m[4]!]
  const at = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}Z`)
  return Number.isNaN(at.getTime()) ? null : { from: m[1]!, head: Number(m[2]), at }
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/**
 * Dumps older than `days` deleted — never the newest `keep`, whatever
 * their age, so a server that has not updated in months still has the
 * backup from before its last update — and what a killed dump left behind
 * once it is an hour old. Only plain files with the names this server
 * writes: a link, a folder or anything somebody else keeps there is left
 * alone. Returns what went.
 */
export async function cleanOldBackups(dir: string, days: number, now = Date.now(), keep = 2): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const dumps: { name: string; mtime: number }[] = []
  const gone: string[] = []
  for (const name of names) {
    const dump = DUMP.test(name)
    if (!dump && !PARTIAL.test(name)) continue
    const s = await lstat(join(dir, name)).catch(() => null)
    if (!s?.isFile()) continue
    if (dump) dumps.push({ name, mtime: s.mtimeMs })
    else if (now - s.mtimeMs > 3_600_000) {
      await rm(join(dir, name), { force: true })
      gone.push(name)
    }
  }
  dumps.sort((a, b) => b.mtime - a.mtime)
  for (const d of dumps.slice(keep)) {
    if (now - d.mtime > days * 86_400_000) {
      await rm(join(dir, d.name), { force: true })
      gone.push(d.name)
    }
  }
  /* A dump's note of the container that took it goes with it. */
  const left = new Set(dumps.map((d) => d.name).filter((n) => !gone.includes(n)))
  for (const name of names) {
    if (!HOST.test(name) || left.has(name.slice(0, -HOST_SUFFIX.length))) continue
    const s = await lstat(join(dir, name)).catch(() => null)
    if (s?.isFile()) await rm(join(dir, name), { force: true })
  }
  return gone
}

/**
 * Beside each dump, the host name of the container that took it
 * (`<dump>.host`) — which a restart keeps and a new container does not.
 */
const HOST_SUFFIX = '.host'
const HOST = /^tuff-[A-Za-z0-9.]{1,40}-m\d{1,6}-\d{8}-\d{6}\.dump\.host$/

/** Writes a custom-format dump of the database at `url` to `file`, or throws with what went wrong. */
export type Dumper = (a: { url: string; file: string }) => Promise<void>
/** `pg_dump` and the major version it is, or null when it cannot say. */
export type DumpTool = { dump: Dumper; major: () => Promise<number | null> }

function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (b: Buffer) => {
      if (out.length < 4000) out += b.toString('utf8')
    })
    child.stderr.on('data', (b: Buffer) => {
      if (err.length < 4000) err += b.toString('utf8')
    })
    child.on('error', (e: NodeJS.ErrnoException) => reject(new Error(e.code === 'ENOENT' ? 'pg_dump is not installed here' : e.message)))
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

/**
 * The connection as `pg_dump` takes it: the URL itself, every libpq
 * parameter in it (`sslmode`, `sslrootcert`, …) and an IPv6 host as
 * written, with only the password taken out and given in the
 * environment — never in a process list or an error.
 */
export function dumpConnection(url: string): { dbname: string; env: NodeJS.ProcessEnv } {
  const u = new URL(url)
  const password = decodeURIComponent(u.password)
  u.password = ''
  return { dbname: u.href, env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) } }
}

/** `pg_dump`, as the image carries it (Alpine's `postgresql17-client`). */
export const pgTool: DumpTool = {
  dump: async ({ url, file }) => {
    const c = dumpConnection(url)
    const r = await run(['--format=custom', '--no-password', `--file=${file}`, `--dbname=${c.dbname}`], c.env)
    if (r.code !== 0) throw new Error(r.err.trim() || `pg_dump exited with ${r.code}`)
  },
  major: async () => {
    const r = await run(['--version'], process.env).catch(() => null)
    const m = r?.out.match(/(\d+)(?:\.\d+)?/)
    return m ? Number(m[1]) : null
  },
}

/**
 * Whether `dir` is on a volume, which outlives the container: on another
 * device than the container's own `/`. A folder inside a volume counts, as
 * a mount point alone would not. False for a folder that is not there yet
 * (it would be made on the container's own disk). Null off Linux — a
 * developer's machine — where nothing is known and the dump goes ahead.
 */
export type Mounted = (dir: string) => Promise<boolean | null>
export const isMountPoint: Mounted = async (dir) => {
  if (process.platform !== 'linux') return null
  const [here, root] = await Promise.all([stat(dir).catch(() => null), stat('/').catch(() => null)])
  if (!root) return null
  return Boolean(here && here.dev !== root.dev)
}

/** A backup that could not be taken into a folder that holds one: nothing was applied. Already logged. */
export class BackupFailed extends Error {}

/** What the last serving start left: the version (or `unknown`) and when. */
async function lastServed(p: Pending): Promise<{ from: string; at: Date | null }> {
  try {
    const [r] = await p.sql<{ v: string | null; at: Date | null }[]>`
      select ran_version as v, ran_at as at from instance_setting where id`
    return { from: r?.v ?? 'unknown', at: r?.at ?? null }
  } catch {
    /* No columns yet: this is the update that adds them. */
    return { from: 'unknown', at: null }
  }
}

async function wholeDump(file: string): Promise<boolean> {
  const s = await lstat(file).catch(() => null)
  return Boolean(s?.isFile() && s.size >= 5 && (await head(file).catch(() => '')) === 'PGDMP')
}

/**
 * The dump this update took already, when a start before this one took it
 * and then failed: the same version served before it, no newer migration
 * than now was applied when it was taken, and it was taken after the last
 * serving start — so nothing has been served since and the database is
 * still what it holds, give or take the migrations that failed. The oldest
 * such, which is the database as it was before the update began.
 *
 * When the last serving start is not known (a database from before 302
 * kept it), a version from before this could have served since without
 * saying so. Then only a dump from the last hour, and only one this very
 * container took (`<dump>.host`): a restart keeps the container, while
 * going back to the old version and updating again makes a new one.
 */
async function thisUpdatesDump(dir: string, from: string, headNow: number, served: Date | null, now: Date, host: string) {
  const since = served ?? new Date(now.getTime() - 3_600_000)
  const names = await readdir(dir).catch(() => [] as string[])
  const mine = names
    .map((name) => ({ name, d: readDumpName(name) }))
    .filter((x) => x.d && x.d.from === from && x.d.head <= headNow && x.d.at.getTime() > since.getTime())
    .sort((a, b) => a.d!.at.getTime() - b.d!.at.getTime())
  for (const x of mine) {
    const file = join(dir, x.name)
    if (!served && (await readFile(`${file}${HOST_SUFFIX}`, 'utf8').catch(() => '')).trim() !== host) continue
    if (await wholeDump(file)) return file
  }
  return null
}

/**
 * The backup itself, once something is pending: nothing on a new database;
 * the reason with the skip, no folder, a folder that is not a volume, or a
 * Postgres newer than `pg_dump`; this update's dump when a failed start
 * took it already; else a whole dump or a `BackupFailed`. Never a file at
 * the final name that is not a whole dump: it is written beside, made
 * `0600` before a byte goes in, checked — `pg_dump` said 0, and the file
 * starts with Postgres's own `PGDMP` — and only then renamed.
 */
export async function backupBeforeMigrating(
  p: Pending,
  o: {
    url: string
    settings: BackupSettings
    tool?: DumpTool | undefined
    mounted?: Mounted | undefined
    now?: Date
    /** This container's host name — a test's to say. */
    host?: string | undefined
  },
): Promise<Took> {
  const n = p.pending.length
  const s = o.settings
  const tool = o.tool ?? pgTool
  const none = (noBackup: NoBackup, why: string): Took => {
    console.log(`[backup] ${why}: applying ${n} migration(s) with no backup taken first.`)
    return { backup: null, noBackup }
  }
  if (!p.done.length) {
    console.log('[backup] A new database: nothing to back up before migrating.')
    return { backup: null, noBackup: null }
  }
  if (s.skip) return none('skipped', 'SKIP_PRE_MIGRATION_BACKUP is set')
  if (!s.dir) return none('no_folder', "BACKUP_DIR isn't set")
  if ((await (o.mounted ?? isMountPoint)(s.dir)) === false) {
    return none(
      'not_a_volume',
      `${s.dir} isn't a volume, so a backup there would be lost with the container. Mount one there (the db-backups volume in docker-compose.prod.yml), or set SKIP_PRE_MIGRATION_BACKUP=1 to say you have backups of your own`,
    )
  }
  const [server] = await p.sql<{ n: number }[]>`select current_setting('server_version_num')::int as n`
  const serverMajor = Math.floor((server?.n ?? 0) / 10_000)
  const toolMajor = await tool.major()
  if (toolMajor && serverMajor > toolMajor) {
    return none(
      'postgres_newer',
      `The database runs Postgres ${serverMajor}, and this image's pg_dump is ${toolMajor}, which can't back it up. Back it up with a pg_dump of ${serverMajor}`,
    )
  }

  const { from, at: served } = await lastServed(p)
  const headNow = Number(p.done.at(-1)?.match(/^(\d+)/)?.[1] ?? 0)
  const now = o.now ?? new Date()
  const host = o.host ?? hostname()
  const already = await thisUpdatesDump(s.dir, from, headNow, served, now, host)
  if (already) {
    console.log(`[backup] ${already} already holds the database from before this update: no new backup taken.`)
    return { backup: already, noBackup: null }
  }

  const file = join(s.dir, `tuff-${from}-m${headNow}-${stamp(now)}.dump`)
  const partial = `${file}.partial`
  try {
    await mkdir(s.dir, { recursive: true, mode: 0o700 })
    await chmod(s.dir, 0o700).catch(() => {})
    await rm(partial, { force: true })
    await (await open(partial, 'wx', 0o600)).close()
    console.log(`[backup] Backing up the database to ${file} before applying ${n} migration(s)…`)
    await tool.dump({ url: o.url, file: partial })
    await chmod(partial, 0o600)
    if (!(await wholeDump(partial))) throw new Error('the dump came out empty')
    const size = (await lstat(partial)).size
    await writeFile(`${file}${HOST_SUFFIX}`, `${host}\n`, { mode: 0o600 })
    await rename(partial, file)
    console.log(`[backup] Backed up the database to ${file} (${megabytes(size)}).`)
    return { backup: file, noBackup: null }
  } catch (e) {
    await rm(partial, { force: true }).catch(() => {})
    await rm(`${file}${HOST_SUFFIX}`, { force: true }).catch(() => {})
    const said = (e instanceof Error ? e.message : String(e)).trim()
    console.error(
      [
        "[backup] COULDN'T BACK UP THE DATABASE BEFORE MIGRATING, SO NO MIGRATION WAS APPLIED AND TUFF DIDN'T START.",
        `[backup] Writing ${file}: ${said}`,
        `[backup] Fix that, then run docker compose up -d. A full disk needs space; a folder the app can't write to needs: docker compose run --rm --no-deps -u root app sh -c 'chown node:node ${s.dir} && chmod 700 ${s.dir}'`,
        '[backup] The database is as it was, so going back to the version you ran before (TUFF_VERSION in .env) is safe too.',
        '[backup] To migrate without a backup, only if you have one of your own: set SKIP_PRE_MIGRATION_BACKUP=1 in .env, then docker compose up -d.',
      ].join('\n'),
    )
    throw new BackupFailed(`backup before migrating failed: ${said}`)
  }
}

async function head(file: string): Promise<string> {
  const f = await open(file, 'r')
  try {
    const b = Buffer.alloc(5)
    const { bytesRead } = await f.read(b, 0, 5, 0)
    return b.subarray(0, bytesRead).toString('latin1')
  } finally {
    await f.close()
  }
}

const megabytes = (n: number) => (n < 1_048_576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1_048_576).toFixed(1)} MB`)

/**
 * Migrating, the way a start does it: the edition's step after, and on an
 * edition that keeps backups the clear-out and the backup before. On your
 * own server the owners are told what happened (`instance_migrated`) —
 * after the edition's step, which marks the database a server of one's
 * own. `version` is what this build is; `tool`, `mounted` and `dir` are a
 * test's.
 */
export async function migrateWithBackup(
  url: string,
  edition: Edition,
  o: {
    settings?: BackupSettings
    tool?: DumpTool
    mounted?: Mounted
    dir?: string
    version?: string
    host?: string
    lockWait?: number
  } = {},
): Promise<{ applied: string[] } & Took> {
  const settings = o.settings ?? backupSettings()
  const keeps = edition.backups
  if (keeps && settings.dir) {
    const gone = await cleanOldBackups(settings.dir, settings.retentionDays).catch((e: unknown) => {
      console.error(`[backup] Couldn't clear old backups in ${settings.dir}:`, e instanceof Error ? e.message : e)
      return []
    })
    if (gone.length) console.log(`[backup] Deleted ${gone.length} backup(s) older than ${settings.retentionDays} days.`)
  }
  let took: Took = { backup: null, noBackup: null }
  let told = false
  let count = 0
  const applied = await migrate(
    url,
    async (sql) => {
      await edition.migrated(sql)
      if (!edition.instance || !told) return
      const version = o.version ?? running.version
      try {
        await sql`select instance_migrated(${version}, ${took.backup}, ${took.noBackup}, ${count})`
      } catch (e) {
        console.error('[backup] Migrated, but could not note it for Server settings:', e instanceof Error ? e.message : e)
      }
    },
    {
      dir: o.dir,
      lockWait: o.lockWait,
      /* One transaction for the batch only where a backup stands behind
         it: your own server. The service migrates file by file. */
      whole: keeps,
      before: async (p) => {
        count = p.pending.length
        /* A new database is an install, not an update: nobody to tell. */
        told = p.done.length > 0
        if (keeps) took = await backupBeforeMigrating(p, { url, settings, tool: o.tool, mounted: o.mounted, host: o.host })
      },
    },
  )
  return { applied, ...took }
}

/**
 * Every serving start on your own server: the version it runs, and when,
 * remembered — and when the version changed with nothing to migrate, the
 * owners told all the same (`instance_ran`). Never stops a start.
 */
export async function noteVersion(sql: postgres.Sql, edition: Edition, version: string): Promise<void> {
  if (!edition.instance) return
  try {
    await sql`select instance_ran(${version})`
  } catch (e) {
    console.error('[backup] Could not note the version for Server settings:', e instanceof Error ? e.message : e)
  }
}
