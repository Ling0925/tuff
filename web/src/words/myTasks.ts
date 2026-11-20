import { say } from '../data/words.js'

/** My tasks — `ui/MyTasks.tsx`. */
export const MY_TASKS = say({
  assigned: ['Assigned', 'Attribuées'],
  created: ['Created', 'Créées'],
  subscribed: ['Subscribed', 'Suivies'],
  noneAssigned: ['No tasks assigned to you', 'Aucune tâche ne vous est attribuée'],
  noneAssignedBody: [
    'Tasks assigned to you in any project appear here.',
    'Les tâches qui vous sont attribuées, dans tous les projets, apparaissent ici.',
  ],
  noneCreated: ['No tasks created by you', 'Vous n’avez créé aucune tâche'],
  noneCreatedBody: ['Tasks you create in any project appear here.', 'Les tâches que vous créez, dans tous les projets, apparaissent ici.'],
  noneSubscribed: ['No subscribed tasks', 'Aucune tâche suivie'],
  noneSubscribedBody: [
    'You’re subscribed to tasks you create or comment on, and they appear here.',
    'Vous suivez les tâches que vous créez ou commentez, et elles apparaissent ici.',
  ],
  noActivity: ['No activity yet', 'Aucune activité pour l’instant'],
  noActivityBody: [
    'Tasks you create, change, finish or comment on appear here, newest first.',
    'Les tâches que vous créez, modifiez, terminez ou commentez apparaissent ici, des plus récentes aux plus anciennes.',
  ],
})
