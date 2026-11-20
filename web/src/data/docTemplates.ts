import { useEffect, useState } from 'react'
import { api } from './api.js'
import { recall, remember } from './memory.js'

/** A document saved as a template, as "New document" offers it. */
export type SavedTemplate = { id: string; name: string; project_id: string; project_name: string; template_at: string }

const KEY = 'doc-templates'
const told = new Set<(t: SavedTemplate[]) => void>()

/** Asked again, and every menu holding the list given the answer. */
export async function readTemplates(): Promise<SavedTemplate[]> {
  const { templates } = await api<{ templates: SavedTemplate[] }>('/doc-templates')
  remember(KEY, templates)
  for (const tell of told) tell(templates)
  return templates
}

/**
 * The workspace's saved templates: what was last read at once, and the
 * server's answer in its place — read when Docs opens, so the menu that
 * offers them is drawn with them in it rather than growing under the hand.
 */
export function useSavedTemplates(): SavedTemplate[] {
  const [list, setList] = useState<SavedTemplate[]>(() => recall<SavedTemplate[]>(KEY) ?? [])
  useEffect(() => {
    told.add(setList)
    void readTemplates().catch(() => {})
    return () => {
      told.delete(setList)
    }
  }, [])
  return list
}
