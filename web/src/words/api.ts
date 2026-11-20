import { say } from '../data/words.js'

/** What the web's own way to the server says when it fails — `data/api.ts`. */
export const API = say({
  notOnBoard: ['A board can’t do that.', 'Un tableau ne peut pas faire cela.'],
  notAnswering: ['Tuff isn’t answering right now. Try again in a moment.', 'Tuff ne répond pas pour le moment. Réessayez dans un instant.'],
  couldNotSignIn: ['Could not sign in', 'Connexion impossible'],
  couldNotJoin: ['Couldn’t join. Try again.', 'Impossible de rejoindre l’espace de travail. Réessayez.'],
})
