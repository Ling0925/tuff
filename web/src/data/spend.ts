import { now } from './words.js'

/**
 * AI spend as a person reads it.
 *
 * Tokens in the short form a usage page uses, `1.2M`, `850K`, `940`; a
 * cost in dollars to the cent, and under a cent said as under one rather
 * than as `$0.00`, which reads as free.
 */
/* American English for the numbers, not the British the dates use:
   `en-GB` writes `1.2m` and `US$4.80`, which no usage page does. */
const LOCALE = now === 'fr' ? 'fr-FR' : 'en-US'
const short = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })
const dollars = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'USD' })

export const asTokens = (n: number): string => short.format(n)

export const asDollars = (usd: number): string => (usd > 0 && usd < 0.01 ? `< ${dollars.format(0.01)}` : dollars.format(usd))

/** A line's or a sum's tokens and cost, the cost left out when nobody said it. */
export type Spend = { tokens: number; cost_usd?: number | null }

export function sumOf(lines: Spend[]): { tokens: number; cost: number | null } {
  let tokens = 0
  let cost: number | null = null
  for (const l of lines) {
    tokens += l.tokens
    if (l.cost_usd != null) cost = (cost ?? 0) + l.cost_usd
  }
  return { tokens, cost }
}
