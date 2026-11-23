import { say } from '../data/words.js'

/** Notifications on this browser — `data/push.ts`: what it calls this machine, and the test notification. */
export const PUSH = say({
  unknownSystem: ['an unknown system', 'un système inconnu', '未知系统'],
  aBrowser: ['A browser', 'Un navigateur', '浏览器'],
  browserOn: [
    (what: string, where: string) => `${what} on ${where}`,
    (what: string, where: string) => `${what} sur ${where}`,
    (what: string, where: string) => `${where} 上的 ${what}`,
  ],
  probeTitle: ['Notifications are on', 'Les notifications sont activées', '通知已开启'],
  probeBody: ['This is a test notification.', 'Ceci est une notification de test.', '这是一条测试通知。'],
})
