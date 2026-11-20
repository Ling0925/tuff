import { say } from '../data/words.js'

/** The offer of notifications over a room — `ui/PushOffer.tsx`. */
export const PUSH_OFFER = say({
  turnOnNotifications: ['Turn on notifications', 'Activer les notifications'],
  getOne: ['Get a notification when somebody writes to you.', 'Recevez une notification quand quelqu’un vous écrit.'],
  notNow: ['Not now', 'Plus tard'],
  turnOn: ['Turn on', 'Activer'],
})
