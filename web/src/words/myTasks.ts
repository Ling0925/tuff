import { say } from '../data/words.js'

/** My tasks — `ui/MyTasks.tsx`. */
export const MY_TASKS = say({
  assigned: ['Assigned', 'Attribuées', '已指派'],
  created: ['Created', 'Créées', '已创建'],
  subscribed: ['Subscribed', 'Suivies', '已订阅'],
  noneAssigned: ['No tasks assigned to you', 'Aucune tâche ne vous est attribuée', '没有指派给你的任务'],
  noneAssignedBody: [
    'Tasks assigned to you in any project appear here.',
    'Les tâches qui vous sont attribuées, dans tous les projets, apparaissent ici.',
    '任何项目中指派给你的任务都会显示在这里。',
  ],
  noneCreated: ['No tasks created by you', 'Vous n’avez créé aucune tâche', '你没有创建任何任务'],
  noneCreatedBody: [
    'Tasks you create in any project appear here.',
    'Les tâches que vous créez, dans tous les projets, apparaissent ici.',
    '你在任何项目中创建的任务都会显示在这里。',
  ],
  noneSubscribed: ['No subscribed tasks', 'Aucune tâche suivie', '没有已订阅的任务'],
  noneSubscribedBody: [
    'You’re subscribed to tasks you create or comment on, and they appear here.',
    'Vous suivez les tâches que vous créez ou commentez, et elles apparaissent ici.',
    '你创建或评论的任务会自动订阅，并显示在这里。',
  ],
  noActivity: ['No activity yet', 'Aucune activité pour l’instant', '还没有动态'],
  noActivityBody: [
    'Tasks you create, change, finish or comment on appear here, newest first.',
    'Les tâches que vous créez, modifiez, terminez ou commentez apparaissent ici, des plus récentes aux plus anciennes.',
    '你创建、修改、完成或评论的任务都会显示在这里，最新的在前。',
  ],
})
