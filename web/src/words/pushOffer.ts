import { say } from '../data/words.js'

/** The offer of notifications over a room — `ui/PushOffer.tsx`. */
export const PUSH_OFFER = say({
  turnOnNotifications: ['Turn on notifications', 'Activer les notifications', '开启通知'],
  getOne: [
    'Get a notification when somebody writes to you.',
    'Recevez une notification quand quelqu’un vous écrit.',
    '有人给你写信时收到通知。',
  ],
  notNow: ['Not now', 'Plus tard', '以后再说'],
  turnOn: ['Turn on', 'Activer', '开启'],
})
