import { useEffect, useState } from 'react'
import { api } from './api.js'
import { recall, remember } from './memory.js'
import type { WorkspaceLook } from '../ui/WorkspaceMark.jsx'

/**
 * The workspaces this person is in, one copy for every switcher on the
 * screen — the bar's, the drawer's, a phone's More — and for the dot on
 * More's tab.
 *
 * Each switcher asked for its own list, which was fine while the list was
 * names and marks that change once a year. Now it carries whether each
 * workspace's bell has something for this person (`unread`, the dot
 * ), which changes by the minute, and two copies of
 * it disagree on the same screen. So one list, one request in flight, and
 * whoever draws from it is told when it changes.
 */
export type Workspace = {
  id: string
  name: string
  slug: string
  role: string
  /** Whether this person has an unread notification there. */
  unread?: boolean
} & Omit<WorkspaceLook, 'id' | 'name'>

let list: Workspace[] = []
const told = new Set<(w: Workspace[]) => void>()
let asking: Promise<void> | null = null

/** The list again, once however many ask at the same moment. */
export function refreshWorkspaces(): Promise<void> {
  asking ??= api<{ workspaces: Workspace[] }>('/workspaces')
    .then((r) => {
      list = remember('workspaces', r.workspaces)
      for (const tell of told) tell(list)
    })
    .catch(() => {})
    .finally(() => {
      asking = null
    })
  return asking
}

/** What is known now: this window's last answer, or the one kept on this machine. */
export function knownWorkspaces(): Workspace[] {
  if (!list.length) list = recall<Workspace[]>('workspaces') ?? []
  return list
}

/*
 * Asked again while anybody is drawing it: a moment after the bar is up,
 * when the window comes back into view, and every two minutes. The socket
 * is this workspace's and hears nothing of the others, so this is how a
 * note in another one reaches the dot — up to two minutes late.
 */
const EVERY = 120_000
let timers: { first: ReturnType<typeof setTimeout>; every: ReturnType<typeof setInterval> } | null = null
const back = () => document.visibilityState === 'visible' && void refreshWorkspaces()

function watch(): void {
  if (timers) return
  timers = { first: setTimeout(refreshWorkspaces, 1500), every: setInterval(refreshWorkspaces, EVERY) }
  document.addEventListener('visibilitychange', back)
}

function unwatch(): void {
  if (!timers || told.size) return
  clearTimeout(timers.first)
  clearInterval(timers.every)
  document.removeEventListener('visibilitychange', back)
  timers = null
}

/** The list, kept current while the component that asks is on screen. */
export function useWorkspaces(): Workspace[] {
  const [all, setAll] = useState<Workspace[]>(knownWorkspaces)
  useEffect(() => {
    told.add(setAll)
    watch()
    return () => {
      told.delete(setAll)
      unwatch()
    }
  }, [])
  return all
}

/** Whether a workspace other than this one has something waiting for this person. */
export function waitingElsewhere(all: Workspace[], here: string): boolean {
  return all.some((w) => w.id !== here && w.unread === true)
}
