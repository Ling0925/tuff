/**
 * How big a file is, said the way a person reads it.
 *
 * Here rather than in the editor because the reader of a body (`Doc`) draws
 * the same card, and it should not pull the editor in to say a size.
 */
import { LOCALE } from './words.js'
import { BYTES as W } from '../words/bytes.js'

/** Under a file's name: its size, or what kind of file it is when the size
    was not recorded — a file put in before it was. */
export function fileLine(name: string, size: unknown): string {
  if (typeof size === 'number' && size >= 0) return bytesSaid(size)
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]
  return ext ? W.extFile(ext.toUpperCase()) : W.file
}

export function bytesSaid(n: number): string {
  const units = W.units
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  const shown = u === 0 ? String(v) : v.toLocaleString(LOCALE, { maximumFractionDigits: v < 10 ? 2 : 1 })
  return `${shown} ${units[u]}`
}
