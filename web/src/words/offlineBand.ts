import { say } from '../data/words.js'

/** The band across the top when the server can't be reached — `ui/OfflineBand.tsx`. */
export const OFFLINE_BAND = say({
  backOnline: ['Back online', 'De nouveau en ligne'],
  offline: [
    'You’re offline. Showing what this device last loaded. Changes can’t be saved until you reconnect.',
    'Vous êtes hors ligne. Voici ce que cet appareil a chargé en dernier. Les modifications ne pourront être enregistrées qu’une fois la connexion rétablie.',
  ],
  offlineShort: ['You’re offline. Changes can’t be saved.', 'Vous êtes hors ligne. Rien ne peut être enregistré.'],
})
