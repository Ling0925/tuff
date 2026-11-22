/**
 * Generates the contract artifacts from the Zod schemas.
 *
 * The source of truth is the schemas in src/. This file only moves things
 * around: nothing that changes the meaning of the contract belongs here.
 *
 * generated/ is committed. CI regenerates and fails on a non-empty diff, so a
 * schema change without regeneration never reaches main.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  quicktype,
  InputData,
  JSONSchemaInput,
  FetchingJSONSchemaStore,
} from 'quicktype-core'

import * as S from '../src/index.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated')

const ENTITIES: Record<string, z.ZodType> = {
  Actor: S.Actor,
  User: S.User,
  Workspace: S.Workspace,
  Membership: S.Membership,
  Project: S.Project,
  ProjectMember: S.ProjectMember,
  Post: S.Post,
  Task: S.Task,
  // How a task repeats. Named once, so every
  // answer that carries it says the same type.
  Repeat: S.Repeat,
  TaskList: S.TaskList,
  File: S.File,
  Conversation: S.Conversation,
  Message: S.Message,
  Comment: S.Comment,
  Subscription: S.Subscription,
  TimeOnObject: S.TimeOnObject,
  ObjectLink: S.ObjectLink,
  ActivityEvent: S.ActivityEvent,
  Notification: S.Notification,
  Invite: S.Invite,
  ApiToken: S.ApiToken,
  WorkspaceSettings: S.WorkspaceSettings,
}

/**
 * What the endpoints answer with, which is not what the tables hold.
 *
 * A row carries `icon_key` and a response carries `icon_url`; a person
 * arrives as a membership, so `actor_id` rather than `id`. A client decoding
 * `/api/people` against `Actor` gets a field that is not there and misses
 * three that are — which is the mistake the web client made in twelve files
 * before these existed. `shared-schema/src/responses.ts`.
 */
const RESPONSES: Record<string, z.ZodType> = {
  PersonInWorkspace: S.PersonInWorkspace,
  PersonInProject: S.PersonInProject,
  ProjectInList: S.ProjectInList,
  TaskInList: S.TaskInList,
  MessageInRoom: S.MessageInRoom,
  CommentOnObject: S.CommentOnObject,
  PostInList: S.PostInList,
  ActivityLine: S.ActivityLine,
  // What a client reads to stand up at all.
  Count: S.Count,
  Session: S.Session,
  LeftWorkspace: S.LeftWorkspace,
  NowhereSession: S.NowhereSession,
  NowhereMe: S.NowhereMe,
  WaitingInvitations: S.WaitingInvitations,
  Providers: S.Providers,
  Instance: S.Instance,
  InstanceOwner: S.InstanceOwner,
  InstanceLetter: S.InstanceLetter,
  MailSetup: S.MailSetup,
  SetupState: S.SetupState,
  SetupMail: S.SetupMail,
  ServerVersion: S.ServerVersion,
  ServerRelease: S.ServerRelease,
  ServerUpdate: S.ServerUpdate,
  WayIn: S.WayIn,
  WaysIn: S.WaysIn,
  WayInStart: S.WayInStart,
  WayInAdded: S.WayInAdded,
  ApiError: S.ApiError,
  RemovedFrom: S.RemovedFrom,
  WorkspaceInList: S.WorkspaceInList,
  WorkspaceList: S.WorkspaceList,
  MeActor: S.MeActor,
  MeWorkspace: S.MeWorkspace,
  Me: S.Me,
  ProjectPage: S.ProjectPage,
  ListInProject: S.ListInProject,
  ListsInProject: S.ListsInProject,
  TaskPicture: S.TaskPicture,
  TaskInProject: S.TaskInProject,
  TaskPage: S.TaskPage,
  // Where one list stands in a read by list.
  ListPage: S.ListPage,
  MyTask: S.MyTask,
  MyTaskList: S.MyTaskList,
  ConversationInList: S.ConversationInList,
  ConversationList: S.ConversationList,
  MessagePage: S.MessagePage,
  RealtimeEvent: S.RealtimeEvent,
  // The second step: a task whole, the inbox, the search and the people.
  LabelOnTask: S.LabelOnTask,
  PullOnTask: S.PullOnTask,
  Step: S.Step,
  TaskInDetail: S.TaskInDetail,
  TaskRead: S.TaskRead,
  NotificationInInbox: S.NotificationInInbox,
  Inbox: S.Inbox,
  // An agent's question and its answer.
  QuestionChoice: S.QuestionChoice,
  QuestionInInbox: S.QuestionInInbox,
  QuestionAnswer: S.QuestionAnswer,
  SearchResult: S.SearchResult,
  SearchResults: S.SearchResults,
  PeopleList: S.PeopleList,
  ProjectMembers: S.ProjectMembers,
  Created: S.Created,
  AtNumber: S.AtNumber,
  TaskCopied: S.TaskCopied,
  FeedbackSettings: S.FeedbackSettings,
  FeedbackPublic: S.FeedbackPublic,
  RoomHook: S.RoomHook,
  RoomHooks: S.RoomHooks,
  RoomHookAddress: S.RoomHookAddress,
  LabelInProject: S.LabelInProject,
  LabelsInProject: S.LabelsInProject,
  CycleInProject: S.CycleInProject,
  CyclesInProject: S.CyclesInProject,
  Rewait: S.Rewait,
  TaskChanged: S.TaskChanged,
  TaskDuplicated: S.TaskDuplicated,
  StepMade: S.StepMade,
  StepChanged: S.StepChanged,
  TaskDeleted: S.TaskDeleted,
  TimeOnObject: S.TimeOnObject,
  SpendOnTask: S.SpendOnTask,
  TaskReminder: S.TaskReminder,
  TaskReminderSet: S.TaskReminderSet,
  TaskRelated: S.TaskRelated,
  BlockerAdded: S.BlockerAdded,
  ActivityPage: S.ActivityPage,
  TaskPrompt: S.TaskPrompt,
  FileLink: S.FileLink,
  RoomPerson: S.RoomPerson,
  RoomPeople: S.RoomPeople,
  CountOrNone: S.CountOrNone,
  GifKey: S.GifKey,
  Nameable: S.Nameable,
  Nameables: S.Nameables,
  InvitePreview: S.InvitePreview,
  InviteForMe: S.InviteForMe,
  Verified: S.Verified,
  Pending: S.Pending,
  TwoFactor: S.TwoFactor,
  TwoFactorBegun: S.TwoFactorBegun,
  RecoveryCodes: S.RecoveryCodes,
  InboxSettings: S.InboxSettings,
  SessionRow: S.SessionRow,
  Sessions: S.Sessions,
  TokenRow: S.TokenRow,
  Tokens: S.Tokens,
  TokenMade: S.TokenMade,
  TaskCardFace: S.TaskCardFace,
  TaskCard: S.TaskCard,
  LinkPreview: S.LinkPreview,
  PushDevice: S.PushDevice,
  PushDevices: S.PushDevices,
  PushTriedDevice: S.PushTriedDevice,
  PushTried: S.PushTried,
  PasswordChanged: S.PasswordChanged,
  PasswordSet: S.PasswordSet,
  DeletionPlan: S.DeletionPlan,
  WebhookRow: S.WebhookRow,
  Webhooks: S.Webhooks,
  WebhookMade: S.WebhookMade,
  GithubHello: S.GithubHello,
  GithubRepo: S.GithubRepo,
  GithubRepos: S.GithubRepos,
  GithubLink: S.GithubLink,
  ProjectGithub: S.ProjectGithub,
  SlackHello: S.SlackHello,
  SlackChannel: S.SlackChannel,
  SlackChannels: S.SlackChannels,
  SlackLink: S.SlackLink,
  ProjectSlack: S.ProjectSlack,
  TasksImported: S.TasksImported,
  ImportTeam: S.ImportTeam,
  ImportTeams: S.ImportTeams,
  ImportProgress: S.ImportProgress,
  WorkspaceImport: S.WorkspaceImport,
  WorkspaceImports: S.WorkspaceImports,
  MessagesImported: S.MessagesImported,
  FileImported: S.FileImported,
  // What an agent is doing now.
  AgentStatus: S.AgentStatus,
  AgentStatusList: S.AgentStatusList,
  AgentStatusSet: S.AgentStatusSet,
  AgentInRoom: S.AgentInRoom,
  AgentInRoomList: S.AgentInRoomList,
  AgentRow: S.AgentRow,
  AgentList: S.AgentList,
  AgentTokenMade: S.AgentTokenMade,
  AgentReachChanged: S.AgentReachChanged,
  AgentMade: S.AgentMade,
  AgentFacePick: S.AgentFacePick,
  WorkspaceErasing: S.WorkspaceErasing,
  AuditEvent: S.AuditEvent,
  AuditPage: S.AuditPage,
  AuditPeople: S.AuditPeople,
  MeEmail: S.MeEmail,
  WorkspaceAddress: S.WorkspaceAddress,
  WorkspaceMade: S.WorkspaceMade,
  PersonOnPage: S.PersonOnPage,
  OpenOnPerson: S.OpenOnPerson,
  SharedProject: S.SharedProject,
  PersonWeek: S.PersonWeek,
  PersonDay: S.PersonDay,
  PersonHours: S.PersonHours,
  PersonPage: S.PersonPage,
  // What an agent did this week.
  AgentWork: S.AgentWork,
  AgentWorkTask: S.AgentWorkTask,
  AgentWorkTasks: S.AgentWorkTasks,
  InviteRow: S.InviteRow,
  InviteList: S.InviteList,
  InviteMade: S.InviteMade,
  ProjectInBin: S.ProjectInBin,
  ProjectBin: S.ProjectBin,
  HoursByPerson: S.HoursByPerson,
  HoursList: S.HoursList,
  SpendList: S.SpendList,
  PostInProject: S.PostInProject,
  PostPage: S.PostPage,
  PostRead: S.PostRead,
  CommentsPage: S.CommentsPage,
  FileInList: S.FileInList,
  FilesInProject: S.FilesInProject,
  DeletedFile: S.DeletedFile,
  DeletedFilesPage: S.DeletedFilesPage,
  FileInDetail: S.FileInDetail,
  FileRead: S.FileRead,
  FileChanged: S.FileChanged,
  // A document's versions.
  VersionContributor: S.VersionContributor,
  DocVersion: S.DocVersion,
  DocVersionPage: S.DocVersionPage,
  DocVersionRead: S.DocVersionRead,
  DocVersionRestored: S.DocVersionRestored,
  SavedTemplate: S.SavedTemplate,
  SavedTemplates: S.SavedTemplates,
  TemplateChanged: S.TemplateChanged,
  AudienceChanged: S.AudienceChanged,
  LinkBack: S.LinkBack,
  LinksBack: S.LinksBack,
  InboxCodeSent: S.InboxCodeSent,
  DirectMade: S.DirectMade,
  PublicShare: S.PublicShare,
}

/*
 * quicktype's helpers made safe to share across Swift 6's isolation: final,
 * and `JSONAny` — a decoded value nothing writes to again — said to be
 * Sendable by us, because the compiler cannot see through `Any`.
 */
function sendable(swift: string): string {
  return swift
    .replace(/public class JSONNull: Codable, Hashable/, 'public final class JSONNull: Codable, Hashable, Sendable')
    .replace(/(public )?class JSONCodingKey: CodingKey/, 'final class JSONCodingKey: CodingKey, Sendable')
    .replace(/public class JSONAny: Codable/, 'public final class JSONAny: Codable, @unchecked Sendable')
}

/*
 * Every type inside `enum API`.
 *
 * The schema's names are Swift's own as well — `Task` is concurrency,
 * `Actor` a protocol, `Notification` Foundation's — and a model of the same
 * name at the top level of a module shadows them in every file that imports
 * it. `API.Task` is the task; `Task { }` stays what Swift means by it.
 */
function namespaced(swift: string): string {
  const lines = sendable(swift).split('\n')
  const imports = lines.filter((l) => l.startsWith('import '))
  const body = lines.filter((l) => !l.startsWith('import '))
  while (body.length && body[body.length - 1] === '') body.pop()
  return [...imports, '', 'public enum API {', ...body.map((l) => (l ? `    ${l}` : l)), '}', ''].join('\n')
}

/*
 * Kotlin the Android app compiles as it stands.
 *
 * quicktype says a count — a number, or the string `count(*)` arrives as —
 * as a sealed class with no serializer, which kotlinx refuses to compile
 * inside a `@Serializable` class, or reads as polymorphic and asks the
 * answer for a `type` it never has. It is one number whichever way it came,
 * so it is one value class read from either; a count that may be absent is
 * the same count, nullable where the field already is. And the package is
 * the app's rather than `quicktype`.
 */
const KOTLIN_COUNT = `/** A count as the server answers it — a number, or the string Postgres's \`count(*)\` arrives as. */
@Serializable(with = CountSerializer::class)
@JvmInline
value class Count(val value: Double) {
    val int: Int get() = value.toInt()
}

/** A count that may not have been kept: the same count, on a field that is nullable already. */
typealias CountOrNone = Count

object CountSerializer : KSerializer<Count> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Count", PrimitiveKind.DOUBLE)
    override fun deserialize(decoder: Decoder): Count {
        val primitive = (decoder as JsonDecoder).decodeJsonElement().jsonPrimitive
        return Count(primitive.doubleOrNull ?: primitive.content.toDoubleOrNull() ?: 0.0)
    }
    override fun serialize(encoder: Encoder, value: Count) = encoder.encodeDouble(value.value)
}
`

function kotlinReadable(kotlin: string): string {
  const unions = /(?:@Serializable\n)?sealed class (Count|CountOrNone) \{\n(?: {4}class .*\n)+\}\n\n/g
  const found = kotlin.match(unions) ?? []
  if (found.length !== 2) throw new Error(`Expected Count and CountOrNone as sealed classes, found ${found.length}`)
  return kotlin
    .replace(/\/\/ To parse the JSON[\s\S]*?\n\n(?=@file)/, '')
    .replace(/^package quicktype$/m, 'package com.usetuff.api')
    .replace(unions, '')
    .replace(/\nobject LocalDateSerializer/, `\n${KOTLIN_COUNT}\nobject LocalDateSerializer`)
}

/*
 * One document, every definition in it, and a definition used inside
 * another said as a reference to it.
 *
 * Each schema was serialised on its own, so a list's envelope carried its
 * own copy of the row: `MessagePage.messages` came out as a fresh
 * `MessageElement` rather than `[MessageInRoom]`, and every page was a
 * second type for something that already had a name. Registered together,
 * `messages` is `{ $ref: '#/$defs/MessageInRoom' }`.
 */
function toDefinitions(all: Record<string, z.ZodType>): Record<string, unknown> {
  const registry = z.registry<{ id: string }>()
  for (const [name, schema] of Object.entries(all)) registry.add(schema, { id: name })
  let out: { schemas: Record<string, Record<string, unknown>> }
  try {
    out = z.toJSONSchema(registry, {
      target: 'draft-2020-12',
      io: 'input',
      uri: (id) => `#/$defs/${id}`,
    }) as typeof out
  } catch (cause) {
    throw new Error('Could not serialise the schema', { cause })
  }
  /* Titled, because a title is what quicktype names a type by — without
     one, a type reached by reference is named after the field it was
     reached from. */
  return Object.fromEntries(
    Object.entries(out.schemas).map(([name, { $schema: _s, $id: _i, ...rest }]) => [name, { title: name, ...rest }]),
  )
}

function buildDocument(responses: Record<string, z.ZodType>) {
  const defs = toDefinitions({ ...ENTITIES, ...responses })

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'API contract',
    api_version: S.API_VERSION,
    $defs: defs,
    // The permission matrix is data, not prose: a client renders buttons from
    // it, and the server decides with the same table.
    'x-actions': S.Action.options,
    'x-never-via-mcp': S.NEVER_VIA_MCP,
    'x-default-settings': S.DEFAULT_SETTINGS,
  }
}

async function renderLanguage(
  lang: 'swift' | 'kotlin',
  defs: Record<string, unknown>,
  rendererOptions: Record<string, string>,
): Promise<string> {
  /*
   * One document whose root holds every type by reference, so a type
   * reached from two places is one type and not two.
   *
   * A source per type read its own copy of the document, and an entry
   * into one document per type still came out with a second type for
   * every reference — `MessagePage.messages: [MessageElement]` beside
   * `MessageInRoom`. Reached only through references, each is one type,
   * named by its title. The root itself is `Contract`, which nothing reads.
   */
  const input = new JSONSchemaInput(new FetchingJSONSchemaStore())
  await input.addSource({
    name: 'Contract',
    schema: JSON.stringify({
      $defs: defs,
      type: 'object',
      properties: Object.fromEntries(Object.keys(defs).map((name) => [name, { $ref: `#/$defs/${name}` }])),
    }),
  })
  const inputData = new InputData()
  inputData.addInput(input)

  const { lines } = await quicktype({
    inputData,
    lang,
    rendererOptions,
    inferEnums: false,
    inferDateTimes: false,
  })
  return lines.join('\n') + '\n'
}

async function write(out: string, responses: Record<string, z.ZodType>) {
  mkdirSync(out, { recursive: true })

  const doc = buildDocument(responses)
  writeFileSync(join(out, 'api.schema.json'), JSON.stringify(doc, null, 2) + '\n')

  // Entities and the shapes they arrive in. The permission table is data and
  // stays out: clients read it from the JSON Schema rather than as types.
  const shape = Object.fromEntries(
    [...Object.keys(ENTITIES), ...Object.keys(responses)].map((n) => [n, doc.$defs[n]]),
  ) as Record<string, unknown>

  const header = (lang: string) =>
    `// Generated from shared-schema. Do not edit by hand.\n` +
    `// Source: docs/api.md, API version ${S.API_VERSION}.\n` +
    `// Regenerate with: pnpm generate (${lang})\n\n`

  /*
   * Swift a client can use as it stands: Codable under the wire's own keys,
   * public, Sendable for Swift 6. `just-types` was structs with nothing to
   * decode them, which no app could read a single answer with.
   * `optional-enums` would read a case the client has not heard of as nil,
   * and needs a package for it; the answers a client stands up on say their
   * open-ended words as strings instead.
   */
  const swift = await renderLanguage('swift', shape, {
    'just-types': 'false',
    'struct-or-class': 'struct',
    'access-level': 'public',
    sendable: 'true',
    'coding-keys': 'true',
    initializers: 'false',
    density: 'dense',
    protocol: 'none',
  })
  writeFileSync(join(out, 'Protocol.swift'), header('swift') + namespaced(swift))
  writeFileSync(
    join(out, 'Protocol.kt'),
    header('kotlin') + kotlinReadable(await renderLanguage('kotlin', shape, { framework: 'kotlinx' })),
  )
  return doc
}

const doc = await write(OUT, RESPONSES)
console.log(
  `generated/: ${Object.keys(doc.$defs).length} definitions, ` +
    `${doc['x-actions'].length} actions, API version ${S.API_VERSION}`,
)
