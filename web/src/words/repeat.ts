import type { Repeat } from '@tracker/shared-schema'
import { LOCALE, dayMonth, now, say } from '../data/words.js'

/**
 * How a task repeats, said. On the card, the row's
 * label, the task's screen and the picker: "Every Friday", "Tous les
 * vendredis". Short and plain, the way Google Calendar and Todoist say it.
 */
export const REPEAT = say({
  repeat: ['Repeat', 'Répéter', '重复'],
  never: ['Doesn’t repeat', 'Ne se répète pas', '不重复'],
  repeatOf: [(what: string) => `Repeat for ${what}`, (what: string) => `Répétition de ${what}`, (what: string) => `${what} 的重复`],
  /* The stepper's lead: "Every 2 weeks", "Toutes les 2 semaines". */
  every: [
    (_unit: Repeat['every']) => 'Every',
    (unit: Repeat['every']) => (unit === 'week' ? 'Toutes les' : 'Tous les'),
    (_unit: Repeat['every']) => '每',
  ],
  fewer: ['Fewer', 'Moins', '更少'],
  more: ['More', 'Plus', '更多'],
  days: ['Days', 'Jours', '天'],
  weeks: ['Weeks', 'Semaines', '周'],
  months: ['Months', 'Mois', '月'],
  years: ['Years', 'Ans', '年'],
  onDay: [(d: number) => `On the ${ordinal(d)}`, (d: number) => `Le ${d === 1 ? '1er' : d}`, (d: number) => `在 ${d} 日`],
  lastDay: ['Last day', 'Dernier jour', '最后一天'],
  onDate: [(date: string) => `On ${date}`, (date: string) => `Le ${date}`, (date: string) => `在 ${date}`],
  fromDone: ['Count from when it’s done', 'À compter de la fin', '从完成时开始计算'],
})

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/* 1 January 2024 was a Monday: ISO weekday `w` is the (w-1)th day after it. */
const onWeekday = (w: number) => new Date(2024, 0, w, 12)
/** `Friday`, `vendredi`. */
export const weekdayLong = (w: number) => onWeekday(w).toLocaleDateString(LOCALE, { weekday: 'long' })
/** `Fri`, `ven.`. */
export const weekdayShort = (w: number) => onWeekday(w).toLocaleDateString(LOCALE, { weekday: 'short' })
/** `F`, `V` — the picker's seven chips. */
export const weekdayNarrow = (w: number) => onWeekday(w).toLocaleDateString(LOCALE, { weekday: 'narrow' })

/** `14 Nov`, `14 nov.` — a month and a day, in no year. */
export const monthDay = (month: number, day: number) => dayMonth(new Date(2024, month - 1, day === -1 ? 28 : day, 12))

const WEEKDAYS = [1, 2, 3, 4, 5]
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** The rule in words: "Every Friday", "Every month on the last day", "3 days after it's done". */
export function repeatSaid(rule: Repeat): string {
  const n = rule.interval ?? 1
  const fr = now === 'fr'
  if (rule.from === 'done') {
    const unit = fr
      ? { day: ['Un jour', 'jours'], week: ['Une semaine', 'semaines'], month: ['Un mois', 'mois'], year: ['Un an', 'ans'] }[rule.every]
      : { day: ['A day', 'days'], week: ['A week', 'weeks'], month: ['A month', 'months'], year: ['A year', 'years'] }[rule.every]
    const span = n === 1 ? unit[0] : `${n} ${unit[1]}`
    return fr ? `${span} après la fin` : `${span} after it’s done`
  }
  if (rule.every === 'day') {
    if (fr) return n === 1 ? 'Tous les jours' : `Tous les ${n} jours`
    return n === 1 ? 'Every day' : `Every ${n} days`
  }
  if (rule.every === 'week') {
    const days = [...(rule.weekdays ?? [])].sort((a, b) => a - b)
    if (n === 1 && same(days, WEEKDAYS)) return fr ? 'Tous les jours ouvrés' : 'Every weekday'
    if (n === 1 && days.length === 7) return fr ? 'Tous les jours' : 'Every day'
    if (fr) {
      if (n === 1 && days.length === 1) return `Tous les ${weekdayLong(days[0]!)}s`
      const lead = n === 1 ? 'Toutes les semaines' : `Toutes les ${n} semaines`
      if (days.length === 1) return `${lead} le ${weekdayLong(days[0]!)}`
      return `${lead} le ${days.map(weekdayShort).join(', ')}`
    }
    if (n === 1 && days.length === 1) return `Every ${weekdayLong(days[0]!)}`
    const lead = n === 1 ? 'Every week' : `Every ${n} weeks`
    if (days.length === 1) return `${lead} on ${weekdayLong(days[0]!)}`
    return `${lead} on ${days.map(weekdayShort).join(', ')}`
  }
  if (rule.every === 'month') {
    const day = rule.day ?? 1
    if (fr) {
      const lead = n === 1 ? 'Tous les mois' : `Tous les ${n} mois`
      return day === -1 ? `${lead} le dernier jour` : `${lead} le ${day === 1 ? '1er' : day}`
    }
    const lead = n === 1 ? 'Every month' : `Every ${n} months`
    return day === -1 ? `${lead} on the last day` : `${lead} on the ${ordinal(day)}`
  }
  const on = monthDay(rule.month ?? 1, rule.day ?? 1)
  if (fr) return `${n === 1 ? 'Tous les ans' : `Tous les ${n} ans`} le ${on}`
  return `${n === 1 ? 'Every year' : `Every ${n} years`} on ${on}`
}
