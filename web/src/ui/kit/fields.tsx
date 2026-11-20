/* ---------------------------------------------------------------- fields */

/**
 * What a field is, said to the browser and to the password managers.
 *
 * A browser decides by itself which field is a login: a text field just
 * before a password field is a user name, and every `type="password"` is a
 * password, whatever `autocomplete` says. The agent window's webhook key
 * was a password field, so the address above it was taken for a user name
 * and both offered the person's saved sign-ins — their addresses over a
 * webhook URL. Only signing in, signing up, a new password and the
 * re-asking of one are logins here; everything else says it is not one.
 *
 * `autocomplete="off"` is what the browser itself reads; the `data-` marks
 * are what 1Password, LastPass, Bitwarden and Dashlane read, because each
 * of them ignores the first.
 */
export const notALogin = {
  autoComplete: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const

/** Kept as typed: an address, a key, a slug — nothing corrected, nothing capitalised. */
export const asTyped = { spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off' } as const

/** A web address that has to be a whole one — a webhook, a routine. */
export const urlField = { type: 'url', inputMode: 'url', ...notALogin, ...asTyped } as const

/**
 * A link somebody pastes or types, `example.com` included: text, so a form
 * around it does not refuse an address without its `https://`, with the
 * keyboard of an address.
 */
export const linkField = { type: 'text', inputMode: 'url', ...notALogin, ...asTyped } as const

/** A field that narrows what is under it: a find, a filter, a picker's search. */
export const findField = { type: 'search', enterKeyHint: 'search', ...notALogin } as const

/** Somebody else's address — an invitation, an owner being added. Never the reader's own. */
export const othersEmail = { type: 'email', inputMode: 'email', ...notALogin, ...asTyped } as const

/**
 * A key, a token, a secret: hidden by its letters, never a password field.
 *
 * `type="password"` is the one thing every browser treats as a login, so
 * a key typed into one is offered to be kept with the person's sign-ins
 * and the field before it fills with their address. Text, drawn as discs
 * by `[data-secret]` in the theme.
 */
export function SecretInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input {...notALogin} {...asTyped} {...props} type="text" data-secret="" />
}
