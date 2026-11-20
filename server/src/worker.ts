import { asWorker, closeDb, sql, withoutActor } from './db.js'
import { guardRls } from './rlsGuard.js'
import { purgeAfterDays } from './env.js'
import { PRESET, remove } from './storage.js'
import { deliverDue } from './webhooks.js'
import { pushDue, recountDue, webPushConfigured } from './push.js'
import { apnsConfigured } from './apns.js'
import { edition } from './edition.js'
import { mailFrom } from './mail.js'
import { newestMigration } from './db/migrate.js'
import { remindChosenDue, remindDue, sendDigests } from './digest.js'
import { githubWork } from './githubWork.js'
import { githubOut } from './githubIssues.js'
import { importWork } from './importWork.js'
import { slackOut, slackUnfurl } from './slackWork.js'
import { begin, startWatchdog } from './watchdog.js'

/**
 * The part of the product that runs when nobody is looking.
 *
 * Until this existed, `deliverDue` was reachable only from an endpoint
 * somebody had to POST to — which means **webhooks never fired**. The queue
 * filled, the retries were written, the signing was correct, and nothing ever
 * drained it. Nothing threw; the deliveries simply sat there, which is the
 * same failure shape as every other thing in this codebase that looked
 * finished and was not.
 *
 * One process, two jobs, both idempotent: run it twice and the second run
 * finds nothing to do rather than doing it again.
 */

/** Often enough that a webhook feels immediate; not so often that it spins. */
const DELIVER_EVERY_MS = 2_000

/** Once an hour is plenty for a retention window measured in days. */
const PURGE_EVERY_MS = 60 * 60 * 1000
const PURGE_AFTER_DAYS = purgeAfterDays()

/* Every error line to where somebody is told — the edition's to say where. */
edition.watchErrors('worker')
/* As the server's, with the job in progress for a route. */
startWatchdog('worker')
/* Who the digests and reminders are from — refused here, as the server refuses it (`main.ts`). */
mailFrom()

let stopping = false
/* When a delivery pass last came round, whatever it found. */
let turned = Date.now()

async function deliver(): Promise<void> {
  try {
    const sent = await deliverDue(50)
    if (sent > 0) console.log(`worker: delivered ${sent}`)
  } catch (e) {
    console.error('worker: delivery failed', e)
  }
  turned = Date.now()
}

/*
 * And the other queue, which has been filling since the day it was made.
 * `notification.deliver_after` and `delivered_at` were written for a sender
 * that did not exist — the same shape as the webhooks before this process.
 *
 * In a loop of its own: behind the webhooks, one endpoint that never
 * answered held every notification of every workspace for ten seconds a
 * delivery.
 */
async function pushes(): Promise<void> {
  try {
    const pushed = await pushDue(50)
    if (pushed > 0) console.log(`worker: pushed ${pushed}`)
    /* After the notifications: a phone one of them has just told its
       number is not told it again. */
    const counted = await recountDue(50)
    if (counted > 0) console.log(`worker: told ${counted} phones their number`)
  } catch (e) {
    // A failure here must not end the loop: the next tick is two seconds
    // away, and a worker that dies on one bad row stops delivering for
    // everybody.
    console.error('worker: delivery failed', e)
  }
}

async function purge(): Promise<void> {
  /* Each job with its own failure: the clear-out stopping used to take
     the orphaned files' removal down with it. */
  try {
    const removed = await asWorker(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select purge_deleted(${PURGE_AFTER_DAYS}) as n`
      return r?.n ?? 0
    })
    if (removed > 0) console.log(`worker: cleared ${removed} rows past ${PURGE_AFTER_DAYS} days`)
  } catch (e) {
    console.error('worker: purge failed', e)
  }
  /* Workspaces their owners deleted, for good once their thirty days
     are up. */
  try {
    const gone = await asWorker(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select purge_deleted_workspaces(${PURGE_AFTER_DAYS}) as n`
      return r?.n ?? 0
    })
    if (gone > 0) console.log(`worker: cleared ${gone} deleted workspaces`)
  } catch (e) {
    console.error('worker: clearing deleted workspaces failed', e)
  }
  /* Feedback requests nobody confirmed, a day after their link ran out. */
  try {
    const gone = await asWorker(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select feedback_pending_sweep() as n`
      return r?.n ?? 0
    })
    if (gone > 0) console.log(`worker: cleared ${gone} unconfirmed feedback requests`)
  } catch (e) {
    console.error('worker: clearing feedback requests failed', e)
  }
  /* And the two queues, which only ever grew: old notifications, old
     deliveries, spent codes — `124_the_queues_are_cleared_and_claimed.sql`. */
  try {
    const cleared = await asWorker(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select purge_queues() + github_events_clear() + linear_imports_clear() + slack_clear() as n`
      return r?.n ?? 0
    })
    if (cleared > 0) console.log(`worker: cleared ${cleared} old notifications and deliveries`)
  } catch (e) {
    console.error('worker: clearing the queues failed', e)
  }
  /* OAuth clients registered a week ago that nothing names — no code, no
     token, no agent's grant. Rows nobody owns, so nobody is asked
     (migration 295). */
  try {
    const gone = await asWorker(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select oauth_clients_clear() as n`
      return r?.n ?? 0
    })
    if (gone > 0) console.log(`worker: cleared ${gone} unused OAuth clients`)
  } catch (e) {
    console.error('worker: clearing OAuth clients failed', e)
  }
  /* Devices signed in nowhere any more — sessions that ran out or were
     revoked without being ended (migrations 186, 187). On its own, so a
     fault here clears nothing less and a fault there leaves this running. */
  try {
    const off = await asWorker(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select push_sweep() as n`
      return r?.n ?? 0
    })
    if (off > 0) console.log(`worker: took ${off} devices signed in nowhere off push`)
  } catch (e) {
    console.error('worker: taking signed-out devices off push failed', e)
  }
  /* And the apps' sign-in challenges past their hour (`handoff.md`) — on
     their own, so a database without 185 yet still clears the rest. */
  try {
    const challenges = await asWorker(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select auth_app_start_clear() as n`
      return r?.n ?? 0
    })
    if (challenges > 0) console.log(`worker: cleared ${challenges} sign-in challenges`)
  } catch (e) {
    console.error('worker: clearing sign-in challenges failed', e)
  }
  try {
    /* And the bytes of files whose rows are gone — `storage_orphan`. Each
       removed and then taken off the queue; one that fails stays for the
       next pass. `docs/specs/projects-index.md`. */
    const keys = await asWorker((tx) => tx<{ key: string }[]>`select storage_orphans(2000) as key`)
    const gone: string[] = []
    for (const { key } of keys) {
      try {
        /* A premade face is no bytes. */
        if (!key.startsWith(PRESET)) await remove(key)
        gone.push(key)
      } catch (e) {
        console.error('worker: could not remove', key, e)
      }
    }
    if (gone.length) {
      await asWorker((tx) => tx`select storage_orphans_gone(${gone})`)
      console.log(`worker: removed ${gone.length} files' bytes`)
    }
  } catch (e) {
    console.error('worker: removing files failed', e)
  }
}

/*
 * What GitHub said, in the order it said it. In a
 * loop of its own, so a slow push to a phone does not hold a pull request
 * back from its task.
 */
async function github(): Promise<void> {
  try {
    const applied = await githubWork(20)
    if (applied > 0) console.log(`worker: applied ${applied} GitHub events`)
    /* And what was changed here and is owed to GitHub — its issues. */
    const sent = await githubOut(10)
    if (sent > 0) console.log(`worker: sent ${sent} changes to GitHub`)
  } catch (e) {
    console.error('worker: GitHub events failed', e)
  }
}

/*
 * What is owed to Slack. At most one message a
 * channel a pass, and a pass every second and a half, which keeps under
 * Slack's one a second in a channel.
 */
async function slackLoop(): Promise<void> {
  try {
    const sent = await slackOut(20)
    if (sent > 0) console.log(`worker: posted ${sent} to Slack`)
  } catch (e) {
    console.error('worker: Slack failed', e)
  }
  /* And the previews of links pasted in a project's channel. */
  try {
    await slackUnfurl(20)
  } catch (e) {
    console.error('worker: Slack previews failed', e)
  }
}

/*
 * A team or a project coming across from Linear, Jira or Asana.
 * A few
 * pages a turn, so one large project does not hold the rest of the worker.
 */
async function linear(): Promise<void> {
  try {
    const pages = await importWork()
    if (pages > 0) console.log(`worker: brought ${pages} pages of an import`)
  } catch (e) {
    console.error('worker: an import failed', e)
  }
}

/*
 * Reminders of a date, and the day's email of what was not read —
 * `docs/specs/notifications.md`. Every five minutes is close enough to nine
 * o'clock and to "four hours unread" for either to be on time.
 */
async function clock(): Promise<void> {
  try {
    const reminded = await remindDue()
    if (reminded > 0) console.log(`worker: reminded ${reminded}`)
    const mailed = await sendDigests()
    if (mailed > 0) console.log(`worker: mailed ${mailed} digests`)
  } catch (e) {
    console.error('worker: the clock failed', e)
  }
}

/*
 * Reminders people set for themselves. Their
 * moment is a minute somebody picked, so every twenty seconds rather than
 * on the five-minute clock; the push follows on the next delivery pass.
 */
async function chosen(): Promise<void> {
  try {
    const reminded = await remindChosenDue()
    if (reminded > 0) console.log(`worker: sent ${reminded} chosen reminders`)
  } catch (e) {
    console.error('worker: chosen reminders failed', e)
  }
}

/**
 * A loop that waits *between* runs rather than on a fixed schedule.
 *
 * With an interval, a run that takes longer than the gap overlaps the next
 * one, and two workers deliver the same queue at once.
 */
async function every(ms: number, fn: () => Promise<void>): Promise<void> {
  while (!stopping) {
    const done = begin(`job ${fn.name || 'unnamed'}`)
    await fn().finally(done)
    await new Promise((r) => setTimeout(r, ms))
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true
  })
}

console.log(
  `worker: delivering every ${DELIVER_EVERY_MS}ms, clearing out every hour` +
    (webPushConfigured() ? '' : ' — no VAPID keys, so nothing is pushed to a browser') +
    (apnsConfigured() ? '' : ' — no APNs key, so nothing is pushed to the apps'),
)
/*
 * As the server asks it at every start (`main.ts`): a worker asking as the
 * database's owner is under no policy. It did, for months, with nothing
 * said. Refused where the server refuses
 * (`edition.rlsFailClosed`), in production; said loudly everywhere else.
 */
await guardRls(sql, 'worker', process.env.NODE_ENV === 'production' && edition.rlsFailClosed)

/*
 * Not before the schema this build was made for. The server migrates when
 * it starts, and the two start together: the worker came up first and
 * called a function the migration half a minute later would make. Up to
 * five minutes, then on regardless — a worker that never starts is worse
 * than one error line.
 *
 * On your own server, for as long as it takes: there the server backs the
 * database up before it migrates, which takes as long as the database is
 * large, and compose starts the worker beside the app rather than after
 * it is healthy. A worker that
 * went on after five minutes would run this build against the schema
 * before it. Said once a minute while it waits.
 */
const wanted = newestMigration()
const cap = edition.backups ? Number.POSITIVE_INFINITY : 300_000
for (let waited = 0; wanted && waited < cap && !stopping; waited += 5_000) {
  const [row] = await withoutActor((tx) => tx<{ name: string | null }[]>`select max(name) as name from schema_migration`).catch(() => [
    { name: null },
  ])
  if (row?.name && row.name >= wanted) break
  if (waited > 0 && waited % 60_000 === 0) console.log(`[worker] Waiting for the database to be migrated to ${wanted}…`)
  await new Promise((r) => setTimeout(r, 5_000))
}

await Promise.all([
  every(DELIVER_EVERY_MS, deliver),
  every(DELIVER_EVERY_MS, pushes),
  every(DELIVER_EVERY_MS, github),
  every(5_000, linear),
  every(1_500, slackLoop),
  every(PURGE_EVERY_MS, purge),
  every(5 * 60_000, clock),
  every(20_000, chosen),
  /* And the edition's own loops, if it has any. `edition.ts`. */
  ...edition.jobs({ turned: () => turned }).map((j) => every(j.every, j.run)),
])
await closeDb()
