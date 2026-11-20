import { asWorker } from './db.js'
import { openSecret } from './github.js'
import { finish, type Claimed } from './importKit.js'
import { linearTurn } from './linearWork.js'
import { jiraTurn } from './jiraWork.js'
import { asanaTurn } from './asanaWork.js'
import type { JiraKey } from './jira.js'

/**
 * The next import's turn, whichever product it reads.
 */
export async function importWork(): Promise<number> {
  const [job] = await asWorker((tx) => tx<Claimed[]>`select * from linear_import_claim()`)
  if (!job) return 0
  const key = openSecret(job.key_enc)
  if (!key) {
    await finish(job.id, 'The key could not be read.')
    return 0
  }
  if (job.source === 'jira') {
    let k: JiraKey | null = null
    try {
      k = JSON.parse(key) as JiraKey
    } catch {
      // Not what was sealed.
    }
    if (!k?.site || !k.email || !k.token) {
      await finish(job.id, 'The key could not be read.')
      return 0
    }
    return jiraTurn(job, k)
  }
  if (job.source === 'asana') return asanaTurn(job, key)
  return linearTurn(job, key)
}
