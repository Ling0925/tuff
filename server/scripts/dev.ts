/**
 * The account you actually sign in with, and the workspace behind it.
 *
 * The seed makes a fresh throwaway workspace every run, so the credentials it
 * prints change every time and the last ones scroll off. This one is fixed:
 * run it as often as you like and you land on the same sign-in.
 *
 * Printing throwaway credentials as if they were durable once sent somebody
 * to a sign-in screen for an account that no longer existed. This exists so
 * that cannot happen again.
 *
 * It rebuilds rather than tops up. The old version only added what was
 * missing, which is fine until a browser run is pointed at this account — and
 * then the studio has forty-eight projects called `Dense 1790066913762` and
 * fifty-two channels called `Team`, and every screenshot of the product is of
 * that. Demo data is a fixture, not a place to keep things, and a fixture
 * that cannot be put back is not one.
 *
 * What is in it is meant to read like a small studio three weeks into a job:
 * three projects, five rooms, and text somebody could have typed. A demo
 * where every task is `Task 3` hides exactly the things worth looking at —
 * whether a long title wraps, whether the board columns balance, whether the
 * feed reads as a sentence.
 */
/* Before anything else is loaded: a development database only — `local.ts`. */
import './localOnly.js'
import { v7 as uuidv7 } from 'uuid'
import { generateKeyBetween } from 'fractional-indexing'
import { withActor, type Tx } from '../src/db.js'
import { registerUser, issueApiToken } from '../src/auth/flows.js'
import { asOwner, actorFor, makeOperator, ownWorkspace } from './owner.js'
import { Right, STARTING_LISTS } from '@tracker/shared-schema'

const EMAIL = 'dev@example.com'
const PASSWORD = 'correct-horse-battery-staple'
const SLUG = 'studio'

// ------------------------------------------------------------------ helpers

const now = Date.now()
/** Days back from this run, so the ages on the board are never all zero. */
const ago = (days: number) => new Date(now - days * 86_400_000)
/** Due dates are ahead, and written as a date because that is the column. */
const due = (days: number) => ago(-days).toISOString().slice(0, 10)
/** Who a task is given to, as the column holds it: a list, empty for nobody. */
const people = (who: string | string[] | undefined): string[] => (who === undefined ? [] : [who].flat())

/** The body shape every written thing in the product shares. */
const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
})

/** Sort keys in the order they are written, the way the API makes them. */
function keys(n: number): string[] {
  const out: string[] = []
  let prev: string | null = null
  for (let i = 0; i < n; i++) {
    prev = generateKeyBetween(prev, null)
    out.push(prev)
  }
  return out
}

// ------------------------------------------------------- put the studio back

/*
 * Through the definer function, because `workspace` is readable only by its
 * members. Asked plainly, the studio is invisible, the purge finds nothing
 * to do, and the register that follows fails on an email that was supposed
 * to have gone. As the table owner: the purges are nobody else's to call
 * (migration 227).
 */
const before = await (async () => {
  const purger = asOwner()
  try {
    const [swept] = await purger<{ n: number }[]>`
      select purge_workspaces_like(array[${SLUG}]) as n`
    await purger`select purge_orphan_actors()`
    return Number(swept?.n ?? 0) > 0
  } finally {
    await purger.end()
  }
})()

/*
 * Registering only works when the account went with the studio, and it does
 * not always go. The orphan sweep takes actors with no membership left, so an
 * account that is also a member of somewhere the sweep does not touch — `ours`,
 * which is the whole point of `ours` — survives, and registering the same
 * email again fails on the unique index.
 *
 * That is what happened the day `ours` was added: this script died on every
 * run and `pnpm check` still said all green, because it sent the output to a
 * log and never read the exit code. So the studio is put back either way —
 * registered when the account is gone, and made around the existing actor
 * when it is not.
 */
const owner = asOwner()
const existing = await actorFor(owner, EMAIL)
let ws: string
let dev: string
if (existing) {
  dev = existing
  ws = (await ownWorkspace(owner, dev, SLUG, 'Studio')).id
} else {
  const session = await registerUser({
    email: EMAIL,
    password: PASSWORD,
    name: 'Dev',
    workspace_name: 'Studio',
    workspace_slug: SLUG,
  })
  ws = session.workspace_id
  dev = session.actor_id
}

/*
 * And the plan it is meant to be on.
 *
 * A new workspace is `solo`, which is one person — so a demo with four
 * people in it opens on a red bar saying it is over its ceiling. That is
 * the right behaviour and the wrong thing for a fixture to show: somebody
 * opening this is looking at the product working, not at a workspace in
 * trouble.
 *
 * Team rather than unlimited, so the readings are readings — four people
 * out of ten says something, and four out of no limit says nothing.
 */
await owner`update workspace set plan = 'team' where id = ${ws}`

await owner.end()

// ------------------------------------------------------------------- people

/*
 * Three other people. Three rather than one because a single other person
 * makes every screen read as a conversation, and the product is not one —
 * assignment, mentions and the member list all look different once there is
 * a third name in them.
 */
const sam = uuidv7()
const emily = uuidv7()
const dana = uuidv7()

const PEOPLE = [
  [sam, 'Sam Carter', 'member'],
  [emily, 'Emily Brooks', 'member'],
  // Acme's side of the rebrand: a member like the rest, on one project and
  // holding less there.
  [dana, 'Dana Whitlock', 'member'],
] as const

/*
 * What each of them may do on a project.
 *
 * The screen that sets these needs two people who differ, or it shows a
 * column of identical ticks and nobody notices it is a control.
 */
const RIGHTS = new Map<string, string[]>([
  [sam, ['task.create', 'task.delete', 'channel.create', 'edit.any']],
  [emily, ['task.create', 'channel.create']],
  [dana, ['task.create']],
])

// ----------------------------------------------------------------- projects

const acme = uuidv7()
const site = uuidv7()
const onboarding = uuidv7()
const redesign = uuidv7()

const PROJECTS = [
  [acme, 'Acme rebrand', 'Identity, site and launch. Acme are on this one.', 24],
  [site, 'Studio site', 'Our own. Case studies first, the rest when they are ready.', 17],
  [onboarding, 'Onboarding', 'What somebody reads in their first week here.', 9],
  /*
   * The product, looked at from outside.
   *
   * One task per screen, and every one of them says what is wrong with that
   * screen today rather than "redesign X". A backlog of nouns is a backlog
   * nobody can start from: the work is in the sentence that says what you see
   * now and why it is not good enough.
   */
  [redesign, 'Redesign', 'Every screen of this product, one at a time.', 12],
] as const

// Dana is on one project only. Being on a project is the whole of access —
// there is no lesser way to be on one.
const ON = new Map<string, string[]>([
  [acme, [dev, sam, emily, dana]],
  [site, [dev, emily]],
  [onboarding, [dev, sam, emily]],
  // The studio's own work: Acme, the client, has no business in it.
  [redesign, [dev, sam, emily]],
])

// ------------------------------------------------------------------- rooms

const acmeTeam = uuidv7()
const acmeLaunch = uuidv7()
const siteTeam = uuidv7()
const onboardingTeam = uuidv7()
const redesignTeam = uuidv7()
const dm = uuidv7()

const ROOMS = [
  [acmeTeam, acme, 'main'],
  // Two rooms on one project rather than one room with a filter. This one
  // names who is in it, which is the only thing that narrows a room now.
  [acmeLaunch, acme, 'Launch'],
  [siteTeam, site, 'main'],
  [onboardingTeam, onboarding, 'main'],
  /*
   * Every project starts with the team's own channel — including this one.
   *
   * It was left out to keep the sidebar short, which made the fixture
   * disagree with the product: the server opens a channel with every project
   * it creates, and a demo where one project has none teaches that a channel
   * is something you switch on.
   */
  [redesignTeam, redesign, 'main', false],
  [dm, null, null, false],
] as const

// -------------------------------------------------------------------- lists

/*
 * A list is where a task is, and the board draws these as its columns.
 * Four in every project, the last one finishing the
 * work in it.
 *
 * The Redesign project used to have two lists of its own, "Screens" and
 * "Across every screen", *and* a board column per task. Only one placement
 * survives the merge and it is this one: a topic list and a stage list are
 * the same field, and a task cannot be in both.
 */
const STAGES = STARTING_LISTS

/** Every project's lists, by project and by name, once they are written. */
const listIds = new Map<string, string>()
/** A project's labels by name, the ones it starts with included. */
const labelIds = new Map<string, string>()
const listKey = (project: string, name: string) => `${project}:${name}`

// ------------------------------------------------------------------- content

type Task = {
  project: string
  by: string
  title: string
  /** Which list it is in, by name — the board's column is the same thing. */
  column: string
  /** What is wrong with it now. A title alone is not a task anybody can pick up. */
  body?: string[]
  /** Who has it — one person, several, or nobody. */
  assignee?: string | string[]
  dueIn?: number
  doneDaysAgo?: number
  age: number
  priority?: 'urgent' | 'high' | 'medium' | 'low'
  /** By name, from the project's own — `LABELS` and the three it starts with. */
  labels?: string[]
}

const TASKS: Task[] = [
  // Acme rebrand — the middle of a job, so the board is not all in one column.
  { project: acme, by: dev, title: 'Get the orange to pass AA on white at 16px', column: 'In Progress', assignee: [emily, dev], dueIn: 2, age: 9, priority: 'urgent', labels: ['Bug', 'Design'] },
  { project: acme, by: emily, title: 'Lockups at 16, 32 and billboard', column: 'In Progress', assignee: emily, dueIn: 4, age: 7, labels: ['Design'] },
  { project: acme, by: sam, title: 'Confirm the web weight is inside the type licence', column: 'In Progress', assignee: sam, dueIn: 1, age: 12, labels: ['Client'] },
  { project: acme, by: dev, title: 'Photography brief for the launch shoot', column: 'Todo', assignee: dana, dueIn: 11, age: 4, labels: ['Design'] },
  { project: acme, by: emily, title: 'Favicon and app icon from the new mark', column: 'Todo', assignee: emily, dueIn: 8, age: 5, labels: ['Design'] },
  { project: acme, by: sam, title: 'Launch announcement for the Acme newsletter', column: 'Todo', assignee: [sam, dana, emily], dueIn: 6, age: 4, labels: ['Copy'] },
  { project: acme, by: sam, title: 'Email signature templates', column: 'Backlog', age: 2, labels: ['Copy'] },
  { project: acme, by: sam, title: 'Decide what happens to the old wordmark on invoices', column: 'Backlog', age: 3, labels: ['Client'] },
  { project: acme, by: dev, title: 'Packaging mock with the second lockup', column: 'In Progress', assignee: dev, dueIn: 3, age: 2, labels: ['Design'] },
  { project: acme, by: dev, title: 'Brand guidelines PDF for the printer', column: 'Done', assignee: sam, doneDaysAgo: 3, age: 10, labels: ['Client'] },
  { project: acme, by: emily, title: 'Drop the gradient from the secondary mark', column: 'Done', doneDaysAgo: 5, age: 14, labels: ['Design'] },
  { project: acme, by: dev, title: 'Send round one to Acme', column: 'Done', doneDaysAgo: 6, age: 16, labels: ['Client'] },

  // Studio site — ours, quieter, one thing actually moving.
  { project: site, by: emily, title: 'Rewrite the About page, it is three years out of date', column: 'In Progress', assignee: emily, age: 8 },
  { project: site, by: dev, title: 'Cut the carousel on the home page', column: 'In Progress', assignee: emily, age: 6 },
  { project: site, by: dev, title: 'Move the journal off the subdomain', column: 'Backlog', dueIn: 19, age: 11 },
  { project: site, by: emily, title: 'Case study: Acme, once it ships', column: 'Backlog', age: 5 },
  { project: site, by: dev, title: 'Take 200 KB of unused font weights off every page', column: 'Done', doneDaysAgo: 3, age: 10 },

  // Redesign — one per screen, in the order somebody meets them.
  { project: redesign, by: dev, column: 'Backlog', age: 12, assignee: dev, title: 'Sign in',
    body: ['Two placeholders and a button. No name, no mark, nothing that says what this is.',
           'There is no way back in either: no password reset, and there cannot be one until mail exists. Everyone meets this screen and it reads as a debug form.'] },
  { project: redesign, by: dev, column: 'Done', doneDaysAgo: 1, age: 12,
    title: 'Sidebar',
    body: ['Icons, a generated mark per project, 32px rows a hair apart, 248px with a gutter that does not shift when the list grows.',
           'Left: a collapsed state for narrow windows, and whether the project order should be the person\u2019s to set.'] },
  { project: redesign, by: emily, column: 'In Progress', age: 11, assignee: emily,
    title: 'Projects index',
    body: ['Rows, archived, bin \u2014 all there. Pinned and recent are not, and the brief names both.',
           'With forty projects there is no top of the list, so the screen is a scroll from A.'] },
  { project: redesign, by: dev, column: 'Backlog', age: 10, title: 'My tasks',
    body: ['Mine / Everyone and five lenses, and all five draw the same flat list with a date on the right.',
           'Two of them are not lists: by person is a set of people, progress is a shape over time. Drawing them as rows is why nobody uses them twice.'] },
  { project: redesign, by: sam, column: 'In Progress', age: 10, assignee: sam,
    title: 'Tasks \u2014 the list',
    body: ['Filters, sorting and finished work folded to the bottom all landed. What did not: lists.',
           'A list is a filter here \u2014 one at a time, chosen from a select. Basecamp is built around seeing several at once, and that is the shape this screen is missing.'] },
  { project: redesign, by: dev, column: 'Done', doneDaysAgo: 0, age: 9,
    title: 'Tasks \u2014 the board',
    body: ['The card lifts into a layer of its own, the gap opens where it will land, the board scrolls at its edges, Escape puts it back.',
           'Left: the column heading. The count is a bare number with nothing to say whether eleven is a lot.'] },
  { project: redesign, by: emily, column: 'Backlog', age: 9, dueIn: 9,
    title: 'Task detail',
    body: ['Title, properties, body, checklist, comments, backlinks.',
           'The properties read as a form: five labelled rows of controls stacked in a column. The brief asks them to read as facts about the task, which is a different drawing entirely.',
           'And what points at this task is printed as text. \u201cMentioned in: task Foo\u201d and no way to get there \u2014 the same absence as the one on the search screen.'] },
  { project: redesign, by: dev, column: 'In Progress', age: 8,
    title: 'Announcements',
    body: ['A post is now a title, its first line and a date, with the activity under it in words rather than in action names.',
           'Still one column of equal weight: today and three weeks ago look the same.'] },
  { project: redesign, by: sam, column: 'Backlog', age: 8, assignee: sam,
    title: 'Chat',
    body: ['Day separators, threads, promote to a task, unread counts.',
           'Missing: editing and deleting your own message, reactions, attachments. Three absences that make a chat feel broken rather than sparse \u2014 the first typo proves it.'] },
  { project: redesign, by: emily, column: 'Backlog', age: 7, title: 'Docs',
    body: ['Folders, documents, links and uploads in one list, told apart by a word at the left.',
           'No previews, which the brief names. A folder of twelve images is twelve identical rows.'] },
  { project: redesign, by: dev, column: 'Backlog', age: 7, dueIn: 4, assignee: dev,
    title: 'A document',
    body: ['Name, body, version, comments.',
           'The body is a plain textarea: no headings, no lists, no images. A document you cannot format is a notes field with a version number on it.'] },
  { project: redesign, by: sam, column: 'Backlog', age: 6, title: 'Project settings',
    body: ['Name, description, tools, members, archive, bin, hours \u2014 seven kinds of thing stacked in one column, each having invented its own layout.',
           'The tool switches show posts, tasks, files, messages. The tabs say Tasks, Announcements, Chat, Docs. Same four things, two vocabularies.'] },
  { project: redesign, by: dev, column: 'Backlog', age: 6, title: 'Notifications',
    body: ['Mentioned / assigned / subscribed, and a mark-all.',
           'Every row is the same weight, so nine notices about one task read as nine things to deal with rather than one.'] },
  { project: redesign, by: emily, column: 'Backlog', age: 5, title: 'Members',
    body: ['A list of names and a page per person.',
           'A role is a word. What that word lets somebody do lives in the permission matrix in the brief and nowhere on screen \u2014 which is the question actually being asked when you open this.'] },
  { project: redesign, by: dev, column: 'Backlog', age: 5, dueIn: 6, assignee: dev,
    title: 'Search',
    body: ['Returns as you type, filters by type and project. Two things wrong, and the second is a bug.',
           'A hit shows a type, a title and a project \u2014 never the line that matched, so you open it to find out whether it is the one. And clicking a hit opens the project, not the object you searched for.'] },
  { project: redesign, by: sam, column: 'Backlog', age: 4, title: 'Command palette',
    body: ['The one surface that is already the right shape: glass, keyboard, projects and actions in one place.',
           'The work here is not drawing but coverage \u2014 everything the sidebar offers must be reachable here, and nothing here may offer a door the sidebar hides.'] },
  { project: redesign, by: dev, column: 'Backlog', age: 4, title: 'Account settings',
    body: ['Tokens, two-factor, sessions, quiet hours.',
           'Four sections that each invented their own layout, on the screen where somebody is deciding whether to trust us with a workspace.'] },
  { project: redesign, by: sam, column: 'Backlog', age: 3, title: 'Admin',
    body: ['Webhooks, the security log, import, invites.',
           'The security log is the thing a customer\u2019s security team asks to see, and it prints raw event names next to an IP. It has to read as sentences before anyone will accept it as evidence.'] },

  { project: redesign, by: dev, column: 'Done', doneDaysAgo: 0, age: 3,
    title: 'The scrollbar',
    body: ['No track, a translucent pill in a 10px gutter, brighter as you approach it, solid under the two preferences that argue with translucency.'] },
  { project: redesign, by: emily, column: 'Backlog', age: 2, assignee: emily,
    title: 'Empty states',
    body: ['The brief asks the product to look alive for one person with an agent. Today an empty screen says a short sentence in grey and offers nothing.',
           'Every one of them is a place where somebody decides whether this product is for them.'] },
  { project: redesign, by: dev, column: 'Backlog', age: 2, title: 'Where the glass goes',
    body: ['Controls and chrome: segments, the palette, floating panels. Never lists, tables, document bodies or message history.',
           'The rule matters more than the effect, and it is currently kept by hand in each component rather than by the tokens.'] },
  { project: redesign, by: sam, column: 'Backlog', age: 1, title: 'Dark theme',
    body: ['The ramp inverts and everything follows, which is why it works at all. What has never been looked at as a whole is whether it is the same product in the dark or a darker copy of the light one.'] },

  // Onboarding — the one nobody finishes.
  { project: onboarding, by: dev, title: 'Write the first-week checklist', column: 'In Progress', assignee: dev, dueIn: 6, age: 7 },
  { project: onboarding, by: sam, title: 'One page: who to ask about what', column: 'Backlog', assignee: sam, age: 5 },
  { project: onboarding, by: sam, title: 'Laptop setup — the five things that are never in the docs', column: 'Backlog', age: 5 },
  { project: onboarding, by: emily, title: 'Book the studio walk-through', column: 'Done', doneDaysAgo: 2, age: 8 },
]

type Post = {
  project: string
  by: string
  title: string
  body: string[]
  age: number
}

const POSTS: Post[] = [
  {
    project: acme,
    by: dev,
    age: 6,
    title: 'Round one went out on Tuesday',
    body: [
      'Three lockups and the colour study, plus a page on where the old wordmark still has to live — invoices, the two signs at reception, and the PDF nobody can find the source of.',
      'Dana would rather sit in on round two than send notes by email, which is faster for everyone. Round two is the 9th.',
    ],
  },
  {
    project: acme,
    by: emily,
    age: 2,
    title: 'The orange is the open question',
    body: [
      'It is 4.1:1 on white, which fails AA at body size. Keeping the hue and dropping two steps of lightness gets it to 4.8:1 and reads warmer rather than darker, so nothing in the palette has to move with it.',
      'I would rather decide this before the packaging mock than after.',
    ],
  },
  {
    project: site,
    by: emily,
    age: 4,
    title: 'We are cutting the carousel',
    body: [
      'Six months of analytics and 3% of people reached the second slide. The other four slides were there because we could not agree which one was first.',
      'The home page is 40% shorter without it and says more. The only thing that broke was the hero, which was sized off the carousel height.',
    ],
  },
  {
    project: onboarding,
    by: dev,
    age: 3,
    title: 'New starter on the 6th',
    body: [
      'Priya joins on the 6th, on the Acme project from the second week. The checklist is the only thing still missing — everything else has survived two people arriving.',
    ],
  },
]

type Doc = {
  project: string
  by: string
  name: string
  body?: string[]
  url?: string
  folder?: string
  age: number
}

const roundOne = uuidv7()

const FILES: Doc[] = [
  { project: acme, by: dev, name: 'Round one', age: 16 },
  {
    project: acme,
    by: emily,
    age: 15,
    folder: roundOne,
    name: 'Colour study',
    body: [
      'Three families, each shown at 16px on white, on the grey, and reversed out.',
      'The warm orange is the one everybody reached for first and the one that fails contrast. The note beside each swatch is the ratio, not an opinion.',
    ],
  },
  {
    project: acme,
    by: dev,
    age: 15,
    folder: roundOne,
    name: 'Acme as it stands today',
    url: 'https://acme.example.com',
  },
  {
    project: acme,
    by: sam,
    age: 8,
    name: 'Brand guidelines — working draft',
    body: [
      'Written as we go rather than at the end, because the end is where guidelines get written from memory.',
      'Sections that are settled: the grid, the two type sizes that matter, clear space. Sections that are not: colour, and everything downstream of colour.',
    ],
  },
  {
    project: site,
    by: emily,
    age: 5,
    name: 'Site map, after the cut',
    body: [
      'Four top-level pages instead of nine. Work, Studio, Journal, Contact.',
      'Everything removed is either a case study that never shipped or a page that existed to hold one paragraph.',
    ],
  },
  {
    project: site,
    by: dev,
    age: 4,
    name: 'Analytics, last six months',
    url: 'https://plausible.example.com/studio',
  },
  {
    project: onboarding,
    by: dev,
    age: 7,
    name: 'First week',
    body: [
      'Day one is accounts, the walk-through and lunch with whoever is in. Nothing else.',
      'Day two to five is one real task on a live project, with somebody to ask. Reading the whole wiki first has never worked and we have tried it three times.',
    ],
  },
]

type Msg = { room: string; by: string; text: string; minutes: number }

/** Minutes back from now, so a room reads as a conversation and not a list. */
const MESSAGES: Msg[] = [
  { room: acmeTeam, by: sam, minutes: 2600, text: 'Dana moved round two to the 9th. That buys us the photography brief.' },
  { room: acmeTeam, by: dev, minutes: 2570, text: 'Good. The orange is still failing AA on white at small sizes — 4.1:1.' },
  { room: acmeTeam, by: emily, minutes: 2540, text: 'We can keep the hue and drop the lightness two steps. Reads warmer, not darker.' },
  { room: acmeTeam, by: sam, minutes: 300, text: 'Try it on the 16px lockup before we show anyone.' },
  { room: acmeTeam, by: emily, minutes: 240, text: 'Doing that now. Packaging mock after.' },

  { room: acmeLaunch, by: dev, minutes: 8600, text: 'Round one is in the files tab — three lockups and the colour study.' },
  { room: acmeLaunch, by: dana, minutes: 8400, text: 'The second one, clearly. Can we see it on the packaging before Friday?' },
  { room: acmeLaunch, by: dev, minutes: 8300, text: 'Friday morning.' },
  { room: acmeLaunch, by: dana, minutes: 120, text: 'One thing — the orange looks different on my phone than in the PDF. Is that me?' },

  { room: siteTeam, by: emily, minutes: 5900, text: 'Carousel is gone. Home page is 40% shorter and says more.' },
  { room: siteTeam, by: dev, minutes: 5800, text: 'Anything break on mobile?' },
  { room: siteTeam, by: emily, minutes: 5700, text: 'Hero was sized off the carousel height. Fixed.' },

  { room: onboardingTeam, by: dev, minutes: 4300, text: 'Priya starts on the 6th. The checklist is the last missing piece.' },
  { room: onboardingTeam, by: sam, minutes: 4200, text: 'I can write it Thursday if nobody has started.' },

  { room: redesignTeam, by: emily, minutes: 1500, text: 'Started at the top: sign-in is two placeholders and a button.' },
  { room: redesignTeam, by: dev, minutes: 1400, text: 'Take the sidebar first. Everything else is read against it.' },
  { room: redesignTeam, by: sam, minutes: 80, text: 'Board is done. The gap opens where the card will land now.' },

  { room: dm, by: sam, minutes: 190, text: 'Am I on the Acme call on the 9th, or is that yours?' },
  { room: dm, by: dev, minutes: 170, text: 'Come. You have the colour argument in your head better than I do.' },
  { room: dm, by: sam, minutes: 45, text: 'Then I want the contrast numbers on a slide, not in my mouth.' },
]

/*
 * Where each person has read up to.
 *
 * Left out entirely, the sidebar is a wall of rooms with nothing to say which
 * one wants you — which is the state this replaced. Set to now everywhere, it
 * is the same wall. So most rooms are read and two are not, which is what a
 * morning looks like.
 */
const READ: [string, number | null][] = [
  [acmeTeam, 260],
  [acmeLaunch, 8000],
  [siteTeam, 0],
  [onboardingTeam, 0],
  [redesignTeam, 120],
  [dm, 100],
]

/*
 * The words the rebrand files its tasks under, beside the three every
 * project starts with (Bug, Feature, Improvement — migration 071). The board
 * is the landing's first picture, and a board of cards with nothing on them
 * but a title read as a list somebody had not finished filling in.
 */
const LABELS: [string, string, string][] = [
  [acme, 'Design', 'purple'],
  [acme, 'Copy', 'orange'],
  [acme, 'Client', 'green'],
]

/*
 * Hours, logged on tasks.
 *
 * A person's page reads them over thirty days — and
 * draws nothing while there are none, so the demo had no time in it at all.
 * The landing's picture of it was taken from hours somebody had logged by
 * hand, and the next rebuild took them away. Mostly Emily's, because hers is
 * the page that picture is of.
 */
type Logged = { by: string; task: string; minutes: number; daysAgo: number }
const HOURS: Logged[] = [
  { by: emily, task: 'Lockups at 16, 32 and billboard', minutes: 420, daysAgo: 6 },
  { by: emily, task: 'Lockups at 16, 32 and billboard', minutes: 300, daysAgo: 2 },
  { by: emily, task: 'Drop the gradient from the secondary mark', minutes: 180, daysAgo: 9 },
  { by: emily, task: 'Rewrite the About page, it is three years out of date', minutes: 360, daysAgo: 5 },
  { by: emily, task: 'Cut the carousel on the home page', minutes: 150, daysAgo: 11 },
  { by: sam, task: 'Confirm the web weight is inside the type licence', minutes: 90, daysAgo: 3 },
  { by: dev, task: 'Packaging mock with the second lockup', minutes: 240, daysAgo: 1 },
]

// --------------------------------------------------------------- write it all

/** Everything this actor authored, in one transaction, as them. */
async function as(actor: string, fn: (tx: Tx) => Promise<void>): Promise<void> {
  await withActor(actor, ws, fn)
}

await as(dev, async (tx) => {
  for (const [id, name, role] of PEOPLE) {
    await tx`insert into actor (id, name) values (${id}, ${name})`
    await tx`
      insert into membership (id, workspace_id, actor_id, role, joined_at, invited_by)
      values (${uuidv7()}, ${ws}, ${id}, ${role}::role_kind, ${ago(40)}, ${dev})`
  }

  for (const [id, name, description, age] of PROJECTS) {
    await tx`
      insert into project (id, workspace_id, name, description, created_at)
      values (${id}, ${ws}, ${name}, ${description}, ${ago(age)})`
    for (const actor of ON.get(id)!) {
      await tx`
        insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
        values (${uuidv7()}, ${ws}, ${id}, ${actor}, ${dev},
                ${RIGHTS.get(actor) ?? [...Right.options]})`
    }
  }

  for (const [project] of PROJECTS) {
    for (const [i, { name, icon, finishes, color, narrow }] of STAGES.entries()) {
      const id = uuidv7()
      listIds.set(listKey(project, name), id)
      await tx`
        insert into task_list (id, workspace_id, project_id, author_id, name,
                               sort_key, icon, finishes, color, narrow)
        values (${id}, ${ws}, ${project}, ${dev}, ${name}, ${`a${i}`}, ${icon},
                ${finishes}, ${color}, ${narrow})`
    }
  }

  for (const [project, name, color] of LABELS) {
    await tx`
      insert into label (id, workspace_id, project_id, name, color)
      values (${uuidv7()}, ${ws}, ${project}, ${name}, ${color})`
  }
  for (const l of await tx<{ id: string; project_id: string; name: string }[]>`
    select id, project_id, name from label where workspace_id = ${ws}`) {
    labelIds.set(listKey(l.project_id, l.name), l.id)
  }

  for (const [id, project, name] of ROOMS) {
    await tx`
      insert into conversation (id, workspace_id, project_id, name, created_at)
      values (${id}, ${ws}, ${project}, ${name}, ${ago(20)})`
  }

  /*
   * The Launch room names its people, so it is the few of them and not the
   * project. Putting somebody in a project's room marks it `chosen`
   * (a trigger, migration 240); one never chosen is everybody on the project.
   */
  for (const actor of [dev, emily, dana]) {
    await tx`
      insert into conversation_member
        (id, workspace_id, conversation_id, actor_id, created_at, joined_at)
      values (${uuidv7()}, ${ws}, ${acmeLaunch}, ${actor}, ${ago(20)}, ${ago(20)})`
  }

  /*
   * The direct room has no project, so its membership is the only thing that
   * says who is in it — and `joined_at` is what says the row is a membership
   * rather than a read mark. Left out, the room is one nobody can see, and
   * the first message written into it fails the policy and takes the whole
   * transaction with it.
   */
  for (const actor of [dev, sam]) {
    await tx`
      insert into conversation_member
        (id, workspace_id, conversation_id, actor_id, created_at, joined_at)
      values (${uuidv7()}, ${ws}, ${dm}, ${actor}, ${ago(20)}, ${ago(20)})`
  }
})

/*
 * A key per column, not per project.
 *
 * One run of keys handed out across every task put the same key in
 * different columns — and a key is only ever compared against the keys in
 * its own column, so two cards in one column could end up sharing one.
 * When they do, the order between them is whatever Postgres returns, and
 * a card dragged one place lands two places away.
 *
 * The API learned this (`tasks.ts` reads the edge of the column it is
 * inserting into) and migration 068 evened out the rows already written.
 * The fixture wrote its own keys and kept making them: every duplicate
 * found after the migration came from a project this script had built.
 */
const sortKeys = (() => {
  const runs = new Map<string, string[]>()
  const taken = new Map<string, number>()
  for (const t of TASKS) {
    const where = listKey(t.project, t.column)
    runs.set(where, [])
  }
  for (const [where] of runs) {
    runs.set(where, keys(TASKS.filter((t) => listKey(t.project, t.column) === where).length))
  }
  return TASKS.map((t) => {
    const where = listKey(t.project, t.column)
    const n = taken.get(where) ?? 0
    taken.set(where, n + 1)
    return runs.get(where)![n]!
  })
})()
/* Known before they are written, because a part has to point at one. */
const taskIds = TASKS.map(() => uuidv7())

/**
 * Tasks that are parts of other tasks.
 *
 * Two of them and not twenty: the point of the seed is that the nesting is
 * visible in the list, and a list where half the rows are indented says
 * nothing about how it reads when most tasks are whole.
 */
type Part = {
  /** Which task in TASKS this is a part of, by title. */
  of: string
  by: string
  title: string
  /** Who has it — one person, several, or nobody. */
  assignee?: string | string[]
  dueIn?: number
  doneDaysAgo?: number
}

const PARTS: Part[] = [
  { of: 'Sign in', by: dev, title: 'A mark and the workspace name above the fields', assignee: dev, doneDaysAgo: 2 },
  { of: 'Sign in', by: dev, title: 'Somewhere to go when the password is gone', assignee: emily, dueIn: 4 },
  { of: 'Sign in', by: dev, title: 'Say which of the two fields is wrong', dueIn: 9 },
  { of: 'Projects index', by: emily, title: 'Pinned, and what pins one', assignee: emily, dueIn: 3 },
  { of: 'Projects index', by: emily, title: 'Recent, from what the person opened', doneDaysAgo: 1 },
]

const partKeys = keys(PARTS.length)

for (const author of [dev, sam, emily, dana]) {
  await as(author, async (tx) => {
    for (const [i, t] of TASKS.entries()) {
      if (t.by !== author) continue
      await tx`
        insert into task (id, workspace_id, project_id, author_id, title, body, list_id,
                          sort_key, assignee_ids, priority, due_on, completed_at,
                          created_at, decided_at)
        values (${taskIds[i]!}, ${ws}, ${t.project}, ${author}, ${t.title},
                ${t.body ? tx.json(doc(...t.body) as never) : null},
                ${listIds.get(listKey(t.project, t.column))!},
                ${sortKeys[i]!}, ${people(t.assignee)}::uuid[], ${t.priority ?? null}::task_priority,
                /* Compared against undefined, not for truth: zero is a real
                   answer to both of these — due today, finished today — and
                   read as falsy it silently means "neither". Two cards sat in
                   the Done column unticked because of it. */
                ${t.dueIn === undefined ? null : due(t.dueIn)},
                ${t.doneDaysAgo === undefined ? null : ago(t.doneDaysAgo)},
                ${ago(t.age)}, ${ago(t.doneDaysAgo ?? Math.max(0, t.age - 2))})`
      for (const name of t.labels ?? []) {
        const label = labelIds.get(listKey(t.project, name))
        if (!label) throw new Error(`no label called ${name} on ${t.title}`)
        await tx`
          insert into task_label (id, workspace_id, task_id, label_id)
          values (${uuidv7()}, ${ws}, ${taskIds[i]!}, ${label})`
      }
    }

    /* The parts, after their parents exist. A part is a task, so it goes in
       the same table with the same columns — the only new one is the
       pointer. It takes its parent's list, because a part somewhere else
       cannot be drawn under it. */
    for (const [i, part] of PARTS.entries()) {
      if (part.by !== author) continue
      const at = TASKS.findIndex((t) => t.title === part.of)
      const parent = TASKS[at]
      if (!parent) throw new Error(`no task called ${part.of}`)
      await tx`
        insert into task (id, workspace_id, project_id, author_id, parent_id, title,
                          list_id, sort_key, assignee_ids, due_on,
                          completed_at, created_at, decided_at)
        values (${uuidv7()}, ${ws}, ${parent.project}, ${author}, ${taskIds[at]!},
                ${part.title}, ${listIds.get(listKey(parent.project, parent.column))!},
                ${partKeys[i]!}, ${people(part.assignee)}::uuid[],
                ${part.dueIn === undefined ? null : due(part.dueIn)},
                ${part.doneDaysAgo === undefined ? null : ago(part.doneDaysAgo)},
                ${ago(parent.age)}, ${ago(part.doneDaysAgo ?? Math.max(0, parent.age - 2))})`
    }

    for (const p of POSTS) {
      if (p.by !== author) continue
      await tx`
        insert into post (id, workspace_id, project_id, author_id, title, body,
                          published_at, created_at)
        values (${uuidv7()}, ${ws}, ${p.project}, ${author}, ${p.title},
                ${tx.json(doc(...p.body) as never)},
                ${ago(p.age)}, ${ago(p.age)})`
    }

    // Folders first: a document in one points at a row that has to exist.
    for (const pass of [0, 1]) {
      for (const f of FILES) {
        if (f.by !== author) continue
        const isFolder = !f.body && !f.url
        if (isFolder !== (pass === 0)) continue
        await tx`
          insert into file (id, workspace_id, project_id, author_id, name, body, url,
                            folder_id, created_at)
          values (${isFolder ? roundOne : uuidv7()}, ${ws}, ${f.project}, ${author}, ${f.name},
                  ${f.body ? tx.json(doc(...f.body) as never) : null}, ${f.url ?? null},
                  ${f.folder ?? null}, ${ago(f.age)})`
      }
    }

    for (const m of MESSAGES) {
      if (m.by !== author) continue
      await tx`
        insert into message (id, workspace_id, conversation_id, author_id, body, created_at)
        values (${uuidv7()}, ${ws}, ${m.room}, ${author}, ${tx.json(doc(m.text) as never)},
                ${new Date(now - m.minutes * 60_000)})`
    }

    for (const h of HOURS) {
      if (h.by !== author) continue
      const at = TASKS.findIndex((t) => t.title === h.task)
      if (at < 0) throw new Error(`no task called ${h.task}`)
      await tx`
        insert into time_entry (id, workspace_id, project_id, object_type, object_id,
                                actor_id, minutes, spent_on)
        values (${uuidv7()}, ${ws}, ${TASKS[at]!.project}, 'task'::object_kind, ${taskIds[at]!},
                ${author}, ${h.minutes}, ${due(-h.daysAgo)})`
    }
  })
}

await as(dev, async (tx) => {
  /*
   * A read mark is a `conversation_member` row, and so is being in the room.
   * This used to branch on which rooms it knew had one already — the direct
   * room — and insert blindly everywhere else, which is a list that has to
   * be kept in step with the rooms above and was not the moment one of them
   * named its people. One statement that says what it wants either way.
   */
  for (const [room, minutes] of READ) {
    if (minutes === null) continue
    await tx`
      insert into conversation_member (id, workspace_id, conversation_id, actor_id,
                                       created_at, last_read_at)
      values (${uuidv7()}, ${ws}, ${room}, ${dev}, ${ago(20)},
              ${new Date(now - minutes * 60_000)})
      on conflict (conversation_id, actor_id) where deleted_at is null
      do update set last_read_at = excluded.last_read_at`
  }

  /*
   * The feed, written directly rather than through `record()`.
   *
   * `record()` also fires webhooks and publishes to every open socket, which
   * is right for a real change and wrong for a fixture: nobody wants three
   * weeks of history delivered to a receiver the moment the demo is rebuilt.
   *
   * Each line names what it was done to and says what changed, the way a
   * real one does. They pointed at nothing and carried nothing, so the
   * demo's feed read "Yuri Gokoryan changed" — which is what an audit of
   * the screen found, and it was the fixture talking, not the product.
   */
  const task = (title: string) => {
    const at = TASKS.findIndex((t) => t.title === title)
    if (at < 0) throw new Error(`no task called ${title}`)
    return taskIds[at]!
  }
  const post = async (title: string) =>
    (await tx<{ id: string }[]>`select id from post where workspace_id = ${ws} and title = ${title}`)[0]!.id
  const file = async (name: string) =>
    (await tx<{ id: string }[]>`select id from file where workspace_id = ${ws} and name = ${name}`)[0]!.id
  const feed: [actor: string, action: string, type: string, project: string, age: number, object: string, meta?: object][] = [
    [dev, 'project.create', 'project', acme, 24, acme],
    [dev, 'project.member.add', 'project', acme, 24, acme],
    [emily, 'task.create', 'task', acme, 14, task('Lockups at 16, 32 and billboard')],
    [dev, 'post.create', 'post', acme, 6, await post('Round one went out on Tuesday')],
    [emily, 'file.create', 'file', acme, 15, await file('Colour study')],
    [emily, 'task.update', 'task', acme, 5, task('Get the orange to pass AA on white at 16px'),
      { moved_to: 'In Progress', moved_from: 'Todo' }],
    [emily, 'post.create', 'post', site, 4, await post('We are cutting the carousel')],
    [dev, 'task.update', 'task', site, 3, task('Cut the carousel on the home page'), { given_to: 'Emily Brooks' }],
    [dev, 'post.create', 'post', onboarding, 3, await post('New starter on the 6th')],
    [emily, 'task.update', 'task', onboarding, 2, task('Book the studio walk-through'),
      { moved_to: 'Done', moved_from: 'In Progress' }],
    [emily, 'task.update', 'task', acme, 2, task('Lockups at 16, 32 and billboard'), { due: due(4) }],
  ]
  for (const [actor, action, type, project, age, object, meta] of feed) {
    await tx`
      insert into activity_event (id, workspace_id, project_id, actor_id, action,
                                  object_type, object_id, meta, at)
      values (${uuidv7()}, ${ws}, ${project}, ${actor}, ${action},
              ${type}::object_kind, ${object}, ${tx.json((meta ?? {}) as never)}, ${ago(age)})`
  }
})

const token = await issueApiToken(dev, ws, 'local', [], 90)
/* And the agents somebody reading the landing will have, so its picture of
   the tokens is a list and not one row. */
for (const name of ['Claude', 'ChatGPT']) await issueApiToken(dev, ws, name, [], 90)

/* The account to sign in with on a laptop runs the product there too, so
   the admin can be looked at. */
const operators = asOwner()
await makeOperator(operators, dev)
await operators.end()

/*
 * What is addressed to the account — Notifications, split by why
 * (`docs/specs/inbox.md`). Its inbox was empty, so the screen a person opens
 * every morning was the one the demo never showed, on the web and in the
 * apps. Written as the owner: notes are made by the server's own functions
 * and the app's role has nothing to insert with.
 */
const taskNamed = (title: string) => taskIds[TASKS.findIndex((t) => t.title === title)]!
/* Who did each, and what kind of thing — the face and the glyph a row
   wears (`docs/specs/inbox.md`, "Who, and what kind"). A reminder has
   nobody behind it. */
const NOTES: [reason: string, type: string, object: string | 'orange-post', what: string | null,
              minutes: number, read: boolean, by: string | null, kind: string | null][] = [
  ['subscribed', 'task', taskNamed('Get the orange to pass AA on white at 16px'), 'Emily Brooks commented', 8, false, emily, 'commented'],
  ['assigned', 'task', taskNamed('Packaging mock with the second lockup'), 'Sam Carter gave it to you', 50, false, sam, null],
  ['mentioned', 'conversation', acmeTeam, null, 130, false, emily, null],
  ['posted', 'post', 'orange-post', 'Emily Brooks posted', 300, false, emily, 'posted'],
  ['due', 'task', taskNamed('Packaging mock with the second lockup'), 'Due tomorrow', 600, true, null, 'due'],
  ['subscribed', 'task', taskNamed('Drop the gradient from the secondary mark'), 'Sam Carter finished it', 1200, true, sam, 'finished'],
  ['subscribed', 'task', taskNamed('Get the orange to pass AA on white at 16px'), 'Emily Brooks moved it to In Progress', 1500, true, emily, 'moved'],
  ['joined', 'actor', dana, null, 4000, true, dana, null],
]
const notes = asOwner()
const [orange] = await notes<{ id: string }[]>`
  select id from post where workspace_id = ${ws} and title = 'The orange is the open question'`
/* What the comment said, so the note about it has something to quote. */
await notes`
  insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, created_at)
  values (${uuidv7()}, ${ws}, ${acme}, 'task'::object_kind, ${taskNamed('Get the orange to pass AA on white at 16px')}, ${emily},
          ${notes.json(doc('Two steps darker gets it to 4.8:1 on white. I tried it on the packaging mock and it still reads as ours.') as never)},
          ${new Date(now - 8 * 60_000 - 1000)})`
for (const [reason, type, object, what, minutes, read, by, kind] of NOTES) {
  const at = new Date(now - minutes * 60_000)
  const id = object === 'orange-post' ? orange!.id : object
  await notes`
    insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, what,
                              read_at, created_at, deliver_after, delivered_at, by_id, kind)
    values (${uuidv7()}, ${ws}, ${dev}, ${reason}::notify_reason, ${type}::object_kind, ${id},
            ${what}, ${read ? at : null}, ${at}, ${at}, ${at}, ${by}, ${kind})`
}
await notes.end()

console.log(before ? 'Studio:    rebuilt' : 'Studio:    created')
console.log(`           ${PROJECTS.length} projects, ${ROOMS.length} rooms, ` +
            `${TASKS.length} tasks, ${POSTS.length} posts, ${FILES.length} files, ` +
            `${MESSAGES.length} messages`)
console.log(`Sign in:   ${EMAIL} / ${PASSWORD}`)
console.log(`API token: ${token}`)
process.exit(0)
