import { say } from '../data/words.js'

/** Notifications on this browser — `data/push.ts`: what it calls this machine, and the test notification. */
export const PUSH = say({
  unknownSystem: ['an unknown system', 'un système inconnu'],
  aBrowser: ['A browser', 'Un navigateur'],
  browserOn: [(what: string, where: string) => `${what} on ${where}`, (what: string, where: string) => `${what} sur ${where}`],
  probeTitle: ['Notifications are on', 'Les notifications sont activées'],
  probeBody: ['This is a test notification.', 'Ceci est une notification de test.'],
})
