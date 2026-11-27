import type postgres from 'postgres'
import type { Edition } from './editionShape.js'
import { env } from './env.js'
import { createHash } from 'node:crypto'
import { mailOn, savedMail } from './mail.js'
import { freshPushKey, sayAppKey } from './pushKey.js'
import { releaseCheck } from './updates.js'
import { sayDatabaseRights } from './db/rights.js'

/* The value of the schema's plan column that holds a workspace to nothing:
   no ceiling on people, and no rule that reads it refuses anything. */
const UNLIMITED = 'unlimited'

/* How the machine names an owner — `instanceOwner.ts`. The image has no
   pnpm, so a Docker install is told its own way too. */
const nameOwner = (email: string) =>
  `pnpm --filter @tracker/server instance:owner ${email} ` +
  `(with Docker: docker compose -f docker-compose.prod.yml exec app node --conditions=compiled server/dist/instanceOwner.js ${email})`

/*
 * The database told it is a server of one's own, which turns its rules on.
 * The first time, on a database that already
 * has accounts and was never claimed, its oldest confirmed account is named
 * owner (only the one at `OWNER_EMAIL`, when it is set). A claimed server
 * with no owner who can sign in names nobody: it is said here, loudly,
 * with the way back. As the table owner: no request can reach this.
 *
 * Only the start that serves writes `OWNER_EMAIL` into the database
 * (`writeOwner`, migration 209): migrating — the migrate command among
 * the ways — leaves what is there, so running it from a shell without the
 * variable does not clear it.
 */
async function startInstance(sql: postgres.Sql, writeOwner: boolean): Promise<void> {
  const [r] = await sql<{ said: { named?: string; email?: string; ownerless?: boolean; owner_dropped?: boolean } }[]>`
    select instance_started(${env.ownerEmail}::citext, ${writeOwner}) as said`
  if (r?.said.named) console.log(`[instance] ${r.said.email ?? r.said.named}, the oldest account, owns this server now`)
  if (r?.said.ownerless) {
    console.error(
      '[instance] THIS SERVER HAS NO OWNER WHO CAN SIGN IN. Nobody can open sign-up or name an owner from the app. ' +
        `Name one from the command line: ${nameOwner('<email>')}`,
    )
  }
  if (r?.said.owner_dropped && !env.setupToken) {
    console.error(
      '[instance] OWNER_EMAIL WAS SET AND IS EMPTY NOW, AND NOBODY OWNS THIS SERVER YET. ' +
        'The first person to sign up and confirm an address will own it. Put OWNER_EMAIL back in .env and restart if that is not what you want.',
    )
  }
  /* The setup link's token, by its hash, told to the database by the start
     that serves — and taken away when the variable is — so the database
     itself can say whether a setup request carries it. Read here, so a
     token too short to be one stops the start. */
  if (writeOwner) {
    const token = env.setupToken
    await sql`select instance_setup_armed(${token ? createHash('sha256').update(token, 'utf8').digest('hex') : null})`
  }
}

/*
 * A fresh server says how it is claimed. With no mail, the first sign-up's
 * link would go nowhere — production never writes it to the log — so the
 * machine does it. No link and nothing secret: the person who reads this
 * holds the machine, and the command confirms the address it names.
 * With mail and no `OWNER_EMAIL`,
 * whoever confirms an address first owns it, and that is said too.
 */
async function sayHowToClaim(sql: postgres.Sql): Promise<void> {
  const [s] = await sql<{ unclaimed: boolean }[]>`select claimed_at is null as unclaimed from instance_setting where id`
  if (!s?.unclaimed) return
  const named = env.ownerEmail
  /* The setup link, on every start while nobody owns the server: whoever
     reads this log holds the machine, and the link stops working the moment
     there is an owner. */
  const token = env.setupToken
  if (token) {
    const base = env.appUrl || 'https://<this server’s address>'
    console.log(
      `[instance] Nobody owns this server yet. Open this link to set it up and create the owner's account: ${base}/setup?token=${token}` +
        (named ? ` (as ${named})` : ''),
    )
    return
  }
  if (!(await mailOn())) {
    console.log(
      `[instance] No mail is set up. Sign up${named ? ` as ${named}` : ''}, then run ${nameOwner(named ?? 'you@example.com')} to become this server's owner.`,
    )
  } else if (named) {
    console.log(
      `[instance] Nobody owns this server yet. Sign up as ${named} and confirm the address to own it; nobody else can sign up until then.`,
    )
  } else {
    console.log(
      '[instance] Nobody owns this server yet, and OWNER_EMAIL is empty: the first person to sign up and confirm an address will own it. Set SETUP_TOKEN (openssl rand -hex 32) and restart for a setup link, or set OWNER_EMAIL to your address.',
    )
  }
}

/*
 * Every workspace holds as many people, bytes and agents as it likes. The
 * schema is the service's too, and some of its rules still read the column
 * the service keeps a plan in — who may join, whether an agent may — so
 * every workspace here is put on the one that holds nothing back, and
 * nothing here ever moves it. A server that ran before this had its first
 * workspaces made on the database's default; they are moved once, at the
 * next start, and the update is a no-op every start after. As the table
 * owner: no request can reach this.
 */
async function nothingHeldBack(sql: postgres.Sql): Promise<void> {
  const moved = await sql`update workspace set plan = ${UNLIMITED} where plan is distinct from ${UNLIMITED}`
  if (moved.count > 0) console.log(`[instance] ${moved.count} workspace(s) hold as many people and files as they like now`)
}

/*
 * Tuff on your own server.
 *
 * The mirror copies this file over `edition.ts`, and the tree it copies has
 * no `cloud/` folder: nothing to mount, nobody to pay, no operators, no
 * plans. Nothing holds a workspace back (`ceilings: null`), `can()` is
 * never told a plan, and no answer names one.
 */
export const edition: Edition = {
  plans: false,
  /* Nothing is held back: as many people, bytes and agents as the owner likes. */
  ceilings: null,
  /* Never: every workspace here is unlimited, and the product's name at the
     foot of a shared page is how the open-source project is found. */
  brands: false,
  /* None: a server of one's own already has an address of its own. */
  hosts: null,
  errorsFr: {},
  errorsFrLike: [],
  operators: false,
  /* The first account owns the server and sign-up is closed after it. */
  instance: true,
  /* A dump into `BACKUP_DIR` before anything pending is migrated —
     `backup.ts`. */
  backups: true,
  /* A server nobody watches the log of does not start without its
     isolation — `rlsGuard.ts`. */
  rlsFailClosed: true,
  newWorkspacePlan: UNLIMITED,
  /* A team's own SMTP server, when it has one, before anybody's Resend. */
  mail: 'smtp',
  /* Nobody's names but the owner's: letters say to ask them, `MAIL_FROM`
     and `VAPID_SUBJECT` are the server's own, and no Apple app is claimed. */
  vendor: null,

  headers() {},
  early() {},
  open() {},
  openApi: () => false,
  api() {},
  outside() {},
  sockets() {},
  site() {},
  starting() {},
  watchErrors() {},
  /* After migrating, and again before serving on every start — a schema
     migrated some other way still has its rules turned on. */
  migrated: (sql) => startInstance(sql, false),
  ready: async (sql) => {
    /* The database's own rights, which no dump restored without
       `--create` brings back — `db/rights.ts`. */
    await sayDatabaseRights(sql)
    await nothingHeldBack(sql)
    await startInstance(sql, true)
    /* The mail saved in Server settings, read before the first page asks. */
    await savedMail().catch(() => null)
    /* The push key this server keeps when its environment has none, made
       on the first start and read on every one after — `pushKey.ts`. After
       `startInstance`, which tells the database it is a server of one's own. */
    await freshPushKey()
    /* And which public key it signs with, for the worker to compare its own against. */
    await sayAppKey(sql)
    await sayHowToClaim(sql)
  },
  /* Nothing counted, nothing kept, nothing sent: whoever runs it can read
     their own database. */
  used() {},
  usedFlush: async () => {},
  /* Nobody pays and nobody runs the deployment but its owners. */
  cancelSubscriptions: async () => null,
  operatorRefusal: null,
  planMail: null,
  /* Whether a newer release is out, once a day, unless `UPDATE_CHECK=off`
     — `updates.ts`. The service never asks. */
  jobs: () => [releaseCheck],
}
