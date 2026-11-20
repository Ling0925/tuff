/**
 * Imported first by the scripts that make accounts with a known password,
 * so it runs before any of their other imports or statements — `local.ts`.
 */
import { basename } from 'node:path'
import { refusal } from './local.js'

const why = refusal(basename(process.argv[1] ?? 'This script'), process.env)
if (why) {
  console.error(why)
  process.exit(1)
}
