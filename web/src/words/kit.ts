import { say } from '../data/words.js'

/** The shared pieces — `ui/kit.tsx`: the pickers, the calendar, the marks. */
export const KIT = say({
  /* A list's mark, said as the stage it is — a task's, so feminine. */
  backlog: ['Backlog', 'Backlog', '待办'],
  notStarted: ['Not started', 'Non commencée', '未开始'],
  started: ['Started', 'Commencée', '已开始'],
  inProgress: ['In progress', 'En cours', '进行中'],
  almostDone: ['Almost done', 'Presque terminée', '接近完成'],
  finished: ['Finished', 'Terminée', '已完成'],
  stopped: ['Stopped', 'Arrêtée', '已停止'],

  /* What a project's mark is about. */
  website: ['Website', 'Site web', '网站'],
  launch: ['Launch', 'Lancement', '上线'],
  client: ['Client', 'Client', '客户'],
  code: ['Code', 'Code', '代码'],
  design: ['Design', 'Design', '设计'],
  photo: ['Photo', 'Photo', '照片'],
  writing: ['Writing', 'Rédaction', '写作'],
  growth: ['Growth', 'Croissance', '增长'],
  goal: ['Goal', 'Objectif', '目标'],
  sprint: ['Sprint', 'Sprint', '迭代'],
  favourite: ['Favourite', 'Favori', '收藏'],
  care: ['Care', 'Soin', '关怀'],
  home: ['Home', 'Maison', '家'],
  shop: ['Shop', 'Boutique', '商店'],
  nature: ['Nature', 'Nature', '自然'],
  music: ['Music', 'Musique', '音乐'],

  /* The ten colours, by the name a label stores. */
  red: ['red', 'rouge', '红'],
  orange: ['orange', 'orange', '橙'],
  yellow: ['yellow', 'jaune', '黄'],
  green: ['green', 'vert', '绿'],
  teal: ['teal', 'turquoise', '青'],
  blue: ['blue', 'bleu', '蓝'],
  indigo: ['indigo', 'indigo', '靛'],
  purple: ['purple', 'violet', '紫'],
  pink: ['pink', 'rose', '粉'],
  grey: ['grey', 'gris', '灰'],

  active: ['Active', 'Actif', '活跃'],
  doNotDisturb: ['Do not disturb', 'Ne pas déranger', '请勿打扰'],
  away: ['Away', 'Absent', '离开'],

  clear: ['Clear', 'Effacer', '清除'],
  sortBy: ['Sort by', 'Trier par', '排序方式'],
  makeNamed: [(name: string) => `Create “${name}”`, (name: string) => `Créer « ${name} »`, (name: string) => `创建「${name}」`],
  labelsOn: [(what: string) => `Labels on ${what}`, (what: string) => `Étiquettes de ${what}`, (what: string) => `${what}的标签`],
  assigneeOf: [(what: string) => `Assignee of ${what}`, (what: string) => `Responsable de ${what}`, (what: string) => `${what}的负责人`],
  agentWorking: [(who: string) => `${who} is working on it`, (who: string) => `${who} y travaille`, (who: string) => `${who} 正在处理`],
  /* What an agent says it is doing now. */
  workingFor: [(time: string) => `Working · ${time}`, (time: string) => `Au travail · ${time}`, (time: string) => `工作中 · ${time}`],
  minutes: [(n: number) => `${n} min`, (n: number) => `${n} min`, (n: number) => `${n} 分钟`],
  hours: [
    (h: number, m: number) => (m ? `${h} h ${m} min` : `${h} h`),
    (h: number, m: number) => (m ? `${h} h ${m} min` : `${h} h`),
    (h: number, m: number) => (m ? `${h} 小时 ${m} 分钟` : `${h} 小时`),
  ],
  noOne: ['No one', 'Personne', '无人'],
  agent: ['Agent', 'Agent', '代理'],
  agentAwaySince: [
    (when: string) => `Agent · away since ${when}`,
    (when: string) => `Agent · absent depuis ${when}`,
    (when: string) => `代理 · ${when} 起离开`,
  ],
  agentNotYet: ['Agent · not connected yet', 'Agent · pas encore connecté', '代理 · 尚未连接'],
  projectIs: [(name: string) => `Project: ${name}`, (name: string) => `Projet : ${name}`, (name: string) => `项目：${name}`],
  statusIs: [(name: string) => `Status: ${name}`, (name: string) => `Statut : ${name}`, (name: string) => `状态：${name}`],
  chooseAProject: ['Choose a project', 'Choisir un projet', '选择项目'],
  findAProject: ['Find a project', 'Trouver un projet', '查找项目'],
  noMatchingProjects: ['No matching projects.', 'Aucun projet correspondant.', '没有匹配的项目。'],

  urgent: ['Urgent', 'Urgente', '紧急'],
  high: ['High', 'Haute', '高'],
  medium: ['Medium', 'Moyenne', '中'],
  low: ['Low', 'Basse', '低'],
  noPriority: ['No priority', 'Sans priorité', '无优先级'],
  priorityOf: [(what: string) => `Priority of ${what}`, (what: string) => `Priorité de ${what}`, (what: string) => `${what}的优先级`],

  previousMonth: ['Previous month', 'Mois précédent', '上个月'],
  nextMonth: ['Next month', 'Mois suivant', '下个月'],
  today: ['Today', 'Aujourd’hui', '今天'],
  dueDateOf: [
    (what: string) => `Due date of ${what}`,
    (what: string) => `Date d’échéance de ${what}`,
    (what: string) => `${what}的截止日期`,
  ],

  sprintOf: [(what: string) => `Sprint of ${what}`, (what: string) => `Sprint de ${what}`, (what: string) => `${what}的迭代`],
  noMatchingSprints: ['No matching sprints.', 'Aucun sprint correspondant.', '没有匹配的迭代。'],
  /* A sprint's dates from `2026-10-29`: month first in English, the day
     first in French. */
  sprintDates: [
    (from: string, to: string) => `${from.slice(5).replace('-', '.')}–${to.slice(5).replace('-', '.')}`,
    (from: string, to: string) => `${from.slice(8)}.${from.slice(5, 7)}–${to.slice(8)}.${to.slice(5, 7)}`,
    (from: string, to: string) => `${from.slice(5).replace('-', '.')}–${to.slice(5).replace('-', '.')}`,
  ],

  uploading: [(name: string) => `Uploading ${name}`, (name: string) => `Importation de ${name}`, (name: string) => `正在上传 ${name}`],
  removeNamed: [(name: string) => `Remove ${name}`, (name: string) => `Retirer ${name}`, (name: string) => `移除 ${name}`],

  couldNotSendCode: ['Couldn’t send the code. Try again.', 'Impossible d’envoyer le code. Réessayez.', '无法发送验证码，请重试。'],
  sixDigitCode: ['6-digit code', 'Code à 6 chiffres', '6 位验证码'],
  sendAgain: ['Send again', 'Renvoyer', '重新发送'],
  emailMeACode: ['Email me a code', 'M’envoyer un code par e-mail', '通过邮件发送验证码'],
  sentTo: [
    (to: string) => `Sent to ${to}. It works for ten minutes.`,
    (to: string) => `Envoyé à ${to}. Il est valable dix minutes.`,
    (to: string) => `已发送至 ${to}，10 分钟内有效。`,
  ],
  wellEmailYou: [
    'We’ll email you a code to confirm it’s you.',
    'Nous vous enverrons un code par e-mail pour confirmer votre identité.',
    '我们会通过邮件发送验证码，以确认是你本人。',
  ],
})
