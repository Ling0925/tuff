import { Node, mergeAttributes } from '@tiptap/react'
import { glyphMarkup } from './glyphs.jsx'
import { FILE_DETAIL } from '../words/fileDetail.js'

/**
 * The inline things a body names — a person, a task, a document — as the
 * editors hold them. One definition for the chat's line and for the task's
 * editor: the description had none of them, so a body that named somebody,
 * written by an agent or a GitHub issue, came into the editor and lost the
 * name on the first save. `docs/specs/task-mentions.md`.
 */

/** Somebody called in: their id and their name at the time. */
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    id: { default: null, parseHTML: (el) => el.getAttribute('data-mention'), renderHTML: () => ({}) },
    label: { default: '', parseHTML: (el) => (el.textContent ?? '').replace(/^@/, ''), renderHTML: () => ({}) },
  }),
  parseHTML: () => [{ tag: 'span[data-mention]' }],
  /* Its words, so a message that is only a name is not an empty one. */
  renderText: ({ node }) => `@${node.attrs.label}`,
  renderHTML: ({ node, HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-mention': node.attrs.id, class: 'chat-mention' }),
    `@${node.attrs.label}`,
  ],
})

/** A task named in a message: its id, number and title at the time. */
export const TaskRef = Node.create({
  name: 'taskref',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    id: { default: null, parseHTML: (el) => el.getAttribute('data-taskref'), renderHTML: () => ({}) },
    projectId: { default: null, renderHTML: () => ({}) },
    number: { default: null, renderHTML: () => ({}) },
    key: { default: null, renderHTML: () => ({}) },
    title: { default: '', renderHTML: () => ({}) },
    /* The line it was made from, when that carried more than words.
       Kept by every editor that holds one,
       drawn only by a document's chip. */
    line: { default: null, renderHTML: () => ({}) },
  }),
  parseHTML: () => [{ tag: 'span[data-taskref]' }],
  renderText: ({ node }) => `${node.attrs.key ? `${node.attrs.key}-` : '#'}${node.attrs.number ?? ''} ${node.attrs.title}`,
  renderHTML: ({ node, HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-taskref': node.attrs.id, class: 'chat-taskref' }),
    `${node.attrs.key ? `${node.attrs.key}-` : '#'}${node.attrs.number ?? ''} ${node.attrs.title}`,
  ],
})

/** A document named in a message — `docs/specs/docs.md`. */
export const DocRef = Node.create({
  name: 'docref',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    id: { default: null, parseHTML: (el) => el.getAttribute('data-docref'), renderHTML: () => ({}) },
    projectId: { default: null, renderHTML: () => ({}) },
    number: { default: null, renderHTML: () => ({}) },
    title: { default: '', renderHTML: () => ({}) },
  }),
  parseHTML: () => [{ tag: 'span[data-docref]' }],
  renderText: ({ node }) => String(node.attrs.title),
  /* Drawn as a task's chip is, on the same tint, with the product's own
     document mark rather than an emoji: "From 📄 name" in the accent read
     as a link pasted from somewhere else, beside chips that are ours. */
  renderHTML: ({ node, HTMLAttributes }) => {
    const chip = document.createElement('span')
    for (const [k, v] of Object.entries(mergeAttributes(HTMLAttributes, { 'data-docref': node.attrs.id, class: 'doc-chip' })))
      if (v != null) chip.setAttribute(k, String(v))
    const mark = document.createElement('span')
    mark.className = 'doc-chip-mark'
    mark.innerHTML = glyphMarkup('doc', 14)
    const title = document.createElement('span')
    title.className = 'doc-chip-title'
    /* Named without its title where the project does not have it. */
    title.textContent = String(node.attrs.title || FILE_DETAIL.privateDocument)
    chip.append(mark, title)
    return chip
  },
})
