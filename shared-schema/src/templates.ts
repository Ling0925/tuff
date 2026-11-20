import type { z } from 'zod'
import type { MarkIcon, ProjectTemplate } from './enums.js'

/**
 * What a new project can start from.
 *
 * Here and not in the endpoint because two things read it: the server that
 * makes the project, and the first-project screen that draws it before it is
 * made, as it will be. Two copies of one plan would be a preview of a
 * project nobody makes.
 *
 * The tasks are real first steps, written to be kept: on whoever made the
 * project — the first few in Todo, the rest in Backlog, so the board shows
 * where to begin rather than a column of seven. Each has a document to fill
 * in, the thing the first task asks for.
 */
export type TemplateTask = { readonly title: string; readonly list: 'Todo' | 'Backlog' }

export const PROJECT_TEMPLATES: Record<
  z.infer<typeof ProjectTemplate>,
  {
    readonly name: string
    readonly said: string
    /** The project's mark, and what the choice is drawn with. */
    readonly icon: z.infer<typeof MarkIcon>
    /** Its tint, of the ten — so the mark drawn before is the mark made. */
    readonly tint: number
    readonly tasks: readonly TemplateTask[]
    readonly doc: { readonly name: string; readonly body: readonly string[] }
  }
> = {
  launch: {
    name: 'Product launch',
    said: 'From the brief to the launch day.',
    icon: 'flag',
    tint: 5,
    tasks: [
      { title: 'Write the launch brief', list: 'Todo' },
      { title: 'Set the launch date', list: 'Todo' },
      { title: 'Invite the team to this project', list: 'Todo' },
      { title: 'List what has to be ready', list: 'Backlog' },
      { title: 'Draft the announcement', list: 'Backlog' },
      { title: 'Plan the launch day', list: 'Backlog' },
      { title: 'Review the results a week after', list: 'Backlog' },
    ],
    doc: {
      name: 'Launch brief',
      body: [
        'What we’re launching, and who it’s for.',
        'The date, and what has to be true by then.',
        'How we’ll know it worked.',
      ],
    },
  },
  client: {
    name: 'Client work',
    said: 'From the kick-off call to the invoice.',
    icon: 'folder',
    tint: 6,
    tasks: [
      { title: 'Hold the kick-off call', list: 'Todo' },
      { title: 'Write the scope and the timeline', list: 'Todo' },
      { title: 'Share the plan with the client', list: 'Todo' },
      { title: 'Make the first draft', list: 'Backlog' },
      { title: 'Collect the client’s feedback', list: 'Backlog' },
      { title: 'Deliver the final version', list: 'Backlog' },
      { title: 'Send the invoice', list: 'Backlog' },
    ],
    doc: {
      name: 'Scope and timeline',
      body: [
        'What the client asked for, in their words.',
        'What’s included, and what isn’t.',
        'The dates, and who signs off.',
      ],
    },
  },
  sprint: {
    name: 'Sprint',
    said: 'Planning, the work and the review.',
    icon: 'cal',
    tint: 3,
    tasks: [
      { title: 'Plan the sprint', list: 'Todo' },
      { title: 'Write the sprint goal', list: 'Todo' },
      { title: 'Sort the backlog', list: 'Todo' },
      { title: 'Check in with the team mid-sprint', list: 'Backlog' },
      { title: 'Review what shipped', list: 'Backlog' },
      { title: 'Hold the retrospective', list: 'Backlog' },
    ],
    doc: {
      name: 'Sprint goal',
      body: [
        'The one thing this sprint is for.',
        'What done looks like.',
        'What we’re leaving for next time.',
      ],
    },
  },
}
