import { say } from '../data/words.js'

/**
 * A Slack export, read — `data/slack.ts`. Written into the messages brought
 * across, in the language of whoever brings them.
 */
export const SLACK = say({
  someone: ['Someone', 'Quelqu’un'],
  someoneMentioned: ['someone', 'quelqu’un'],
})
