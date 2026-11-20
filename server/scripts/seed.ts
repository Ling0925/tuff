/**
 * A workspace with something in it.
 *
 * Sized to the load table where it matters and small where it does
 * not: stage 1 has no long lists to measure yet, so this is enough to click
 * through, and the heavy seed arrives with the screens that need it.
 */
/* Before anything else is loaded: a development database only — `local.ts`. */
import './localOnly.js'
import { v7 as uuidv7 } from 'uuid'
import { withActor } from '../src/db.js'
import { sweep } from './sweep.js'
import { asOwner, makeOperator } from './owner.js'
import { registerUser, issueApiToken } from '../src/auth/flows.js'
import { RIGHTS_ON_JOINING, STARTING_LISTS } from '@tracker/shared-schema'

/*
 * Last run's studio goes before this one is made, and every other throwaway
 * workspace with it.
 *
 * Every check seeded a fresh workspace and left it behind, so the database
 * grew by one a run and the server tests went from seconds to minutes. A
 * check that takes minutes is a check people skip.
 */
const swept = await sweep()
if (swept.workspaces) {
  console.log(`cleared ${swept.workspaces} throwaway workspaces, ${swept.actors} accounts`)
}

/*
 * More than one studio, because the browser suite is one person otherwise.
 *
 * Every test signs in as the seeded account, and sixty of them in ninety
 * seconds is more requests than one person is allowed in a window — so the
 * server did exactly what it is meant to do and answered 429, a screen went
 * blank, and a test somewhere failed on an assertion three steps later. It
 * looked like flakiness for a long time because the refusal was never
 * printed anywhere.
 *
 * The ceiling is right and stays. What was wrong is the harness pretending
 * a suite is one person. The specs are spread across these.
 *
 * Four was enough for sixty-seven tests, six for seventy-six, and eight once
 * a project began warming its other tools on open — five requests where
 * there had been one. The count that matters is requests per spec file, and
 * the files that grow are the ones that were already the longest. This is a
 * number to raise when a run shows a 429, not one to tune in advance.
 */
const STUDIOS = Number(process.env.SEED_STUDIOS ?? 10)
const password = 'correct-horse-battery-staple'

const logins: string[] = []
let last: { actor_id: string; workspace_id: string } | null = null

for (let n = 0; n < STUDIOS; n++) {
  const stamp = uuidv7().replace(/-/g, '').slice(0, 12)
  const email = `dev+${stamp}@example.com`

  const session = await registerUser({
    email,
    password,
    name: 'Dev',
    workspace_name: 'Studio',
    workspace_slug: `studio-${stamp}`,
  })

  const ws = session.workspace_id

  /*
   * And the plan the fixture needs.
   *
   * A new workspace is `solo`, which holds two, and this one is built with
   * three people in it — so every seeded workspace would open over its own
   * ceiling and refuse the next invitation.
   *
   * Team rather than unlimited, for the reason `dev:account` is on team: a
   * reading against a ceiling says something, and a reading against no
   * ceiling says nothing.
   */
  await withActor(session.actor_id, ws, (tx) =>
    tx`update workspace set plan = 'team' where id = ${ws}`,
  )

  const PROJECTS = [
    ['Acme rebrand', 'An outside engagement, with the people on it'],
    ['Website', 'Internal work'],
    ['Onboarding', 'Everything a new person reads first'],
  ] as const

  const projectIds: string[] = []
  /** The channels the colleague says something in, so rooms are unread. */
  const teamRooms: string[] = []
  const launchRoom = uuidv7()
  const briefRoom = uuidv7()
  /** And who he is, once the transaction that makes him has run. */
  let said = ''
  await withActor(session.actor_id, session.workspace_id, async (tx) => {
    for (const [name, description] of PROJECTS) {
      const id = uuidv7()
      projectIds.push(id)
      await tx`
        insert into project (id, workspace_id, name, description)
        values (${id}, ${ws}, ${name}, ${description})`
      await tx`
        insert into project_member (id, workspace_id, project_id, actor_id, added_by)
        values (${uuidv7()}, ${ws}, ${id}, ${session.actor_id}, ${session.actor_id})`
      const team = uuidv7()
      teamRooms.push(team)
      /*
       * Older than the second channels made below, explicitly.
       *
       * Everything here is written in one transaction, so `now()` is the
       * same instant for all of it and rooms within a project came back in
       * whatever order the database felt like. The Chat tool opens a
       * project's first room and the sidebar lists them in that order, so
       * which room a test lands on changed between runs — one of them
       * quietly skipped about one run in ten, which is the worst way for a
       * test to fail.
       */
      await tx`
        insert into conversation (id, workspace_id, project_id, name, created_at)
        values (${team}, ${ws}, ${id}, 'main', now() - interval '10 minutes')`
      /* The lists a project starts with, which are also the board's columns
         — a task has nowhere to be without one. Taken from the contract, not
         written again here: the seed drifting from what the endpoint makes is
         a demo of a product that does not exist. */
      for (const [at, { name: listName, icon, finishes, color, narrow }] of STARTING_LISTS.entries()) {
        await tx`
          insert into task_list (id, workspace_id, project_id, author_id, name,
                                 sort_key, icon, finishes, color, narrow)
          values (${uuidv7()}, ${ws}, ${id}, ${session.actor_id}, ${listName},
                  ${`a${at}`}, ${icon}, ${finishes}, ${color}, ${narrow})`
      }
    }

    // Two colleagues, so the permission matrix has somebody to be about and
    // the screens are not a single-person hall of mirrors.
    const mate = uuidv7()
    await tx`insert into actor (id, name) values (${mate}, 'Sam')`
    await tx`
      insert into membership (id, workspace_id, actor_id, role, joined_at, invited_by)
      values (${uuidv7()}, ${ws}, ${mate}, 'member', now(), ${session.actor_id})`
    for (const id of projectIds) {
      await tx`
        insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
        values (${uuidv7()}, ${ws}, ${id}, ${mate}, ${session.actor_id},
                ${[...RIGHTS_ON_JOINING, 'task.delete', 'edit.any']})`
    }

    // On one project, and with less on it than Sam has: the rights screen
    // needs two people who differ, or it shows nothing.
    const outside = uuidv7()
    await tx`insert into actor (id, name) values (${outside}, 'Robin')`
    await tx`
      insert into membership (id, workspace_id, actor_id, role, joined_at, invited_by)
      values (${uuidv7()}, ${ws}, ${outside}, 'member', now(), ${session.actor_id})`
    await tx`
      insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
      values (${uuidv7()}, ${ws}, ${projectIds[0]!}, ${outside}, ${session.actor_id},
              ${['task.create']})`
    /*
     * Second channels, which are also the rooms the browser suite reads.
     *
     * The Chat tool opens a project's *first* channel, so these two are
     * never opened by a test that merely visits a project — which is what
     * makes them usable as the unread rooms the tests about unread take.
     * They are not there for the tests: a project with one channel is a
     * project nobody has needed a second conversation in yet, and a fixture
     * made only of those teaches that this product has one room per project.
     */
    await tx`
      insert into conversation (id, workspace_id, project_id, name)
      values (${launchRoom}, ${ws}, ${projectIds[0]!}, 'Launch')`
    await tx`
      insert into conversation (id, workspace_id, project_id, name)
      values (${briefRoom}, ${ws}, ${projectIds[1]!}, 'Brief')`

    said = mate
  })

  /*
   * One thing somebody else said, so one room is unread.
   *
   * Every channel here was empty, which meant the sidebar could never show a
   * count and no test could press one: the badge, how fast it goes and what
   * it says were exercised only in the zero case. A fixture that cannot be
   * in the state the screen is about agrees with everything.
   *
   * In a transaction of Sam's own, because that is the only way a row with
   * his name on it is written — the policies ask who is asking, and the
   * answer has to be him. From him and not from the person signing in,
   * because a room is unread when somebody else has spoken since you looked.
   */
  await withActor(said, session.workspace_id, async (tx) => {
    /*
     * Three rooms and not one.
     *
     * The suite has more than one test about what an unread room does, and
     * reading one is what those tests do — so two of them sharing a studio's
     * single unread room means whichever runs second quietly skips. The two
     * second channels are the ones they take, because nothing else opens
     * them; the first project's Team is unread as well, for the look of it.
     */
    for (const [at, room] of [teamRooms[0]!, launchRoom, briefRoom].entries()) {
      await tx`
        insert into message (id, workspace_id, conversation_id, author_id, body)
        values (${uuidv7()}, ${ws}, ${room}, ${said},
                ${tx.json({
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: [
                            'Morning — anything on this today?',
                            'Left you a note in the files tab.',
                            'Draft is ready whenever you are.',
                          ][at]!,
                        },
                      ],
                    },
                  ],
                } as never)})`
    }
  })
  logins.push(email)
  last = session
}

const session = last!
const ws = session.workspace_id

/* The first studio's owner runs the product as well, so the browser tests
   have an admin to open. The rest do not: a door
   drawn for everybody is not the door being tested. */
const owner = asOwner()
const [first] = await owner<{ actor_id: string }[]>`select actor_id from app_user where email = ${logins[0]!}`
if (first) await makeOperator(owner, first.actor_id)
await owner.end()
const token = await issueApiToken(session.actor_id, ws, 'local', [], 90)

console.log(`Workspace:   ${ws}`)
console.log(`Studios:     ${STUDIOS}`)
console.log(`Sign in:     ${logins.join(',')} / ${password}`)
console.log(`Operator:    ${logins[0]}`)
console.log(`API token:   ${token}`)
process.exit(0)
