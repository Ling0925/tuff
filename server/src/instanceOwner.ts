/**
 * An owner for your own server, named from the command line
 * and "When nobody owns the server".
 *
 *   pnpm --filter @tracker/server instance:owner someone@example.com [--yes]
 *
 * and in the Docker image, which has neither pnpm nor the scripts:
 *
 *   docker compose -f docker-compose.prod.yml exec app \
 *     node --conditions=compiled server/dist/instanceOwner.js someone@example.com
 *
 * Under `src/` so that the image compiles it. As the table owner
 * (`DATABASE_URL`), through `instance_name_owner` (migration 206), which no
 * request can call. Only for a server nobody has claimed — naming somebody
 * who signed up and never confirmed — or one left with no owner who can
 * sign in. The account it names loses the password it had, whoever chose
 * it, and every way in with it; the one way back is the reset link printed
 * here, to this terminal and nowhere else. Nothing imports this file.
 */
import { createInterface } from 'node:readline/promises'
import postgres from 'postgres'
import { generateToken, hashToken } from './auth/crypto.js'
import { env } from './env.js'

const args = process.argv.slice(2)
const yes = args.includes('--yes')
const email = (args.find((a) => !a.startsWith('--')) ?? '').trim().toLowerCase()
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: pnpm --filter @tracker/server instance:owner <email> [--yes]')
  process.exit(2)
}

const REFUSED: Record<string, string> = {
  not_community: 'Not done: this database is not a server of your own. The command is for the community edition.',
  dev_account: 'Not done: dev@example.com is the development account, whose password is in the repository.',
  instance_claimed: 'Not done: this server already has an owner who can sign in. An owner adds another in Server settings.',
  not_asked:
    'Not done: that account did not sign up itself, or has confirmed its address already. Sign up with the address, then run this again.',
}

const sql = postgres(env.databaseUrl, { max: 1, onnotice: () => {} })
try {
  const [who] = await sql<{ name: string; created_at: Date }[]>`
    select a.name, u.created_at from app_user u join actor a on a.id = u.actor_id where u.email = ${email}::citext`
  if (!who) {
    console.error(`No account has the address ${email}. Sign up with it first.`)
    process.exitCode = 1
  } else {
    /* Said back before anything is done: an account somebody else made
       before you is seen here, by its name and its time. */
    console.log(`The account ${email}, named "${who.name}", made ${who.created_at.toISOString()}.`)
    console.log('It becomes an owner of this server. Its password and every sign-in it has end; you choose a new password from a link.')
    let go = yes
    if (!go) {
      if (!process.stdin.isTTY) {
        console.error('Not done: nobody to ask. Run it in a terminal, or add --yes.')
        process.exitCode = 1
      } else {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        go = /^y(es)?$/i.test((await rl.question('Go on? [y/N] ')).trim())
        rl.close()
        if (!go) {
          console.log('Nothing done.')
          process.exitCode = 1
        }
      }
    }
    if (go) {
      const token = generateToken('rst')
      try {
        await sql`select instance_name_owner(${email}::citext, ${hashToken(token)})`
        const base = env.appUrl || '<this server’s address>'
        console.log(`${email} owns this server now. Choose its password within the hour, at:`)
        console.log(`  ${base}/reset/${encodeURIComponent(token)}`)
        console.log('This link is shown here only. Keep it to yourself.')
      } catch (e) {
        const code = /\b(not_community|dev_account|instance_claimed|not_asked)\b/.exec(String((e as Error).message))?.[1]
        if (!code) throw e
        console.error(REFUSED[code])
        process.exitCode = 1
      }
    }
  }
} finally {
  await sql.end()
}
