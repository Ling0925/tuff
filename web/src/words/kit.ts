import { say } from '../data/words.js'

/** The shared pieces — `ui/kit.tsx`: the pickers, the calendar, the marks. */
export const KIT = say({
  /* A list's mark, said as the stage it is — a task's, so feminine. */
  backlog: ['Backlog', 'Backlog'],
  notStarted: ['Not started', 'Non commencée'],
  started: ['Started', 'Commencée'],
  inProgress: ['In progress', 'En cours'],
  almostDone: ['Almost done', 'Presque terminée'],
  finished: ['Finished', 'Terminée'],
  stopped: ['Stopped', 'Arrêtée'],

  /* What a project's mark is about. */
  website: ['Website', 'Site web'],
  launch: ['Launch', 'Lancement'],
  client: ['Client', 'Client'],
  code: ['Code', 'Code'],
  design: ['Design', 'Design'],
  photo: ['Photo', 'Photo'],
  writing: ['Writing', 'Rédaction'],
  growth: ['Growth', 'Croissance'],
  goal: ['Goal', 'Objectif'],
  sprint: ['Sprint', 'Sprint'],
  favourite: ['Favourite', 'Favori'],
  care: ['Care', 'Soin'],
  home: ['Home', 'Maison'],
  shop: ['Shop', 'Boutique'],
  nature: ['Nature', 'Nature'],
  music: ['Music', 'Musique'],

  /* The ten colours, by the name a label stores. */
  red: ['red', 'rouge'],
  orange: ['orange', 'orange'],
  yellow: ['yellow', 'jaune'],
  green: ['green', 'vert'],
  teal: ['teal', 'turquoise'],
  blue: ['blue', 'bleu'],
  indigo: ['indigo', 'indigo'],
  purple: ['purple', 'violet'],
  pink: ['pink', 'rose'],
  grey: ['grey', 'gris'],

  active: ['Active', 'Actif'],
  doNotDisturb: ['Do not disturb', 'Ne pas déranger'],
  away: ['Away', 'Absent'],

  clear: ['Clear', 'Effacer'],
  sortBy: ['Sort by', 'Trier par'],
  makeNamed: [(name: string) => `Create “${name}”`, (name: string) => `Créer « ${name} »`],
  labelsOn: [(what: string) => `Labels on ${what}`, (what: string) => `Étiquettes de ${what}`],
  assigneeOf: [(what: string) => `Assignee of ${what}`, (what: string) => `Responsable de ${what}`],
  agentWorking: [(who: string) => `${who} is working on it`, (who: string) => `${who} y travaille`],
  /* What an agent says it is doing now. */
  workingFor: [(time: string) => `Working · ${time}`, (time: string) => `Au travail · ${time}`],
  minutes: [(n: number) => `${n} min`, (n: number) => `${n} min`],
  hours: [(h: number, m: number) => (m ? `${h} h ${m} min` : `${h} h`), (h: number, m: number) => (m ? `${h} h ${m} min` : `${h} h`)],
  noOne: ['No one', 'Personne'],
  agent: ['Agent', 'Agent'],
  agentAwaySince: [(when: string) => `Agent · away since ${when}`, (when: string) => `Agent · absent depuis ${when}`],
  agentNotYet: ['Agent · not connected yet', 'Agent · pas encore connecté'],
  projectIs: [(name: string) => `Project: ${name}`, (name: string) => `Projet : ${name}`],
  chooseAProject: ['Choose a project', 'Choisir un projet'],
  findAProject: ['Find a project', 'Trouver un projet'],
  noMatchingProjects: ['No matching projects.', 'Aucun projet correspondant.'],

  urgent: ['Urgent', 'Urgente'],
  high: ['High', 'Haute'],
  medium: ['Medium', 'Moyenne'],
  low: ['Low', 'Basse'],
  noPriority: ['No priority', 'Sans priorité'],
  priorityOf: [(what: string) => `Priority of ${what}`, (what: string) => `Priorité de ${what}`],

  previousMonth: ['Previous month', 'Mois précédent'],
  nextMonth: ['Next month', 'Mois suivant'],
  today: ['Today', 'Aujourd’hui'],
  dueDateOf: [(what: string) => `Due date of ${what}`, (what: string) => `Date d’échéance de ${what}`],

  sprintOf: [(what: string) => `Sprint of ${what}`, (what: string) => `Sprint de ${what}`],
  noMatchingSprints: ['No matching sprints.', 'Aucun sprint correspondant.'],
  /* A sprint's dates from `2026-10-29`: month first in English, the day
     first in French. */
  sprintDates: [
    (from: string, to: string) => `${from.slice(5).replace('-', '.')}–${to.slice(5).replace('-', '.')}`,
    (from: string, to: string) => `${from.slice(8)}.${from.slice(5, 7)}–${to.slice(8)}.${to.slice(5, 7)}`,
  ],

  uploading: [(name: string) => `Uploading ${name}`, (name: string) => `Importation de ${name}`],
  removeNamed: [(name: string) => `Remove ${name}`, (name: string) => `Retirer ${name}`],

  couldNotSendCode: ['Couldn’t send the code. Try again.', 'Impossible d’envoyer le code. Réessayez.'],
  sixDigitCode: ['6-digit code', 'Code à 6 chiffres'],
  sendAgain: ['Send again', 'Renvoyer'],
  emailMeACode: ['Email me a code', 'M’envoyer un code par e-mail'],
  sentTo: [(to: string) => `Sent to ${to}. It works for ten minutes.`, (to: string) => `Envoyé à ${to}. Il est valable dix minutes.`],
  wellEmailYou: ['We’ll email you a code to confirm it’s you.', 'Nous vous enverrons un code par e-mail pour confirmer votre identité.'],
})
