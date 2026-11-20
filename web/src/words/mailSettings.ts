import { say } from '../data/words.js'

/** Setting up email — `ui/MailSettings.tsx`, on the setup screen and in Server settings. */
export const MAIL_SETTINGS = say({
  smtp: ['SMTP', 'SMTP'],
  resend: ['Resend', 'Resend'],
  host: ['Server', 'Serveur'],
  hostPlaceholder: ['smtp.example.com', 'smtp.exemple.com'],
  port: ['Port', 'Port'],
  security: ['Security', 'Sécurité'],
  tls: ['TLS', 'TLS'],
  starttls: ['STARTTLS', 'STARTTLS'],
  none: ['None', 'Aucune'],
  user: ['Username', 'Nom d’utilisateur'],
  userPlaceholder: ['Usually your email address', 'Souvent votre adresse e-mail'],
  password: ['Password', 'Mot de passe'],
  key: ['API key', 'Clé API'],
  keyPlaceholder: ['re_…', 're_…'],
  saved: ['Saved', 'Enregistré'],
  sender: ['Send from', 'Expéditeur'],
  senderPlaceholder: ['Tuff <tuff@example.com>', 'Tuff <tuff@exemple.com>'],
  fromEnv: ['Set by the server’s environment', 'Défini par l’environnement du serveur'],
  fromEnvHint: [
    'To change it, edit SMTP_URL or RESEND_API_KEY in .env and restart Tuff.',
    'Pour le modifier, changez SMTP_URL ou RESEND_API_KEY dans .env et redémarrez Tuff.',
  ],
  via: [(how: string, sender: string) => `${how}, from ${sender}`, (how: string, sender: string) => `${how}, expéditeur ${sender}`],
  couldntSave: ['Couldn’t save. Check the fields and try again.', 'Impossible d’enregistrer. Vérifiez les champs et réessayez.'],
})
