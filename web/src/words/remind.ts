import { say } from '../data/words.js'

/**
 * Remind me, on a task — `ui/RemindMe.tsx`.
 * As Todoist, Asana and Gmail's snooze say it: *Rappel*, *Plus tard dans
 * la journée*, *Semaine prochaine*, *Choisir une date et une heure*.
 */
export const REMIND = say({
  reminder: ['Reminder', 'Rappel'],
  remindMe: ['Remind me', 'Me rappeler'],
  /* "Reminder: Tomorrow, 9:00" — on the bar's bell and at the head of its menu. */
  reminderSet: [(when: string) => `Reminder: ${when}`, (when: string) => `Rappel\u202f: ${when}`],
  noReminder: ['No reminder set', 'Aucun rappel'],
  remindMeAbout: [(title: string) => `Remind me about ${title}`, (title: string) => `Me rappeler ${title}`],
  laterToday: ['Later today', 'Plus tard dans la journée'],
  tomorrow: ['Tomorrow', 'Demain'],
  nextWeek: ['Next week', 'Semaine prochaine'],
  pick: ['Pick a date and time', 'Choisir une date et une heure'],
  date: ['Date', 'Date'],
  time: ['Time', 'Heure'],
  set: ['Set reminder', 'Définir le rappel'],
  remove: ['Remove reminder', 'Supprimer le rappel'],
  today: ['Today', 'Aujourd’hui'],
  /* "Tomorrow, 9:00", "Demain, 9:00". */
  dayAt: [(day: string, time: string) => `${day}, ${time}`, (day: string, time: string) => `${day}, ${time}`],
  past: ['That time has passed.', 'Cette heure est déjà passée.'],
  couldNotSet: ['Couldn’t set the reminder. Try again.', 'Impossible de définir le rappel. Réessayez.'],
})
