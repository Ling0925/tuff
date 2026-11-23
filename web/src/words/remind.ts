import { say } from '../data/words.js'

/**
 * Remind me, on a task — `ui/RemindMe.tsx`.
 * As Todoist, Asana and Gmail's snooze say it: *Rappel*, *Plus tard dans
 * la journée*, *Semaine prochaine*, *Choisir une date et une heure*.
 */
export const REMIND = say({
  reminder: ['Reminder', 'Rappel', '提醒'],
  remindMe: ['Remind me', 'Me rappeler', '提醒我'],
  /* "Reminder: Tomorrow, 9:00" — on the bar's bell and at the head of its menu. */
  reminderSet: [(when: string) => `Reminder: ${when}`, (when: string) => `Rappel\u202f: ${when}`, (when: string) => `提醒：${when}`],
  noReminder: ['No reminder set', 'Aucun rappel', '未设置提醒'],
  remindMeAbout: [
    (title: string) => `Remind me about ${title}`,
    (title: string) => `Me rappeler ${title}`,
    (title: string) => `提醒我 ${title}`,
  ],
  laterToday: ['Later today', 'Plus tard dans la journée', '今天稍后'],
  tomorrow: ['Tomorrow', 'Demain', '明天'],
  nextWeek: ['Next week', 'Semaine prochaine', '下周'],
  pick: ['Pick a date and time', 'Choisir une date et une heure', '选择日期和时间'],
  date: ['Date', 'Date', '日期'],
  time: ['Time', 'Heure', '时间'],
  set: ['Set reminder', 'Définir le rappel', '设置提醒'],
  remove: ['Remove reminder', 'Supprimer le rappel', '移除提醒'],
  today: ['Today', 'Aujourd’hui', '今天'],
  /* "Tomorrow, 9:00", "Demain, 9:00". */
  dayAt: [
    (day: string, time: string) => `${day}, ${time}`,
    (day: string, time: string) => `${day}, ${time}`,
    (day: string, time: string) => `${day} ${time}`,
  ],
  past: ['That time has passed.', 'Cette heure est déjà passée.', '该时间已过去。'],
  couldNotSet: ['Couldn’t set the reminder. Try again.', 'Impossible de définir le rappel. Réessayez.', '无法设置提醒，请重试。'],
})
