import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Action, DEFAULT_SETTINGS, NEVER_UNPROVED, NEVER_VIA_MCP, Role, can, type PermissionInput } from '../src/index.js'

/**
 * Two columns, two roles, and no third sort of person.
 *
 * Client, then guest, then admin were all categories, and each was taken
 * back. What somebody may do on a project is a list of permissions they were
 * given, tested below on its own.
 */
type Who = Role
const WHO: Who[] = [...Role.options]

/* The rows that left the fixed table: they belong to a project now, and the
   matrix below is about the workspace. `RUNNING_A_PROJECT` in the source,
   and its own test further down. */

const base = (who: Who, over: Partial<PermissionInput> = {}): PermissionInput => ({
  role: who,
  settings: DEFAULT_SETTINGS,
  inProject: true,
  joined: true,
  isAuthor: true,
  ...over,
})

/**
 * The permission matrix, row by row. It is not documentation of the code — it is
 * the input, and this is where the two are held against each other.
 */
const MATRIX: [Action, Record<Who, boolean>][] = [
  ['workspace.billing', { owner: true, member: false }],
  ['workspace.transfer', { owner: true, member: false }],
  ['workspace.delete', { owner: true, member: false }],
  ['people.invite', { owner: true, member: false }],
  ['people.role', { owner: true, member: false }],
  ['project.create', { owner: true, member: true }],
  ['project.archive', { owner: true, member: false }],
  ['project.member.add', { owner: true, member: true }],
  // Adding is ordinary work; taking off is running the project.
  ['project.member.remove', { owner: true, member: false }],
  // Taking yourself off is anybody's on the project — "Leaving is your own".
  ['project.leave', { owner: true, member: true }],
  ['project.tools', { owner: true, member: false }],
  ['content.create', { owner: true, member: true }],
  ['activity.read', { owner: true, member: true }],
  ['time.own', { owner: true, member: true }],
  ['time.any', { owner: true, member: false }],
  ['token.issue.own', { owner: true, member: true }],
  ['token.revoke.any', { owner: true, member: false }],
  ['audit.read', { owner: true, member: false }],
  ['task.remind', { owner: true, member: true }],
]

for (const [action, expected] of MATRIX) {
  test(`matrix: ${action}`, () => {
    for (const who of WHO) {
      assert.equal(can(action, base(who)), expected[who], `${who} on ${action}`)
    }
  })
}

/*
 * What somebody may do on one project, granted one at a time.
 *
 * No sort of person: a member with `manage` and a member without it are the
 * same kind of thing holding different lists.
 */
test('a permission is held per project, not by being a kind of person', () => {
  const runs = { rights: ['manage'] }
  for (const action of ['project.archive', 'project.member.remove', 'project.tools', 'time.any'] as const) {
    assert.equal(can(action, base('member', runs)), true, `holds manage: ${action}`)
    assert.equal(can(action, base('member')), false, `holds nothing: ${action}`)
  }
  // Editing what somebody else wrote is its own permission, and the
  // workspace can also open it to every member with a switch.
  assert.equal(can('content.edit.any', base('member', { rights: ['edit.any'] })), true)
})

/*
 * The four that were asked for separately, and are answered separately.
 *
 * They were stored, shown and granted for a while and checked nowhere: the
 * endpoints asked the one general `content.create`, so a box somebody had
 * deliberately left unticked decided nothing. A permission that decides
 * nothing is worse than a missing one — whoever withheld it believes they
 * withheld something.
 */
test('making and deleting are four permissions, not one', () => {
  const each = [
    ['task.create', 'task.create'],
    ['task.delete', 'task.delete'],
    ['channel.create', 'channel.create'],
    ['channel.delete', 'channel.delete'],
  ] as const

  for (const [action, right] of each) {
    assert.equal(can(action, base('member', { rights: [right] })), true, `holds ${right}`)
    assert.equal(can(action, base('member')), false, `holds nothing: ${action}`)
    // And holding one is not holding the next.
    for (const [other] of each) {
      if (other === action) continue
      assert.equal(can(other, base('member', { rights: [right] })), false, `${right} must not carry ${other}`)
    }
  }

  // Whoever runs the project is not asked to grant themselves any of them.
  for (const [action] of each) {
    assert.equal(can(action, base('member', { rights: ['manage'] })), true, `manage: ${action}`)
    assert.equal(can(action, base('owner')), true, `owner: ${action}`)
  }
})

/* Somebody else's row in Docs goes by the right that deletes somebody
   else's task — not by editing, and never by a tool or an agent. */
test('deleting others’ documents is the task.delete right', () => {
  assert.equal(can('file.delete', base('member', { rights: ['task.delete'] })), true)
  assert.equal(can('file.delete', base('member', { rights: ['manage'] })), true)
  assert.equal(can('file.delete', base('owner')), true)
  assert.equal(can('file.delete', base('member', { rights: ['edit.any', 'task.create', 'channel.delete'] })), false)
  assert.equal(can('file.delete', base('member', { inProject: false, rights: [] })), false)
  assert.equal(can('file.delete', base('owner', { viaMcp: true })), false)
  assert.equal(can('file.delete', base('member', { agent: true, rights: ['task.delete'] })), false)
})

/* Who a document is for: its author's, and whoever may edit somebody
   else's — never a tool's or an agent's. */
test('choosing who reads a document is its author’s and its editors’', () => {
  assert.equal(can('file.share', base('member', { isAuthor: true })), true)
  assert.equal(can('file.share', base('member', { isAuthor: false })), true, 'the switch lets members edit documents')
  const ownOnly = { ...DEFAULT_SETTINGS, edit_others_content: 'own_only' as const }
  assert.equal(can('file.share', { ...base('member', { isAuthor: false }), settings: ownOnly }), false)
  assert.equal(can('file.share', { ...base('member', { isAuthor: false, rights: ['edit.any'] }), settings: ownOnly }), true)
  assert.equal(can('file.share', { ...base('owner', { isAuthor: false }), settings: ownOnly }), true)
  assert.equal(can('file.share', base('member', { isAuthor: true, inProject: false })), false)
  assert.equal(can('file.share', base('owner', { isAuthor: true, viaMcp: true })), false)
  assert.equal(can('file.share', base('member', { isAuthor: true, agent: true })), false)
})

test('a permission held on a project is not held outside one', () => {
  const off = { inProject: false, rights: [] as string[] }
  for (const action of ['task.create', 'task.delete', 'channel.create', 'channel.delete'] as const) {
    assert.equal(can(action, { ...base('member'), ...off }), false, `member, no project: ${action}`)
    // The owner administers the workspace without joining every project.
    assert.equal(can(action, { ...base('owner'), ...off }), true, `owner, no project: ${action}`)
  }
})

/*
 * Deleting is not something a tool does on its own.
 *
 * Project content is data, not instructions, and a task whose description
 * asks for the channel to be cleared is exactly the shape that arrives.
 * Making things through a tool is useful and reversible; removing them is
 * neither, so the two are not one permission.
 */
test('a tool may make these and may not remove them', () => {
  const viaMcp = { viaMcp: true, rights: ['task.create', 'task.delete', 'channel.create', 'channel.delete', 'manage'] }
  assert.equal(can('task.create', base('owner', viaMcp)), true)
  assert.equal(can('channel.create', base('owner', viaMcp)), true)
  assert.equal(can('task.delete', base('owner', viaMcp)), false)
  assert.equal(can('channel.delete', base('owner', viaMcp)), false)
  // A colleague may be put on a project through one; nobody is taken off.
  assert.equal(can('project.member.add', base('owner', viaMcp)), true)
  assert.equal(can('project.member.remove', base('owner', viaMcp)), false)
  // Nor by an agent, whatever it was given.
  assert.equal(can('project.member.remove', base('member', { agent: true, rights: ['manage'] })), false)
})

/*
 * A token made for some projects. On its own
 * projects it is its person; about any other project, and about the
 * workspace as a whole, it is nobody.
 */
test('a token made for some projects does nothing outside them, nor about the workspace', () => {
  const limited = { viaMcp: true, tokenLimited: true, inProject: true, rights: ['task.create', 'manage'] }
  assert.equal(can('task.create', base('owner', limited)), true)
  assert.equal(can('content.create', base('member', limited)), true)
  for (const action of [
    'task.create',
    'content.create',
    'content.edit.own',
    'content.edit.any',
    'project.member.add',
    'time.own',
  ] as const) {
    assert.equal(can(action, base('owner', { ...limited, outsideToken: true })), false, action)
  }
  for (const action of [
    'project.create',
    'channel.create.workspace',
    'members.read',
    'people.invite',
    'audit.read',
    'agent.connect',
    'token.issue.own',
  ] as const) {
    assert.equal(can(action, base('owner', limited)), false, action)
  }
  // People are still readable: a task is given to somebody by name.
  assert.equal(can('people.read', base('member', limited)), true)
  // A token for every project is as it was.
  assert.equal(can('project.create', base('owner', { viaMcp: true })), true)
})

test('the owner holds everything, on every project, without being on one', () => {
  for (const action of ['project.archive', 'project.member.remove', 'project.tools', 'time.any'] as const) {
    assert.equal(can(action, base('owner', { inProject: false })), true, action)
  }
})

test('switch: only the owner creates projects', () => {
  const settings = { ...DEFAULT_SETTINGS, who_creates_projects: 'owner' as const }
  assert.equal(can('project.create', base('member', { settings })), false)
  assert.equal(can('project.create', base('owner', { settings })), true)
})

test('switch: members may invite when the workspace says so', () => {
  const settings = { ...DEFAULT_SETTINGS, who_invites_people: 'members' as const }
  assert.equal(can('people.invite', base('member')), false)
  assert.equal(can('people.invite', base('member', { settings })), true)
})

test('switch: the Members screen, and not the people in it', () => {
  // Open to everyone until the owner says otherwise — what it did before.
  assert.equal(can('members.read', base('member')), true)
  const settings = { ...DEFAULT_SETTINGS, who_sees_members: 'owner' as const }
  assert.equal(can('members.read', base('member', { settings })), false)
  assert.equal(can('members.read', base('owner', { settings })), true)
  // Who is in the workspace is another question: the pickers still ask it.
  assert.equal(can('people.read', base('member', { settings })), true)
})

test("the owner's word about one person wins over the Members and invite switches", () => {
  // `docs/specs/member-rights.md`: null follows the switch, a word beats it.
  const closed = { ...DEFAULT_SETTINGS, who_sees_members: 'owner' as const }
  assert.equal(can('members.read', base('member', { settings: closed, maySeeMembers: true })), true)
  assert.equal(can('members.read', base('member', { maySeeMembers: false })), false)
  assert.equal(can('members.read', base('member', { settings: closed, maySeeMembers: null })), false)

  assert.equal(can('people.invite', base('member', { mayInvitePeople: true })), true)
  const open = { ...DEFAULT_SETTINGS, who_invites_people: 'members' as const }
  assert.equal(can('people.invite', base('member', { settings: open, mayInvitePeople: false })), false)
  // An owner always may, and a tool never invites whatever was said.
  assert.equal(can('people.invite', base('owner', { mayInvitePeople: false })), true)
  assert.equal(can('people.invite', base('member', { mayInvitePeople: true, viaMcp: true })), false)
})

test("switch: editing other people's content", () => {
  assert.equal(can('content.edit.any', base('member')), true)
  const settings = { ...DEFAULT_SETTINGS, edit_others_content: 'own_only' as const }
  assert.equal(can('content.edit.any', base('member', { settings })), false)
  // An owner is never narrowed by the switch: it is about members.
  assert.equal(can('content.edit.any', base('owner', { settings })), true)
})

test('the switch does not reach what somebody said', () => {
  /*
   * The permission matrix says "only your own, and others' documents behind
   * the switch": the switch lets a member edit another person's **document**, and that is all
   * it was ever about. A comment is not a document — it is speech with a
   * name on it, and rewriting it leaves that name underneath.
   */
  assert.equal(can('content.edit.any', base('member')), true)
  assert.equal(can('content.edit.said', base('member')), false)
  // The owner, and whoever runs the project, still can.
  assert.equal(can('content.edit.said', base('owner')), true)
  assert.equal(can('content.edit.said', base('member', { rights: ['manage'] })), true)
  assert.equal(can('content.edit.said', base('member', { rights: ['edit.any'] })), true)
})

test('a member outside a project has no rights inside it', () => {
  for (const action of ['content.create', 'project.member.add', 'time.own'] as Action[]) {
    assert.equal(can(action, base('member', { inProject: false })), false, action)
  }
})

test('an owner runs a project without joining it', () => {
  // Otherwise administering a workspace means adding yourself to everything,
  // which is a worse default than the one it protects against.
  assert.equal(can('project.archive', base('owner', { inProject: false })), true)
  assert.equal(can('project.tools', base('owner', { inProject: false })), true)
})

test('the hard stop holds through MCP even for an owner', () => {
  // The owner holds everything, which is exactly why this is the case worth
  // asserting: a token borrows a person's rights entirely.
  // An owner who also runs the product and owns the server, so `operator`
  // and `instance` are in hand to lose.
  for (const action of NEVER_VIA_MCP) {
    assert.equal(
      can(action, base('owner', { operator: true, instanceOwner: true, connectedIt: true })),
      true,
      `${action} should be allowed in person`,
    )
    assert.equal(
      can(action, base('owner', { viaMcp: true, operator: true, instanceOwner: true, connectedIt: true })),
      false,
      `${action} survived into an MCP call`,
    )
  }
})

test('every action is reachable by somebody', () => {
  // An action nobody can perform is either a typo or a feature nobody built.
  // `operator` is held by no role, and is reachable by an operator alone;
  // `instance` likewise by whoever owns the server; `question.ask` by an agent.
  for (const action of Action.options) {
    const anyone = Role.options.some(
      (role) =>
        can(action, base(role)) ||
        can(action, base(role, { connectedIt: true })) ||
        can(action, base(role, { operator: true })) ||
        can(action, base(role, { instanceOwner: true })) ||
        can(action, base(role, { agent: true, viaMcp: true, plan: 'team' })),
    )
    assert.ok(anyone, `${action} is granted to no role at all`)
  }
})

test('running the product is no role’s, not even the owner’s', () => {
  // A workspace gives roles; only the deployment
  // makes an operator.
  for (const role of Role.options) {
    assert.equal(can('operator', base(role)), false, `${role} reached the admin`)
    assert.equal(can('operator', base(role, { operator: true })), true)
    assert.equal(can('operator', base(role, { operator: true, viaMcp: true })), false)
  }
})

test('owning the server is no role’s either, and never through a token or for an agent', () => {
  // The first account on a server of one's own,
  // or whoever an owner named — no workspace makes one.
  for (const role of Role.options) {
    assert.equal(can('instance', base(role)), false, `${role} reached the server's settings`)
    assert.equal(can('instance', base(role, { operator: true })), false, 'an operator is not a server owner')
    assert.equal(can('instance', base(role, { instanceOwner: true })), true)
    assert.equal(can('instance', base(role, { instanceOwner: true, viaMcp: true })), false)
    assert.equal(can('instance', base(role, { instanceOwner: true, agent: true })), false)
    assert.equal(can('instance', base(role, { instanceOwner: true, tokenLimited: true })), false)
  }
})

test('an agent is managed by whoever connected it alone, and taken away by the owner too; never through a token or by an agent', () => {
  // Its face, name, token and reach are its connector's.
  assert.equal(can('agent.manage', base('owner')), false, 'not the owner, for somebody else’s agent')
  assert.equal(can('agent.manage', base('owner', { connectedIt: true })), true)
  assert.equal(can('agent.manage', base('member')), false)
  assert.equal(can('agent.manage', base('member', { connectedIt: true })), true)
  assert.equal(can('agent.manage', base('owner', { connectedIt: true, viaMcp: true, plan: 'team' })), false)
  assert.equal(can('agent.manage', base('member', { connectedIt: true, agent: true })), false)
  // Taking it away hands nothing over: the owner's too.
  assert.equal(can('agent.remove', base('owner')), true)
  assert.equal(can('agent.remove', base('member')), false)
  assert.equal(can('agent.remove', base('member', { connectedIt: true })), true)
  // Not the plan's: an agent left on a plan without agents is still somebody's to disconnect.
  assert.equal(can('agent.remove', base('member', { connectedIt: true, plan: 'solo' })), true)
  assert.equal(can('agent.remove', base('owner', { viaMcp: true, plan: 'team' })), false)
  assert.equal(can('agent.remove', base('member', { connectedIt: true, agent: true })), false)
})

test('an agent’s week is read where the Members screen is open, or by whoever connected it', () => {
  const closed = { ...DEFAULT_SETTINGS, who_sees_members: 'owner' as const }
  assert.equal(can('agent.work.read', base('owner')), true)
  assert.equal(can('agent.work.read', base('member')), true)
  assert.equal(can('agent.work.read', base('member', { settings: closed })), false)
  assert.equal(can('agent.work.read', base('member', { settings: closed, connectedIt: true })), true)
  assert.equal(can('agent.work.read', base('member', { settings: closed, maySeeMembers: true })), true)
  // Never an agent, never a token made for some projects.
  assert.equal(can('agent.work.read', base('member', { agent: true, viaMcp: true, plan: 'team', connectedIt: true })), false)
  assert.equal(can('agent.work.read', base('owner', { tokenLimited: true, connectedIt: true })), false)
})

/*
 * Leaving is anybody's who is on the project, and asks for nothing they
 * were given there.
 */
test('somebody on a project may leave it, and nobody leaves what they are not on', () => {
  // No rights at all, and still a way out.
  assert.equal(can('project.leave', base('member', { rights: [] })), true)
  // Not on its list: the owner sees every project and has none of them to leave.
  assert.equal(can('project.leave', base('owner', { joined: false })), false)
  assert.equal(can('project.leave', base('member', { joined: false })), false)
  // Unsaid is not on it.
  const { joined: _, ...unsaid } = base('member')
  assert.equal(can('project.leave', unsaid), false)
  // A person's decision, as taking somebody else off is: never through a
  // token, never by an agent.
  assert.equal(NEVER_VIA_MCP.includes('project.leave'), true)
  assert.equal(can('project.leave', base('member', { viaMcp: true })), false)
  assert.equal(can('project.leave', base('member', { agent: true, rights: ['manage'] })), false)
  // And it is not taking somebody else off.
  assert.equal(can('project.member.remove', base('member')), false)
})

/*
 * Leaving. The workspace is a member's to leave,
 * in person; the owner hands it over first. A channel is anybody's to
 * leave, in person. Neither through a token, neither by an agent.
 */
test('leaving the workspace is a member’s, in person, and leaving a channel is anybody’s', () => {
  assert.equal(can('workspace.leave', base('member')), true)
  assert.equal(can('workspace.leave', base('owner')), false)
  assert.equal(can('workspace.leave', base('member', { viaMcp: true })), false)
  assert.equal(can('workspace.leave', base('member', { agent: true, viaMcp: true, plan: 'team' })), false)
  assert.equal(can('workspace.leave', base('member', { tokenLimited: true })), false)

  for (const who of WHO) assert.equal(can('channel.leave', base(who)), true, `${who} may leave a channel`)
  assert.equal(NEVER_VIA_MCP.includes('channel.leave'), true)
  assert.equal(can('channel.leave', base('member', { viaMcp: true })), false)
  assert.equal(can('channel.leave', base('member', { agent: true, viaMcp: true, plan: 'team' })), false)
})

/*
 * A board's link. Its tasks, its comments
 * and its name, and nothing else whatever the role, the plan or the rights
 * say: the list is closed, so an action added next year is refused to it.
 */
test('a board’s link may make and change tasks and nothing else', () => {
  const board = { board: true, inProject: true, rights: ['task.create', 'task.delete', 'manage'] }
  for (const action of ['task.create', 'content.create', 'content.edit.own', 'content.edit.any'] as const) {
    assert.equal(can(action, base('member', board)), true, action)
  }
  for (const action of Action.options.filter(
    (a) => !['task.create', 'content.create', 'content.edit.own', 'content.edit.any'].includes(a),
  )) {
    assert.equal(can(action, base('owner', { ...board, operator: true, plan: 'unlimited' })), false, action)
  }
})

test('a feedback page is set up by whoever runs the project, on a paid plan, by a person', () => {
  assert.equal(can('feedback.manage', base('owner', { plan: 'team' })), true)
  assert.equal(can('feedback.manage', base('member', { plan: 'team', rights: ['manage'], inProject: true })), true)
  assert.equal(can('feedback.manage', base('member', { plan: 'team', rights: ['task.create'], inProject: true })), false)
  assert.equal(can('feedback.manage', base('owner', { plan: 'team', viaMcp: true })), false)
  assert.equal(can('feedback.manage', base('member', { plan: 'team', rights: ['manage'], inProject: true, agent: true })), false)
  // The page's own actor files a task and does nothing else, whatever it holds.
  const page = base('member', { feedbackPage: true, rights: ['manage'], inProject: true, onItsPage: true })
  assert.equal(can('task.create', page), true)
  // And only on its own page's project.
  assert.equal(can('task.create', { ...page, onItsPage: false }), false)
  const { onItsPage: _mine, ...unsaid } = page
  assert.equal(can('content.create', unsaid), false)
  assert.equal(can('feedback.manage', page), false)
  assert.equal(can('content.edit.any', page), false)
})

test('a reminder is for a person, through a token too, and never an agent’s or a link’s', () => {
  // Anybody who can see the task, which the
  // database decides — so a project they are not on is not asked here.
  for (const role of Role.options) {
    assert.equal(can('task.remind', base(role, { inProject: false })), true)
    assert.equal(can('task.remind', base(role, { viaMcp: true, plan: 'team' })), true, `${role} through MCP`)
    assert.equal(can('task.remind', base(role, { agent: true })), false, `${role} as an agent`)
    assert.equal(can('task.remind', base(role, { board: true })), false, `${role} on a board`)
    assert.equal(can('task.remind', base(role, { feedbackPage: true, onItsPage: true })), false, `${role} on a feedback page`)
  }
})

test('an unproved address is a member and no more, whatever its role says', () => {
  // Nothing that outlives the proof.
  for (const role of Role.options) {
    for (const action of NEVER_UNPROVED) {
      assert.equal(
        can(
          action,
          base(role, {
            unproved: true,
            operator: true,
            instanceOwner: true,
            settings: { ...DEFAULT_SETTINGS, who_invites_people: 'members' },
          }),
        ),
        false,
        `${role} unproved may ${action}`,
      )
    }
    for (const action of Action.options.filter((a) => !NEVER_UNPROVED.includes(a))) {
      assert.equal(can(action, base(role, { unproved: true })), can(action, base('member')), `${role} unproved and ${action}`)
    }
  }
  // Proved, making and entering workspaces is anybody's in person.
  for (const role of Role.options) {
    assert.equal(can('workspace.create', base(role)), true)
    assert.equal(can('workspace.enter', base(role)), true)
    assert.equal(can('workspace.create', base(role, { viaMcp: true })), false)
  }
})

test('a room’s incoming webhooks are for whoever may run the room, in person', () => {
  assert.equal(can('hook.manage', base('owner')), true)
  assert.equal(can('hook.manage', base('owner', { inProject: false })), true)
  // In a project's channel: channel.create there, or running the project.
  assert.equal(can('hook.manage', base('member', { rights: ['channel.create'] })), true)
  assert.equal(can('hook.manage', base('member', { rights: ['manage'] })), true)
  assert.equal(can('hook.manage', base('member', { rights: ['task.create'] })), false)
  assert.equal(can('hook.manage', base('member', { rights: [] })), false)
  // Kept from opening channels anywhere: no hooks either.
  assert.equal(can('hook.manage', base('member', { rights: ['manage'], mayCreateChannels: false })), false)
  // A channel outside every project: any member the owner did not stop.
  assert.equal(can('hook.manage', base('member', { inProject: false })), true)
  assert.equal(can('hook.manage', base('member', { inProject: false, mayCreateChannels: false })), false)
  // Never through a token, never an agent, never a limited token or an unproved address.
  assert.equal(can('hook.manage', base('owner', { viaMcp: true, plan: 'team' })), false)
  assert.equal(can('hook.manage', base('member', { rights: ['manage'], agent: true })), false)
  assert.equal(can('hook.manage', base('owner', { tokenLimited: true })), false)
  assert.equal(can('hook.manage', base('owner', { unproved: true })), false)
  assert.equal(can('hook.manage', base('owner', { board: true })), false)
})

/* An agent asks, a person answers. */
test('only an agent asks with choices, and only a person answers', () => {
  for (const role of ['owner', 'member'] as const) {
    assert.equal(can('question.ask', base(role)), false, `${role} in person`)
    assert.equal(can('question.ask', base(role, { viaMcp: true, plan: 'team' })), false, `${role} through a token`)
    assert.equal(can('question.ask', base(role, { agent: true, viaMcp: true, plan: 'team' })), true, `${role} agent`)
    assert.equal(can('question.answer', base(role)), true, `${role} answers`)
    assert.equal(can('question.answer', base(role, { viaMcp: true, plan: 'team' })), false, `${role} through a token`)
    assert.equal(can('question.answer', base(role, { agent: true })), false, `${role} as an agent`)
  }
  assert.equal(can('question.ask', base('member', { agent: true, viaMcp: true, plan: 'team', inProject: false })), false)
  assert.equal(can('question.answer', base('member', { inProject: false })), false)
})

/* Only an agent says what it is doing. */
test('only an agent says what it is doing', () => {
  for (const role of ['owner', 'member'] as const) {
    assert.equal(can('agent.status', base(role)), false, `${role} in person`)
    assert.equal(can('agent.status', base(role, { viaMcp: true, plan: 'team' })), false, `${role} through a token`)
    assert.equal(can('agent.status', base(role, { agent: true, viaMcp: true, plan: 'team' })), true, `${role} agent`)
  }
})
