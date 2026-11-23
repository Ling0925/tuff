import { say } from '../data/words.js'

/** Where an empty workspace starts — `ui/FirstProject.tsx`. */
export const FIRST_PROJECT = say({
  couldNotCreate: ['Couldn’t create the project. Try again.', 'Impossible de créer le projet. Réessayez.', '无法创建项目，请重试。'],
  welcome: ['Welcome to Tuff', 'Bienvenue dans Tuff', '欢迎使用 Tuff'],
  startYourFirst: ['Start your first project', 'Créez votre premier projet', '创建你的第一个项目'],
  inOnePlace: [
    'Tasks, chat, docs and announcements in one place.',
    'Tâches, discussion, documents et annonces au même endroit.',
    '任务、聊天、文档和公告集中在一处。',
  ],
  projectName: ['Project name', 'Nom du projet', '项目名称'],
  project: ['Project', 'Projet', '项目'],
  creating: ['Creating…', 'Création…', '创建中…'],
  createProject: ['Create project', 'Créer le projet', '创建项目'],
  opening: ['Opening…', 'Ouverture…', '正在打开…'],
  orExploreASample: ['Or explore a sample project', 'Ou découvrir un projet d’exemple', '或浏览示例项目'],
})
