import { say } from '../data/words.js'

/** What each permission on a project is called — `data/rights.ts`. */
export const RIGHTS_SAID = say({
  createTasks: ['Create tasks', 'Créer des tâches', '创建任务'],
  deleteTasks: ['Delete tasks', 'Supprimer des tâches', '删除任务'],
  createChannels: ['Create channels', 'Créer des canaux', '创建频道'],
  deleteChannels: ['Delete channels', 'Supprimer des canaux', '删除频道'],
  editOthers: ['Edit others’ tasks', 'Modifier les tâches des autres', '编辑他人的任务'],
  changeSettings: ['Change settings', 'Modifier les paramètres', '更改设置'],
  editOthersHint: [
    'Also their announcements, documents and comments',
    'Ainsi que leurs annonces, documents et commentaires',
    '也包括其公告、文档和评论',
  ],
  /* The same right deletes others' rows in Docs. */
  deleteTasksHint: [
    'Also others’ documents, files and links',
    'Ainsi que les documents, fichiers et liens des autres',
    '也包括他人的文档、文件和链接',
  ],
})
