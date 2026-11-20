import type { Zip } from './zip.js'
import { SLACK } from '../words/slack.js'

/**
 * A Slack export, read for one channel's history.
 */
export type SlackChannel = { name: string; days: string[] }
export type Brought = {
  key: string
  name: string
  email?: string
  text: string
  at: string
  parent_key?: string
  /** What it carried, to be fetched from Slack by the server. */
  files?: SlackFile[]
}
export type SlackFile = { name: string; url: string; width?: number; height?: number }

type Person = { name: string; email?: string }

/** The channels it holds, public and private, with their days. */
export async function channelsOf(zip: Zip): Promise<SlackChannel[]> {
  const listed: { name?: string }[] = []
  for (const file of ['channels.json', 'groups.json']) {
    const text = await zip.text(file)
    if (text) listed.push(...(JSON.parse(text) as { name?: string }[]))
  }
  return listed
    .filter((c): c is { name: string } => typeof c.name === 'string')
    .map((c) => ({
      name: c.name,
      days: zip.names.filter((n) => n.startsWith(`${c.name}/`) && n.endsWith('.json')).sort(),
    }))
    .filter((c) => c.days.length > 0)
    .sort((a, b) => b.days.length - a.days.length)
}

async function peopleOf(zip: Zip): Promise<Map<string, Person>> {
  const people = new Map<string, Person>()
  const text = await zip.text('users.json')
  if (!text) return people
  for (const u of JSON.parse(text) as {
    id: string
    name?: string
    real_name?: string
    profile?: { real_name?: string; display_name?: string; email?: string }
  }[]) {
    const name = u.profile?.real_name || u.real_name || u.profile?.display_name || u.name || SLACK.someone
    people.set(u.id, { name, ...(u.profile?.email ? { email: u.profile.email } : {}) })
  }
  return people
}

/** What is not somebody saying something: joins, leaves, the topic. */
const NOT_SAID = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
  'group_topic',
  'group_purpose',
  'group_name',
  'pinned_item',
  'unpinned_item',
])

/** Slack's markup, read: names for ids, words for links, characters for entities. */
function words(text: string, people: Map<string, Person>): string {
  return text
    .replace(/<@([A-Z0-9]+)(\|[^>]*)?>/g, (_, id: string) => `@${people.get(id)?.name ?? SLACK.someoneMentioned}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(mailto:)?([^|>]+)>/g, '$2')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** One channel's messages, oldest first, threads kept. */
export async function messagesOf(zip: Zip, channel: SlackChannel): Promise<Brought[]> {
  const people = await peopleOf(zip)
  const out: Brought[] = []
  for (const day of channel.days) {
    const text = await zip.text(day)
    if (!text) continue
    for (const m of JSON.parse(text) as {
      ts?: string
      thread_ts?: string
      subtype?: string
      user?: string
      username?: string
      bot_profile?: { name?: string }
      user_profile?: { real_name?: string }
      text?: string
      files?: {
        name?: string
        title?: string
        url_private_download?: string
        url_private?: string
        original_w?: number
        original_h?: number
      }[]
    }[]) {
      if (!m.ts || (m.subtype && NOT_SAID.has(m.subtype))) continue
      const who = (m.user && people.get(m.user)) || {
        name: m.user_profile?.real_name || m.username || m.bot_profile?.name || SLACK.someone,
      }
      const said = words(m.text ?? '', people).trim()
      const files: SlackFile[] = (m.files ?? []).flatMap((f) => {
        const url = f.url_private_download || f.url_private
        return url
          ? [
              {
                name: f.name || f.title || 'file',
                url,
                ...(f.original_w && f.original_h ? { width: f.original_w, height: f.original_h } : {}),
              },
            ]
          : []
      })
      if (!said && files.length === 0) continue
      out.push({
        key: m.ts,
        name: who.name,
        ...(who.email ? { email: who.email } : {}),
        text: said.slice(0, 40_000),
        ...(files.length ? { files } : {}),
        at: new Date(Number(m.ts) * 1000).toISOString(),
        ...(m.thread_ts && m.thread_ts !== m.ts ? { parent_key: m.thread_ts } : {}),
      })
    }
  }
  return out.sort((a, b) => Number(a.key) - Number(b.key))
}
