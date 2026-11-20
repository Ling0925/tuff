import { say } from '../data/words.js'

/** A file's size, and what it is when the size is not known — `data/bytes.ts`. */
export const BYTES = say({
  /* Octets in French: o, Ko, Mo, Go. */
  units: [
    ['B', 'KB', 'MB', 'GB'],
    ['o', 'Ko', 'Mo', 'Go'],
  ],
  extFile: [(ext: string) => `${ext} file`, (ext: string) => `Fichier ${ext}`],
  file: ['File', 'Fichier'],
})
