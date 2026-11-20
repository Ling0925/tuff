import type { z } from 'zod'
import type { Priority, ProjectTemplate } from '@tracker/shared-schema'
import type { Language } from './words.js'

/** The body shape every written thing in the product shares. */
export const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
})

export type List = 'Backlog' | 'Todo' | 'In Progress' | 'In Review' | 'Done' | 'Canceled'
export type Label = 'Bug' | 'Feature' | 'Improvement'

export type SampleTask = {
  title: string
  list: List
  label?: Label
  priority?: z.infer<typeof Priority>
  /** Days from today; negative is already late. */
  dueIn?: number
  /** For the two lists that finish: how long ago it was finished. */
  doneDaysAgo?: number
  body?: string[]
  parts?: { title: string; done?: boolean }[]
}

/**
 * A small project in all of its states.
 *
 * Nothing in it is on anybody: it is a place to look around, and the work in
 * it is nobody's.
 */
export type Sample = {
  name: string
  description: string
  tasks: readonly SampleTask[]
  doc: { name: string; body: string[] }
  post: { title: string; body: string[] }
  /**
   * The channel, a little lived in: a few days of somebody working, a task
   * named in a line, a list and a thread. Written as the person who made
   * the sample, since nobody else is in it. `ago` is in hours.
   */
  chat: readonly { ago: number; text: string; task?: string; list?: string[]; reply?: { ago: number; text: string } }[]
  /** A word or two under a task, as the team leaves them. */
  comments: readonly { task: string; ago: number; text: string }[]
}

export const SAMPLE: Sample = {
  name: 'Sample project',
  description: 'A sample to look around in. Delete it when you’re done.',
  tasks: [
    {
      title: 'Collect feedback from the first users',
      list: 'Backlog',
      label: 'Improvement',
      body: [
        'Talk to five people who signed up in the first week. What did they try first, and where did they stop?',
        'Write what you hear in a doc in this project, one heading per person, and link it here.',
      ],
    },
    {
      title: 'Try a dark version of the homepage',
      list: 'Backlog',
      label: 'Feature',
      priority: 'low',
      body: ['A quick experiment, not a redesign: the same page on a dark background, to see whether the screenshots read better.'],
    },
    {
      title: 'Fix the sign-in button on small screens',
      list: 'Todo',
      label: 'Bug',
      priority: 'high',
      dueIn: 1,
      body: [
        'On phones narrower than 360 pixels the button runs off the edge of the screen.',
        'Check it on the smallest iPhone and an older Android before closing this.',
      ],
    },
    {
      title: 'Write the release notes',
      list: 'Todo',
      priority: 'medium',
      dueIn: 3,
      body: [
        'Short and plain: what changed, and why it matters to the people reading.',
        'Lead with the new pricing page, then the smaller fixes in a list.',
      ],
    },
    {
      title: 'Plan the next sprint',
      list: 'Todo',
      dueIn: 7,
      body: [
        'Go through the backlog together and pick what fits in two weeks.',
        'Anything without an owner by the end of the meeting goes back to the backlog.',
      ],
    },
    {
      title: 'Redesign the pricing page',
      list: 'In Progress',
      label: 'Feature',
      priority: 'high',
      dueIn: 2,
      body: [
        'Three plans side by side, with the yearly price under the monthly one.',
        'Keep the page to one screen on a laptop. The questions people ask go in an FAQ under the plans.',
      ],
      parts: [{ title: 'Draft the layout', done: true }, { title: 'Write the copy' }, { title: 'Review it with the team' }],
    },
    {
      title: 'Update the help center',
      list: 'In Progress',
      label: 'Improvement',
      priority: 'medium',
      dueIn: -1,
      body: [
        'Three articles still show the old pricing. Replace the screenshots and the numbers.',
        'This one is a day late — it can go out with the release notes.',
      ],
    },
    {
      title: 'Set up the project',
      list: 'Done',
      doneDaysAgo: 3,
      body: ['Lists, labels and the team chat. Everyone who works on the launch is on the project.'],
    },
    {
      title: 'Pick the colour palette',
      list: 'Done',
      label: 'Feature',
      doneDaysAgo: 2,
      body: ['One accent, two greys and a red for errors. The values are in the design file.'],
    },
    {
      title: 'Move the blog to the new domain',
      list: 'Done',
      doneDaysAgo: 1,
      body: ['Old addresses redirect to the new ones, so links people shared still work.'],
    },
    {
      title: 'Add a live chat widget',
      list: 'Canceled',
      label: 'Feature',
      doneDaysAgo: 4,
      body: ['Dropped for now: an email address answered within a day is enough at this size.'],
    },
  ],
  doc: {
    name: 'How this project is organised',
    body: [
      'Tasks hold the work. Each list is a stage — Backlog, Todo, In Progress, In Review, Done — and a task moves through them. Switch between the list and the board at the top of Tasks.',
      'Chat is the project’s channel. Mention a task with # and a person with @.',
      'Docs hold documents like this one, files you upload and links.',
      'Announcements are for news and decisions everyone on the project should see.',
      'This is a sample. Delete it from the bar at the top of the project when you’re done.',
    ],
  },
  chat: [
    { ago: 50, text: 'Morning! Starting on the pricing page redesign today.' },
    { ago: 49, text: 'The plan and the parts are here:', task: 'Redesign the pricing page' },
    {
      ago: 30,
      text: 'Should the yearly price come first, or the monthly?',
      reply: { ago: 29, text: 'Monthly first, yearly under it — the way the layout draft has it.' },
    },
    { ago: 26, text: 'Before Tuesday:', list: ['Copy for the three plans', 'New screenshots for the help center', 'Release notes'] },
    { ago: 6, text: 'Quick one before lunch —', task: 'Fix the sign-in button on small screens' },
    { ago: 2, text: 'The layout is done. Copy next, then a review with everyone on Thursday.' },
  ],
  comments: [
    { task: 'Redesign the pricing page', ago: 28, text: 'Layout draft is in Docs. Copy is the next part.' },
    {
      task: 'Fix the sign-in button on small screens',
      ago: 5,
      text: 'Reproduced on a 320-pixel screen. The padding is fixed, not relative.',
    },
    { task: 'Update the help center', ago: 20, text: 'Two of the three articles are done.' },
  ],
  post: {
    title: 'The new pricing page goes live next week',
    body: ['We’re launching the new pricing page next Tuesday.', 'What’s left is in In Progress on the board.'],
  },
}

/* ------------------------------------------------------------ in French */

/*
 * What a project starts with, for somebody who reads French.
 *
 * Written into the project as it is made, and the project's own text from
 * then on: a list renamed, a label added, a task finished are the team's,
 * and nothing translates them again for whoever reads them next. So the
 * French is chosen once, by whoever makes the project, and the English in
 * `@tracker/shared-schema` stays what every client reads to draw a project
 * before it is made.
 *
 * The lists are named the way Trello, Asana and Jira name theirs in
 * French; Backlog is kept as the word French teams use for it.
 */
export const LISTS_FR: Record<List, string> = {
  Backlog: 'Backlog',
  Todo: 'À faire',
  'In Progress': 'En cours',
  'In Review': 'En revue',
  Done: 'Terminé',
  Canceled: 'Annulé',
}

/** The three labels the database gives every project — `071_a_label_belongs_to_its_project.sql`. */
export const LABELS_FR: Record<Label, string> = {
  Bug: 'Bug',
  Feature: 'Fonctionnalité',
  Improvement: 'Amélioration',
}

export const listName = (name: string, language: Language): string => (language === 'fr' ? (LISTS_FR[name as List] ?? name) : name)

/**
 * A template's first tasks and its document in French, keyed by the
 * English title as the error table is, so a task added to a template in
 * `shared-schema` without its French is found by `words.test.ts` rather
 * than made in English in a French project.
 */
export const TEMPLATES_FR: Record<
  z.infer<typeof ProjectTemplate>,
  { readonly tasks: Readonly<Record<string, string>>; readonly doc: { readonly name: string; readonly body: readonly string[] } }
> = {
  launch: {
    tasks: {
      'Write the launch brief': 'Rédiger le brief du lancement',
      'Set the launch date': 'Fixer la date de lancement',
      'Invite the team to this project': 'Inviter l’équipe dans ce projet',
      'List what has to be ready': 'Lister ce qui doit être prêt',
      'Draft the announcement': 'Préparer l’annonce',
      'Plan the launch day': 'Organiser le jour du lancement',
      'Review the results a week after': 'Faire le bilan une semaine après',
    },
    doc: {
      name: 'Brief du lancement',
      body: ['Ce que nous lançons, et pour qui.', 'La date, et ce qui doit être prêt d’ici là.', 'Comment nous saurons que ça a marché.'],
    },
  },
  client: {
    tasks: {
      'Hold the kick-off call': 'Faire la réunion de lancement',
      'Write the scope and the timeline': 'Rédiger le périmètre et le calendrier',
      'Share the plan with the client': 'Partager le plan avec le client',
      'Make the first draft': 'Réaliser une première version',
      'Collect the client’s feedback': 'Recueillir les retours du client',
      'Deliver the final version': 'Livrer la version finale',
      'Send the invoice': 'Envoyer la facture',
    },
    doc: {
      name: 'Périmètre et calendrier',
      body: ['Ce que le client a demandé, avec ses mots.', 'Ce qui est inclus, et ce qui ne l’est pas.', 'Les dates, et qui valide.'],
    },
  },
  sprint: {
    tasks: {
      'Plan the sprint': 'Planifier le sprint',
      'Write the sprint goal': 'Rédiger l’objectif du sprint',
      'Sort the backlog': 'Trier le backlog',
      'Check in with the team mid-sprint': 'Faire un point avec l’équipe à mi-sprint',
      'Review what shipped': 'Passer en revue ce qui a été livré',
      'Hold the retrospective': 'Faire la rétrospective',
    },
    doc: {
      name: 'Objectif du sprint',
      body: ['La seule chose à laquelle sert ce sprint.', 'À quoi ressemble « terminé ».', 'Ce que nous laissons pour la prochaine fois.'],
    },
  },
}

/**
 * The sample, written in French rather than translated: the same project
 * in the same states — the same lists, labels, dates and parts — told the
 * way a French team would tell it. Tasks are named in the chat and the
 * comments by their French titles, which is what they are found by.
 */
export const SAMPLE_FR: Sample = {
  name: 'Exemple de projet',
  description: 'Un exemple pour faire le tour. Supprimez-le quand vous aurez terminé.',
  tasks: [
    {
      title: 'Recueillir les retours des premiers utilisateurs',
      list: 'Backlog',
      label: 'Improvement',
      body: [
        'Parlez à cinq personnes inscrites la première semaine. Qu’ont-elles essayé en premier, et où se sont-elles arrêtées ?',
        'Notez ce que vous entendez dans un document de ce projet, un titre par personne, et mettez le lien ici.',
      ],
    },
    {
      title: 'Essayer une version sombre de la page d’accueil',
      list: 'Backlog',
      label: 'Feature',
      priority: 'low',
      body: ['Un essai rapide, pas une refonte : la même page sur fond sombre, pour voir si les captures d’écran ressortent mieux.'],
    },
    {
      title: 'Corriger le bouton de connexion sur petit écran',
      list: 'Todo',
      label: 'Bug',
      priority: 'high',
      dueIn: 1,
      body: [
        'Sur les téléphones de moins de 360 pixels de large, le bouton déborde de l’écran.',
        'Vérifiez sur le plus petit iPhone et sur un Android plus ancien avant de clore la tâche.',
      ],
    },
    {
      title: 'Rédiger les notes de version',
      list: 'Todo',
      priority: 'medium',
      dueIn: 3,
      body: [
        'Court et simple : ce qui a changé, et pourquoi c’est important pour ceux qui les lisent.',
        'Commencez par la nouvelle page de tarifs, puis les petites corrections en liste.',
      ],
    },
    {
      title: 'Planifier le prochain sprint',
      list: 'Todo',
      dueIn: 7,
      body: [
        'Passez le backlog en revue ensemble et choisissez ce qui tient en deux semaines.',
        'Ce qui n’a pas de responsable à la fin de la réunion retourne dans le backlog.',
      ],
    },
    {
      title: 'Refondre la page de tarifs',
      list: 'In Progress',
      label: 'Feature',
      priority: 'high',
      dueIn: 2,
      body: [
        'Trois forfaits côte à côte, avec le prix à l’année sous le prix au mois.',
        'La page tient sur un seul écran d’ordinateur portable. Les questions fréquentes vont dans une FAQ sous les forfaits.',
      ],
      parts: [{ title: 'Esquisser la mise en page', done: true }, { title: 'Rédiger les textes' }, { title: 'Relire avec l’équipe' }],
    },
    {
      title: 'Mettre à jour le centre d’aide',
      list: 'In Progress',
      label: 'Improvement',
      priority: 'medium',
      dueIn: -1,
      body: [
        'Trois articles affichent encore les anciens tarifs. Remplacez les captures d’écran et les chiffres.',
        'Celle-ci a un jour de retard — elle peut partir avec les notes de version.',
      ],
    },
    {
      title: 'Mettre en place le projet',
      list: 'Done',
      doneDaysAgo: 3,
      body: [
        'Les listes, les étiquettes et la discussion de l’équipe. Toutes les personnes qui travaillent sur le lancement sont dans le projet.',
      ],
    },
    {
      title: 'Choisir la palette de couleurs',
      list: 'Done',
      label: 'Feature',
      doneDaysAgo: 2,
      body: ['Une couleur d’accent, deux gris et un rouge pour les erreurs. Les valeurs sont dans le fichier de maquette.'],
    },
    {
      title: 'Passer le blog sur le nouveau domaine',
      list: 'Done',
      doneDaysAgo: 1,
      body: ['Les anciennes adresses redirigent vers les nouvelles, et les liens déjà partagés fonctionnent toujours.'],
    },
    {
      title: 'Ajouter un chat en direct sur le site',
      list: 'Canceled',
      label: 'Feature',
      doneDaysAgo: 4,
      body: ['Laissé de côté pour l’instant : une adresse e-mail qui répond dans la journée suffit à notre taille.'],
    },
  ],
  doc: {
    name: 'Comment ce projet est organisé',
    body: [
      'Les tâches portent le travail. Chaque liste est une étape — Backlog, À faire, En cours, En revue, Terminé — et une tâche passe de l’une à l’autre. Passez de la liste au tableau en haut de Tâches.',
      'Discussion est le canal du projet. Mentionnez une tâche avec # et une personne avec @.',
      'Documents réunit les documents comme celui-ci, les fichiers importés et les liens.',
      'Annonces sert aux nouvelles et aux décisions que tout le monde sur le projet doit voir.',
      'Ceci est un exemple. Supprimez-le depuis la barre en haut du projet quand vous aurez terminé.',
    ],
  },
  chat: [
    { ago: 50, text: 'Bonjour ! Je commence la refonte de la page de tarifs aujourd’hui.' },
    { ago: 49, text: 'Le plan et les étapes sont ici :', task: 'Refondre la page de tarifs' },
    {
      ago: 30,
      text: 'On met le prix à l’année en premier, ou celui au mois ?',
      reply: { ago: 29, text: 'Au mois d’abord, à l’année en dessous — comme sur l’esquisse.' },
    },
    {
      ago: 26,
      text: 'Avant mardi :',
      list: ['Les textes des trois forfaits', 'De nouvelles captures pour le centre d’aide', 'Les notes de version'],
    },
    { ago: 6, text: 'Petite chose avant le déjeuner —', task: 'Corriger le bouton de connexion sur petit écran' },
    { ago: 2, text: 'La mise en page est terminée. Les textes ensuite, puis une relecture avec tout le monde jeudi.' },
  ],
  comments: [
    { task: 'Refondre la page de tarifs', ago: 28, text: 'L’esquisse est dans Documents. Les textes sont la prochaine étape.' },
    {
      task: 'Corriger le bouton de connexion sur petit écran',
      ago: 5,
      text: 'Reproduit sur un écran de 320 pixels. La marge est fixe, pas relative.',
    },
    { task: 'Mettre à jour le centre d’aide', ago: 20, text: 'Deux articles sur trois sont faits.' },
  ],
  post: {
    title: 'La nouvelle page de tarifs sera en ligne la semaine prochaine',
    body: ['Nous lançons la nouvelle page de tarifs mardi prochain.', 'Ce qui reste à faire est dans En cours, sur le tableau.'],
  },
}
