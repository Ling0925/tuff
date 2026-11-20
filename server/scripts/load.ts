/**
 * The load table, and the questions the product actually asks of it.
 *
 * Not demo data: 10 000 tasks in one project, a channel with a million
 * messages, 500 projects and 1 000 members in a workspace. The numbers are
 * there so that the screens are measured against what a real customer has
 * rather than against what fits on one screen.
 *
 * And not one company alone. The cost that hurt grew with every company's
 * rows, not this one's: a rule asking "which rooms are mine" read every
 * room there is. So another company sits beside this one, with fifty
 * thousand rooms of its own, and this one has the history a year of work
 * leaves — comments, notifications, the feed.
 *
 * Asked through the endpoints, in this process, as the person who signed
 * in. It timed the queries it thought the endpoints ran, and every line was
 * inside its budget while opening the million-message room took 850 ms: the
 * endpoint's query was not the one being timed.
 *
 * Rows are built with generate_series inside the database. Inserting a million
 * messages from Node would measure Node.
 *
 * It cleans up after itself. Leaving a million messages behind turned the
 * server test suite from seconds into five minutes, on a machine where
 * nothing had changed — a measurement that quietly taxes every run after it
 * is a measurement nobody will run twice. `KEEP=1` keeps the workspace when
 * you want to click through real data, and then the slowness is a choice.
 */
/* Before anything else is loaded: a development database only — `local.ts`. */
import './localOnly.js'
import { v7 as uuidv7 } from 'uuid'
import postgres from 'postgres'
import { withActor } from '../src/db.js'
import { registerUser } from '../src/auth/flows.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'

const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const stamp = uuidv7().replace(/-/g, '').slice(0, 12)
const session = await registerUser({
  email: `load+${stamp}@example.com`,
  password: 'correct-horse-battery-staple',
  name: 'Load',
  workspace_name: 'Load',
  workspace_slug: `load-${stamp}`,
})
const ws = session.workspace_id
const me = session.actor_id
const elsewhere = uuidv7()

const big = uuidv7()
const room = uuidv7()

console.log('building…')

await withActor(me, ws, async (tx) => {
  await tx`insert into project (id, workspace_id, name) values (${big}, ${ws}, 'The big one')`
  await tx`
    insert into project_member (id, workspace_id, project_id, actor_id, added_by)
    values (${uuidv7()}, ${ws}, ${big}, ${me}, ${me})`
  await tx`
    insert into conversation (id, workspace_id, project_id, name)
    values (${room}, ${ws}, ${big}, 'main')`
})

// 500 projects, all of which the owner can see — the sidebar and the overview
// both read across every one of them.
await owner`
  insert into project (id, workspace_id, name)
  select gen_random_uuid(), ${ws}, 'Project ' || i from generate_series(1, 499) i`
await owner`
  insert into project_member (id, workspace_id, project_id, actor_id, added_by)
  select gen_random_uuid(), ${ws}, p.id, ${me}, ${me}
  from project p where p.workspace_id = ${ws} and p.id <> ${big}`

// 1 000 members.
await owner`
  insert into actor (id, name)
  select gen_random_uuid(), 'Person ' || i from generate_series(1, 999) i`
await owner`
  insert into membership (id, workspace_id, actor_id, role, joined_at)
  select gen_random_uuid(), ${ws}, a.id, 'member', now()
  from actor a where a.name like 'Person %' and not exists (
    select 1 from membership m where m.actor_id = a.id and m.workspace_id = ${ws})`

/* Four lists, which are also the board's four columns. */
await owner`
  insert into task_list (id, workspace_id, project_id, author_id, name, sort_key,
                         icon, finishes)
  select gen_random_uuid(), ${ws}, ${big}, ${me}, v.name, v.key, v.icon, v.finishes
  from (values ('Backlog','a0','open',false), ('Doing','a1','doing',false),
               ('In review','a2','review',false), ('Done','a3','done',true))
       as v(name, key, icon, finishes)`

// 10 000 tasks, 2 000 posts, 500 documents in one project.
await owner`
  insert into task (id, workspace_id, project_id, author_id, title, sort_key, due_on,
                    list_id, completed_at, body, assignee_ids)
  select gen_random_uuid(), ${ws}, ${big}, ${me},
         /* A key the order's own library reads — a head and five digits —
            so a move or a repeat placed among them can be keyed. */
         'Task ' || i, 'e' || lpad(i::text, 5, '0'),
         case when i % 3 = 0 then current_date - (i % 30) else null end,
         (select id from task_list l where l.project_id = ${big}
          order by l.sort_key offset (i % 4) limit 1),
         case when i % 5 = 0 then now() else null end,
         /* A description on every one, so searching the words inside is
            measured against ten thousand of them — docs/specs/palette.md. */
         jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
           jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
             jsonb_build_object('type', 'text', 'text',
               'Notes on step ' || i || ': check the counterweight, the guide rails and cable '
               || (i % 97) || ' before the inspector signs the certificate.'))))),
         case when i % 7 = 0 then array[${me}::uuid] else '{}' end
  from generate_series(1, 10000) i`
/* A picture in every tenth description, so a board that shows them is
   measured against a thousand of them. */
await owner`
  insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type,
                    size_bytes, uploaded_at, pixel_width, pixel_height)
  select gen_random_uuid(), ${ws}, ${big}, ${me}, 'shot.png', ${ws}::text || '/load-' || t.id, 'image/png',
         1, now(), 1200, 800
  from task t where t.project_id = ${big} and t.number % 10 = 0`
await owner`
  update task t set body = jsonb_set(t.body, '{content}', (t.body -> 'content') || jsonb_build_array(
    jsonb_build_object('type', 'attachment', 'attrs',
      jsonb_build_object('fileId', f.id, 'name', f.name, 'kind', 'image'))))
  from file f
  where t.project_id = ${big} and f.project_id = ${big} and f.storage_key = ${ws}::text || '/load-' || t.id`
await owner`
  insert into post (id, workspace_id, project_id, author_id, title, body, published_at)
  select gen_random_uuid(), ${ws}, ${big}, ${me}, 'Post ' || i, '{}'::jsonb, now()
  from generate_series(1, 2000) i`
await owner`
  insert into file (id, workspace_id, project_id, author_id, name, body)
  select gen_random_uuid(), ${ws}, ${big}, ${me}, 'Doc ' || i, '{}'::jsonb
  from generate_series(1, 500) i`

// A million messages in one channel, said by its thousand people in turn.
console.log('  a million messages…')
const people = (await owner<{ id: string }[]>`select id from actor where name like 'Person %' order by id`).map((p) => p.id)
await owner`
  insert into message (id, workspace_id, conversation_id, author_id, body, created_at)
  select gen_random_uuid(), ${ws}, ${room}, (${people}::uuid[])[(i % ${people.length}) + 1],
         jsonb_build_object('type', 'doc', 'content',
           jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content',
             jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Message ' || i))))),
         now() - (i || ' seconds')::interval
  from generate_series(1, 1000000) i`

/* A year of the rest: a hundred thousand comments on the big project's
   tasks, three hundred thousand lines in the feed, fifty thousand of one
   person's notifications, most of them read. */
console.log('  a year of comments, the feed and the inbox…')
await owner`
  insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, created_at)
  select gen_random_uuid(), ${ws}, ${big}, 'task', t.id, ${me},
         jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
           jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
             jsonb_build_object('type', 'text', 'text', 'Comment ' || n))))),
         now() - (n || ' minutes')::interval
  from (select id from task where project_id = ${big}) t
  cross join generate_series(1, 10) n`
/* The feed's three hundred thousand lines are everybody's, a tenth of them
   this person's: thirty thousand things done in seven months is the
   busiest person anybody has, and three hundred thousand is nobody. */
await owner`
  insert into activity_event (id, workspace_id, project_id, actor_id, action, object_type, object_id, at)
  select gen_random_uuid(), ${ws}, ${big},
         case when n % 10 = 0 then ${me}::uuid else (${people}::uuid[])[(n % ${people.length}) + 1] end,
         'task.update', 'task', t.id, now() - (n || ' minutes')::interval
  from (select id from task where project_id = ${big}) t
  cross join generate_series(1, 30) n`

/* Docs: a thousand documents in the big
   project, a third of them drafts of somebody else's and a third kept to
   chosen people (this person among half of those), two pictures put into
   each, and ten lines in the feed for every one — the newest page of the
   project's Activity is all of them, so each of its lines asks who a file
   is kept from. */
console.log('  Docs, two thirds of them kept…')
await owner`
  insert into file (id, workspace_id, project_id, author_id, name, body, audience)
  select gen_random_uuid(), ${ws}, ${big},
         case when n % 3 = 0 then ${me}::uuid else (${people}::uuid[])[(n % ${people.length}) + 1] end,
         'Document ' || n, '{"type":"doc","content":[]}'::jsonb,
         case n % 3 when 0 then 'project' when 1 then 'author' else 'chosen' end
  from generate_series(1, 1000) n`
await owner`
  insert into file_reader (workspace_id, file_id, actor_id)
  select ${ws}, f.id, case when f.n % 2 = 0 then ${me}::uuid else (${people}::uuid[])[1] end
  from (select id, row_number() over (order by id) as n from file
        where project_id = ${big} and audience = 'chosen') f`
await owner`
  insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type, size_bytes,
                    uploaded_at, origin_type, origin_id, held_by)
  select gen_random_uuid(), ${ws}, ${big}, d.author_id, 'Picture ' || n, 'load/' || gen_random_uuid(),
         'image/png', 1000, now(), 'file', d.id, d.id
  from (select id, author_id from file where project_id = ${big} and body is not null) d
  cross join generate_series(1, 2) n`
/* And documents across every project of the workspace — ten thousand more,
   a third kept, two pictures held by each — so a held picture's question
   is asked against a workspace's worth of documents, not one project's. */
await owner`
  insert into file (id, workspace_id, project_id, author_id, name, body, audience)
  select gen_random_uuid(), ${ws}, p.id,
         case when n % 3 = 0 then ${me}::uuid else (${people}::uuid[])[(n % ${people.length}) + 1] end,
         'Note ' || n, '{"type":"doc","content":[]}'::jsonb,
         case when n % 3 = 1 then 'author' else 'project' end
  from project p cross join generate_series(1, 20) n
  where p.workspace_id = ${ws} and p.id <> ${big}`
await owner`
  insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type, size_bytes,
                    uploaded_at, origin_type, origin_id, held_by)
  select gen_random_uuid(), ${ws}, d.project_id, d.author_id, 'Held ' || n, 'load/' || gen_random_uuid(),
         'image/png', 1000, now(), 'file', d.id, d.id
  from (select id, author_id, project_id from file where workspace_id = ${ws} and project_id <> ${big} and body is not null) d
  cross join generate_series(1, 2) n`
await owner`
  insert into activity_event (id, workspace_id, project_id, actor_id, action, object_type, object_id, at, kept)
  select gen_random_uuid(), ${ws}, ${big}, f.author_id, 'file.update', 'file', f.id,
         now() - (n || ' seconds')::interval,
         /* Written while kept, as the server marks such a line. */
         f.audience <> 'project' or exists (select 1 from file d where d.id = f.held_by and d.audience <> 'project')
  from (select id, author_id, audience, held_by from file where project_id = ${big}) f
  cross join generate_series(1, 10) n`
await owner`
  insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, read_at, created_at, deliver_after)
  select gen_random_uuid(), ${ws}, ${me}, 'subscribed', 'task', t.id,
         case when n > 1 then now() end, now() - (n || ' hours')::interval, now() - (n || ' hours')::interval
  from (select id from task where project_id = ${big} order by sort_key limit 1000) t
  cross join generate_series(1, 50) n`

/* A project of a hundred, for an announcement that tells them all at
   once — docs/specs/notifications.md. A hundred is the team this is built
   for now; the workspace's thousand are the design's ceiling. */
const townHall = (await owner<{ id: string }[]>`
  insert into project (id, workspace_id, name) values (gen_random_uuid(), ${ws}, 'Town hall') returning id`)[0]!.id
await owner`
  insert into project_member (id, workspace_id, project_id, actor_id, added_by)
  select gen_random_uuid(), ${ws}, ${townHall}, m.actor_id, ${me}
  from membership m where m.workspace_id = ${ws} and m.deleted_at is null
  limit 100`

/* And another company beside this one: fifty thousand direct conversations
   between its people, and the people who have come and gone. Nothing here
   is this company's to read, and every rule that started from a whole table
   read all of it. */
console.log('  another company…')
await owner`insert into workspace (id, name, slug) values (${elsewhere}, 'Elsewhere', ${`elsewhere-${stamp}`})`
await owner`
  insert into membership (id, workspace_id, actor_id, role, joined_at, deleted_at)
  select gen_random_uuid(), ${elsewhere}, a.id, 'member', now() - interval '1 year',
         case when n > 1 then now() - (n || ' days')::interval end
  from actor a cross join generate_series(1, 50) n
  where a.name like 'Person %'`
await owner`
  insert into conversation (id, workspace_id, channel)
  select gen_random_uuid(), ${elsewhere}, false from generate_series(1, 50000)`
await owner`
  with people as (select id, row_number() over (order by id) as r from actor where name like 'Person %'),
       rooms as (select id, row_number() over (order by id) as r from conversation where workspace_id = ${elsewhere})
  insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
  select gen_random_uuid(), ${elsewhere}, rooms.id, people.id, now()
  from rooms join people on people.r = (rooms.r % 999) + 1 or people.r = ((rooms.r + 7) % 999) + 1`

/* A year of the audit log: fifty thousand
   sign-ins by the thousand people, and among the feed's three hundred
   thousand lines about the work, a thousand about the workspace — rights
   changed and people taken out. */
console.log('  a year of the audit log…')
await owner`
  insert into security_event (id, workspace_id, actor_id, kind, ip, user_agent, at)
  select gen_random_uuid(), ${ws}, (${people}::uuid[])[(n % ${people.length}) + 1], 'login',
         '203.0.113.' || (n % 250), 'Mozilla/5.0 (Macintosh) Chrome/130', now() - (n * 10 || ' minutes')::interval
  from generate_series(1, 50000) n`
await owner`
  insert into activity_event (id, workspace_id, actor_id, action, meta, at)
  select gen_random_uuid(), ${ws}, ${me},
         case when n % 4 = 0 then 'people.remove' else 'people.rights' end,
         jsonb_build_object('actor_id', (${people}::uuid[])[(n % ${people.length}) + 1]),
         now() - (n * 7 || ' hours')::interval
  from generate_series(1, 1000) n`


await owner`analyze`

/* ----------------------------------------------------------- the questions */

const asked = (path: string) => async () => {
  const r = await app.request(`/api${path}`, { headers: { authorization: `Bearer ${session.access_token}` } })
  if (r.status !== 200) throw new Error(`${path} answered ${r.status}`)
  await r.arrayBuffer()
}

async function time(label: string, fn: () => Promise<unknown>): Promise<number> {
  // Once to warm the cache, then the number that is reported: a cold first
  // read measures the disk, not the query, and reporting it flatters or
  // damns the wrong thing.
  await fn()
  const started = performance.now()
  await fn()
  const ms = performance.now() - started
  console.log(`  ${ms.toFixed(1).padStart(7)} ms  ${label}`)
  return ms
}

console.log('\nwhat the screens ask:')

const [someTask] = await owner<{ id: string }[]>`
  select id from task where project_id = ${big} order by sort_key offset 4242 limit 1`
const deep = new Date(Date.now() - 9 * 86_400_000).toISOString()
/* Where a page deep into the project starts, in either order. */
const [deepRow] = await owner<{ key: string; made: string }[]>`
  select sort_key || '|' || id as key, created_at::text || '|' || id as made
  from task where project_id = ${big} and deleted_at is null order by sort_key, id offset 6000 limit 1`
const deepKey = deepRow!.key
const deepMade = deepRow!.made

/* A write that tells everybody: the press of Publish waits for the notes. */
const announced = async () => {
  const r = await app.request(`/api/projects/${townHall}/posts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Everybody', body: { type: 'doc', content: [] } }),
  })
  if (r.status !== 201) throw new Error(`announcing answered ${r.status}`)
  await r.arrayBuffer()
}

/*
 * A blocker reopened and finished again. It
 * blocks twenty tasks of the big project, and the move answers each with
 * what it waits on now, so the screen puts their marks right without
 * reading ten thousand rows again. Reopened, then finished, so each run
 * of the pair leaves it where it was.
 */
const [blocker] = await owner<{ id: string }[]>`
  select id from task where project_id = ${big} and parent_id is null and completed_at is not null
  order by sort_key limit 1`
const waiters = await owner<{ id: string }[]>`
  select id from task where project_id = ${big} and parent_id is null and completed_at is null
  order by sort_key limit 20`
await owner`
  insert into task_block (workspace_id, task_id, blocker_id, created_by)
  select ${ws}, w, ${blocker!.id}, ${me} from unnest(${waiters.map((w) => w.id)}::uuid[]) w`
/* By saying so rather than by a move: a move re-keys the card, and the
   load table's keys are padded numbers, not fractional ones. */
const moved = (completed: boolean) => async () => {
  const r = await app.request(`/api/tasks/${blocker!.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ completed }),
  })
  if (r.status !== 200) throw new Error(`moving answered ${r.status}`)
  const said = (await r.json()) as { rewaits?: unknown[] }
  if ((said.rewaits?.length ?? 0) !== 20) throw new Error(`moving answered ${said.rewaits?.length} rewaits`)
}
/* Reopened on the warming run, finished on the measured one. */
let finished = true
const reopenOrFinish = async () => {
  finished = !finished
  await moved(finished)()
}

/*
 * A repeating task finished on the big project.
 * The answer carries the next one, its parts and the rule, so the screen
 * puts it in place rather than reading ten thousand rows again. Two of
 * them, one for the warming run and one for the measured one, since a
 * task finished once is not finished again.
 */
const repeating = await owner<{ id: string }[]>`
  select id from task where project_id = ${big} and parent_id is null and completed_at is null
  order by sort_key offset 40 limit 2`
for (const r of repeating) {
  const set = await app.request(`/api/tasks/${r.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ repeat: { every: 'week' } }),
  })
  if (set.status !== 200) throw new Error(`setting a repeat answered ${set.status}`)
}
let finishing = 0
const finishRepeating = async () => {
  const r = await app.request(`/api/tasks/${repeating[finishing++ % repeating.length]!.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ completed: true }),
  })
  if (r.status !== 200) throw new Error(`finishing answered ${r.status}`)
  const said = (await r.json()) as { next?: unknown }
  if (!said.next) throw new Error('finishing a repeating task made no next one')
}

/*
 * An edit on a task's own screen, on the big project.
 * The answer carries the row as the list
 * draws it, so the list behind puts it in place rather than reading ten
 * thousand rows again, which was 440 to 510 ms after every edit there.
 */
const [edited] = await owner<{ id: string; list_id: string }[]>`
  select id, list_id from task where project_id = ${big} and parent_id is null and completed_at is null
  order by sort_key offset 60 limit 1`
const bigLists = await owner<{ id: string }[]>`
  select id from task_list where project_id = ${big} and not finishes order by sort_key`
const editTask = (body: Record<string, unknown>, check: (row: { title: string; list_id: string }) => boolean) => async () => {
  const r = await app.request(`/api/tasks/${edited!.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (r.status !== 200) throw new Error(`editing answered ${r.status}`)
  const said = (await r.json()) as { task?: { title: string; list_id: string } }
  if (!said.task || !check(said.task)) throw new Error('the edit did not answer the row as it is now')
}
let renamed = 0
const rename = async () => {
  const title = `Task renamed ${++renamed}`
  await editTask({ title }, (t) => t.title === title)()
}
/* To another open list and back, one each run. */
let hop = 0
const moveFromScreen = async () => {
  const to = bigLists.filter((l) => l.id !== edited!.list_id)[hop++ % 2]!.id
  await editTask({ list_id: to }, (t) => t.list_id === to)()
}

/*
 * The board read by column: every list's
 * first fifty with its count, and Done a thousand cards down.
 */
const [doneList] = await owner<{ id: string }[]>`
  select id from task_list where project_id = ${big} and finishes and deleted_at is null order by sort_key limit 1`
const [doneDeep] = await owner<{ sort_key: string; id: string }[]>`
  select sort_key, id from task where list_id = ${doneList!.id} and parent_id is null and deleted_at is null
  order by sort_key, id offset 1000 limit 1`
const doneCursor = encodeURIComponent(`${doneDeep!.sort_key}|${doneDeep!.id}`)

/* A picture held by a document of the project that this person did not upload. */
const [held] = await owner<{ id: string }[]>`
  select x.id from file x join file d on d.id = x.held_by
  where x.workspace_id = ${ws} and d.audience = 'project' and x.author_id <> ${me} limit 1`
const heldPicture = held?.id ?? '00000000-0000-0000-0000-000000000000'

/* A thousand pictures down the big project's Images — the cursor the list
   would have handed back there. */
const [picturesDeep] = await owner<{ pinned: string | null; updated: string; id: string }[]>`
  select to_char(pinned_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as pinned,
         to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated, id
  from file
  where project_id = ${big} and deleted_at is null and url is null and storage_key is not null and content_type ^@ 'image/'
  order by pinned_at desc nulls last, updated_at desc, id desc offset 1000 limit 1`
const picturesCursor = encodeURIComponent(
  Buffer.from(`${picturesDeep!.pinned ?? '-'}|${picturesDeep!.updated}|${picturesDeep!.id}`).toString('base64url'),
)

const budget: [string, number, () => Promise<unknown>][] = [
  ['project screen: its first page of tasks', 200, asked(`/projects/${big}/tasks`)],
  ['project screen: its lists', 200, asked(`/projects/${big}/lists`)],
  /* The board reads every page with each card's picture, five hundred at a
     time. */
  ['board: five hundred tasks with their pictures', 200, asked(`/projects/${big}/tasks?pictures=1&limit=500`)],
  ['board: pictures, a page deep', 200, asked(`/projects/${big}/tasks?pictures=1&limit=500&cursor=${encodeURIComponent(deepKey)}`)],
  ['board: every column’s first fifty, with its count and pictures', 200, asked(`/projects/${big}/tasks?by=list&pictures=1`)],
  ['board: Done, a thousand cards down', 200, asked(`/projects/${big}/tasks?list=${doneList!.id}&pictures=1&cursor=${doneCursor}`)],
  ['project screen: newest first', 200, asked(`/projects/${big}/tasks?order=created`)],
  ['project screen: newest first, a page deep', 200, asked(`/projects/${big}/tasks?order=created&cursor=${encodeURIComponent(deepMade)}`)],
  ['an open task, among a hundred thousand comments', 200, asked(`/tasks/${someTask!.id}`)],
  ['sidebar: 500 projects', 200, asked('/projects?limit=200')],
  ['sidebar: every room, and what is new in each', 200, asked('/conversations')],
  ['chat: the newest page of a million', 200, asked(`/conversations/${room}/messages`)],
  ['chat: a page deep in the history', 200, asked(`/conversations/${room}/messages?cursor=${encodeURIComponent(deep)}`)],
  ['chat: words in the room', 200, asked(`/conversations/${room}/messages?q=${encodeURIComponent('Message 4242')}`)],
  ['search: a word across everything', 200, asked(`/search?q=${encodeURIComponent('cable 42 ')}`)],
  ['search: a task by its handle', 200, asked('/search?q=4242')],
  /* What was said in chat, across every room:
     a phrase said once in a million, a word said in every one of them, and
     the palette's own question, all four kinds at once. */
  ['search: a phrase among a million messages', 200, asked(`/search?q=${encodeURIComponent('Message 424242')}&type=message`)],
  ['search: a word in every one of a million messages', 200, asked(`/search?q=Message&type=message`)],
  ['search: a phrase said a hundred times among a million', 200, asked(`/search?q=${encodeURIComponent('Message 4242')}&type=message`)],
  ['search: the palette, all four kinds', 200, asked(`/search?q=${encodeURIComponent('cable 42 ')}&type=task,post,file,message`)],
  ['people: 1 000 members', 200, asked('/people')],
  ['a person’s page: thirty thousand things they did', 200, asked(`/people/${me}`)],
  ['a colleague’s page: a thousand messages of theirs', 200, asked(`/people/${people[0]}`)],
  ['the notifications panel', 200, asked('/inbox')],
  ['the notifications panel, unread only', 200, asked('/inbox?unread=1')],
  ['an announcement to a hundred people', 200, announced],
  ['a project’s Activity', 200, asked(`/activity?project=${big}`)],
  /* Four thousand rows, two thirds of the documents kept and every
     picture asking about its document — read
     a page at a time, each kind on its own: */
  ['a project’s Files: the first page of documents', 200, asked(`/projects/${big}/files?limit=100&kind=docs`)],
  ['a project’s Files: the first page of pictures, signed', 200, asked(`/projects/${big}/files?limit=100&kind=images`)],
  ['a project’s Files: pictures, a thousand down', 200, asked(`/projects/${big}/files?limit=100&kind=images&cursor=${picturesCursor}`)],
  ['a project’s Files: my documents', 200, asked(`/projects/${big}/files?limit=100&kind=docs&whose=mine`)],
  ['a project’s Files: others’ links, none there', 200, asked(`/projects/${big}/files?limit=100&kind=links&whose=others`)],
  ['a project’s Files: words found among them', 200, asked(`/projects/${big}/files?limit=100&kind=docs&q=${encodeURIComponent('Document 42')}`)],
  ['a project’s Files: read again five hundred deep', 200, asked(`/projects/${big}/files?limit=500&kind=images`)],  ['a picture held by a document: its link', 200, asked(`/files/${heldPicture}/url`)],
  ['search: a held picture’s name across the workspace', 200, asked(`/search?q=${encodeURIComponent('Held 1')}&type=file`)],
  ['a project’s Activity of documents, files only', 200, asked(`/activity?project=${big}&in=files`)],
  ['My tasks: given to me', 200, asked('/my/tasks?tab=assigned')],
  ['My tasks: what I touched', 200, asked('/my/tasks?tab=activity')],
  ['overview: overdue across every project', 200, asked('/overview?view=overdue')],
  ['audit log: the newest page', 200, asked('/audit')],
  ['audit log: who was taken out', 200, asked('/audit?type=people')],
  ['audit log: rights, a page deep', 200, asked(`/audit?type=rights&cursor=${encodeURIComponent(`${deep}_00000000-0000-0000-0000-000000000000`)}`)],
  ['audit log: by or about one person', 200, asked(`/audit?who=${people[7]}`)],
  ['audit log: who it can be narrowed to', 200, asked('/audit/people')],
  ['a blocker of twenty finished: the move and every mark', 200, reopenOrFinish],
  ['finishing a repeating task on the big project: the next one, in the answer', 200, finishRepeating],
  ['editing a task’s title on the big project: the row, in the answer', 200, rename],
  ['moving a task to another list from its screen: the row, in the answer', 200, moveFromScreen],
]

let failed = 0
for (const [label, limit, fn] of budget) {
  /* A question that fails is a failure, and the clean-up still runs: a
     thrown line left a million messages behind. */
  const ms = await time(label, fn).catch((e) => {
    console.log(`  failed  ${label}: ${String(e).slice(0, 200)}`)
    return Number.POSITIVE_INFINITY
  })
  if (ms > limit) {
    console.log(`          over the ${limit} ms budget`)
    failed++
  }
}

console.log(
  failed === 0
    ? '\nevery screen inside its budget'
    : `\n${failed} over budget — see above`,
)

if (process.env.KEEP) {
  console.log(`\nkept. Sign in: load+${stamp}@example.com / correct-horse-battery-staple`)
} else {
  // As the owner, and hard: soft delete is the product's rule for things
  // people made, and none of this was made by a person.
  //
  // Every workspace-scoped table, retried until nothing is left rather than
  // deleted in a hand-written order. An order written out here is a list that
  // goes stale the first time a table is added, and it goes stale silently —
  // the script would still pass and still leave rows behind.
  //
  // Sent unsafe because a `do` block is one string to the server: it takes no
  // bind parameters, and the driver would helpfully turn the id into one. The
  // id is a uuid this script generated, and it is checked as one first rather
  // than trusted for being ours.
  for (const id of [ws, elsewhere]) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('not a uuid')
    await owner.unsafe(`
      do $$
      declare
        todo text[];
        left_over text[];
        t text;
        moved boolean;
      begin
        select array_agg(table_name::text) into todo
        from information_schema.columns
        where table_schema = 'public' and column_name = 'workspace_id';

        loop
          moved := false;
          left_over := '{}';
          foreach t in array todo loop
            begin
              execute format('delete from %I where workspace_id = %L', t, '${id}');
              moved := true;
            exception when foreign_key_violation then
              left_over := left_over || t;
            end;
          end loop;
          todo := left_over;
          exit when cardinality(todo) = 0;
          if not moved then
            raise exception 'could not clear: %', todo;
          end if;
        end loop;
      end $$`)
    await owner`delete from workspace where id = ${id}`
  }

  // An actor outlives the workspace, and what hangs off one is not addressed
  // by workspace at all — a sign-in session and an account row are about the
  // person. The same sweep, by the other key.
  await owner.unsafe(`
    do $$
    declare
      todo text[];
      left_over text[];
      t text;
      moved boolean;
    begin
      select array_agg(table_name::text) into todo
      from information_schema.columns
      where table_schema = 'public' and column_name = 'actor_id';

      loop
        moved := false;
        left_over := '{}';
        foreach t in array todo loop
          begin
            execute format(
              'delete from %I where actor_id in
                 (select id from actor where id = %L or name like ''Person %%'')',
              t, '${me}');
            moved := true;
          exception when foreign_key_violation then
            left_over := left_over || t;
          end;
        end loop;
        todo := left_over;
        exit when cardinality(todo) = 0;
        if not moved then
          raise exception 'could not clear: %', todo;
        end if;
      end loop;
    end $$`)
  // Vacuum before the actors, not after.
  //
  // Removing an actor makes Postgres check every table that references one,
  // and most of those references have no index — correctly, because nothing
  // in the product reads by them. On a table that has just lost a million
  // rows those checks scan a million dead pages, once per actor. Reclaiming
  // the space first turns the last step from minutes into nothing.
  await owner.unsafe('vacuum (analyze) message, task, post, file, comment, activity_event, notification, conversation, conversation_member, membership')
  await owner`delete from actor where id = ${me} or name like 'Person %'`
  await owner`analyze`
  console.log('\ncleaned up. KEEP=1 to keep the workspace and sign in to it.')
}

await closeRealtime()
await owner.end()
process.exit(failed === 0 ? 0 : 1)
