import { field, fieldLook, PasswordField } from './Access.jsx'
import { Field, Segments } from './kit.jsx'
import { keepsSecret, PORT_FOR, type MailDraft, type MailSecurity, type MailSetup } from '../data/mailSetup.js'
import { MAIL_SETTINGS as W } from '../words/mailSettings.js'

/**
 * The fields that set up email. On the setup
 * screen (`look: 'page'`, the sign-in pages' fields) and in Server settings
 * (`look: 'window'`, the kit's). SMTP or Resend, and who mail is from. A
 * saved password or key is never sent back: its field is empty and says
 * "Saved", and an empty field keeps it — for the same server and user.
 */
export function MailFields({
  setup,
  draft,
  onChange,
  look,
}: {
  setup: MailSetup | null
  draft: MailDraft
  onChange: (d: MailDraft) => void
  look: 'page' | 'window'
}) {
  const set = (patch: Partial<MailDraft>) => onChange({ ...draft, ...patch })
  const keeps = keepsSecret(setup, draft)
  const input = (props: React.InputHTMLAttributes<HTMLInputElement> & { 'data-testid'?: string }) =>
    look === 'page' ? (
      <input className={field} style={fieldLook} autoComplete="off" spellCheck={false} autoCapitalize="off" {...props} />
    ) : (
      <Field wide autoCapitalize="off" spellCheck={false} {...props} />
    )
  return (
    <div className="flex flex-col gap-4" data-testid="mail-fields">
      <Segments
        fill
        items={[
          { key: 'smtp', label: W.smtp, testId: 'mail-via-smtp' },
          { key: 'resend', label: W.resend, testId: 'mail-via-resend' },
        ]}
        value={draft.via}
        onPick={(via) => set({ via })}
      />
      {draft.via === 'smtp' ? (
        <>
          <Labelled label={W.host}>
            {input({
              'data-testid': 'mail-host',
              'aria-label': W.host,
              placeholder: W.hostPlaceholder,
              inputMode: 'url',
              value: draft.host,
              onChange: (e) => set({ host: e.target.value }),
            })}
          </Labelled>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-24">
              <Labelled label={W.port}>
                {input({
                  'data-testid': 'mail-port',
                  'aria-label': W.port,
                  inputMode: 'numeric',
                  value: draft.port,
                  onChange: (e) => set({ port: e.target.value.replace(/\D/g, '').slice(0, 5) }),
                })}
              </Labelled>
            </div>
            <div className="min-w-0 flex-1">
              <Labelled label={W.security}>
                <Segments
                  fill
                  items={(['tls', 'starttls', 'none'] as const).map((k) => ({ key: k, label: W[k], testId: `mail-security-${k}` }))}
                  value={draft.security}
                  onPick={(security: MailSecurity) =>
                    /* The port goes with the security until somebody types one of their own. */
                    set({ security, ...(Object.values(PORT_FOR).includes(draft.port) ? { port: PORT_FOR[security] } : {}) })
                  }
                />
              </Labelled>
            </div>
          </div>
          <Labelled label={W.user}>
            {input({
              'data-testid': 'mail-user',
              'aria-label': W.user,
              placeholder: W.userPlaceholder,
              value: draft.user,
              onChange: (e) => set({ user: e.target.value }),
            })}
          </Labelled>
          <Labelled label={W.password}>
            <PasswordField
              look={look}
              rule={false}
              name="smtp-password"
              testId="mail-password"
              placeholder={keeps ? W.saved : W.password}
              value={draft.password}
              onChange={(password) => set({ password })}
            />
          </Labelled>
        </>
      ) : (
        <Labelled label={W.key}>
          <PasswordField
            look={look}
            rule={false}
            name="resend-key"
            testId="mail-key"
            placeholder={keeps ? W.saved : W.keyPlaceholder}
            value={draft.key}
            onChange={(key) => set({ key })}
          />
        </Labelled>
      )}
      <Labelled label={W.sender}>
        {input({
          'data-testid': 'mail-sender',
          'aria-label': W.sender,
          placeholder: W.senderPlaceholder,
          value: draft.sender,
          onChange: (e) => set({ sender: e.target.value }),
        })}
      </Labelled>
    </div>
  )
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span aria-hidden className="px-1 text-sm text-ink-3">
        {label}
      </span>
      {children}
    </div>
  )
}

/** How the server sends, in one line: "SMTP, smtp.example.com:465, from Tuff <tuff@example.com>". */
export function mailSummary(m: MailSetup): string {
  const how = m.via === 'resend' ? W.resend : `${W.smtp}, ${m.host ?? ''}${m.port ? `:${m.port}` : ''}`
  return m.sender ? W.via(how, m.sender) : how
}
