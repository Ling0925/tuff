import { say } from '../data/words.js'

/** What the web's own way to the server says when it fails — `data/api.ts`. */
export const API = say({
  notOnBoard: ['A board can’t do that.', 'Un tableau ne peut pas faire cela.', '看板不支持此操作。'],
  notAnswering: [
    'Tuff isn’t answering right now. Try again in a moment.',
    'Tuff ne répond pas pour le moment. Réessayez dans un instant.',
    'Tuff 目前没有响应。请稍后再试。',
  ],
  couldNotSignIn: ['Could not sign in', 'Connexion impossible', '无法登录'],
  couldNotJoin: ['Couldn’t join. Try again.', 'Impossible de rejoindre l’espace de travail. Réessayez.', '无法加入，请重试。'],
})
