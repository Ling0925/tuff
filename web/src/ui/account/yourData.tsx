import { useState } from 'react'
import { now } from '../../data/words.js'
import { ACCOUNT as W } from '../../words/account.jsx'
import { stored, api, setSession } from '../../data/api.js'
import { SectionHead, Panel, Button, Hairline, InboxCode } from '../kit.jsx'
import { type Erasure, field, fieldStyle } from '../Account.jsx'
import { edition } from '../../edition.jsx'

/**
 * What Tuff keeps about you, taken out or taken away.
 *
 * A copy, at once, as a file: no email with a link later, because a file
 * that arrives later is one somebody has to come back for. And the account
 * deleted by its owner — what would go said first from a dry run of the
 * same function, then asked again with the password, the code where there
 * is one, or the account's address where there is neither.
 */
export function YourData({ deleteOnly = false }: { deleteOnly?: boolean } = {}) {
  const [busy, setBusy] = useState<'copy' | 'delete' | null>(null)
  const [asking, setAsking] = useState<Erasure | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [said, setSaid] = useState<string | null>(null)

  async function copy() {
    setBusy('copy')
    try {
      const r = await fetch('/api/me/export', {
        headers: { 'x-api-version': '1', 'x-tongue': now, authorization: `Bearer ${stored()?.access_token ?? ''}` },
      })
      if (!r.ok) throw new Error()
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'tuff-data.json'
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      /* In the page while it is pressed: some browsers ignore a press on a
         link that is nowhere. */
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setSaid(W.couldntCopy)
    } finally {
      setBusy(null)
    }
  }

  async function look() {
    setSaid(null)
    try {
      setAsking(await api<Erasure>('/me/delete', { method: 'POST', body: JSON.stringify({ dry: true }) }))
    } catch {
      setSaid(W.couldntCheck)
    }
  }

  async function erase() {
    setBusy('delete')
    setSaid(null)
    try {
      await api('/me/delete', {
        method: 'POST',
        body: JSON.stringify(asking?.asks === 'email' ? { code: code.trim() } : { password, ...(code ? { code } : {}) }),
      })
      /* Gone, and signed out everywhere: back to the front door. */
      setSession(null)
      location.assign('/welcome')
    } catch (e) {
      setSaid((e as Error).message || W.couldntDelete)
      setBusy(null)
    }
  }

  const names = (xs?: { name: string }[]) => (xs ?? []).map((x) => x.name).join(', ')
  const blocked = (asking?.blocked ?? []).length > 0
  /* A refusal only the edition gives — on the service, for whoever runs it. */
  const refused = asking?.why ? (edition.admin?.refusal(asking.why) ?? null) : null

  return (
    <section className="mt-9 flex flex-col gap-3">
      {!deleteOnly && <SectionHead>{W.yourData}</SectionHead>}
      <Panel>
        {/* In no workspace, deleting alone: the copy reads every workspace
            the account is in, and it is in none. */}
        {!deleteOnly && (
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="flex min-w-px flex-1 flex-col gap-1">
              <span className="text-base text-ink">{W.aCopy}</span>
              <span className="text-sm text-ink-3">{W.aCopyHint}</span>
            </div>
            <Button data-testid="data-copy" disabled={busy !== null} onClick={() => void copy()}>
              {busy === 'copy' ? W.preparing : W.download}
            </Button>
          </div>
        )}
        {!deleteOnly && <Hairline inset={16} />}
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="flex min-w-px flex-1 flex-col gap-1">
              <span className="text-base text-ink">{W.deleteAccount}</span>
              <span className="text-sm text-ink-3">{W.forGood}</span>
            </div>
            {!asking && (
              <Button
                data-testid="data-delete"
                onClick={() => void look()}
                style={{ background: 'color-mix(in oklch, var(--danger) 12%, transparent)', color: 'var(--danger)' }}
              >
                {W.deleteEllipsis}
              </Button>
            )}
          </div>
          {asking && (
            <div data-testid="data-delete-ask" className="flex flex-col gap-3 text-sm text-ink-2">
              {(asking.alone ?? []).length > 0 && <p>{W.deletedAlone(<b className="text-ink">{names(asking.alone)}</b>)}</p>}
              {(asking.leaves ?? []).length > 0 && <p>{W.youLeave(names(asking.leaves))}</p>}
              {blocked ? (
                <p className="text-danger">{W.handOverFirst(names(asking.blocked))}</p>
              ) : refused ? (
                <p className="text-danger">{refused}</p>
              ) : asking.why === 'last_instance_owner' ? (
                <p className="text-danger">{W.lastInstanceOwner}</p>
              ) : (
                <>
                  {asking.asks === 'email' ? (
                    <InboxCode value={code} onChange={setCode} testId="data-delete-code" look={{ className: field, style: fieldStyle }} />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <input
                        data-testid="data-delete-password"
                        type="password"
                        autoComplete="current-password"
                        className={`${field} w-full max-w-[240px]`}
                        style={fieldStyle}
                        placeholder={W.yourPassword}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      {asking.asks === 'password_and_code' && (
                        <input
                          autoComplete="one-time-code"
                          className={`${field} w-[144px] tabular-nums`}
                          style={fieldStyle}
                          inputMode="numeric"
                          placeholder={W.sixDigits}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Button
                      data-testid="data-delete-yes"
                      disabled={busy !== null || (asking.asks === 'email' ? code.trim().length < 6 : !password)}
                      onClick={() => void erase()}
                      style={{ background: 'var(--danger)', color: '#fff' }}
                    >
                      {busy === 'delete' ? W.deleting : W.deleteMyAccount}
                    </Button>
                    <button type="button" onClick={() => setAsking(null)} className="text-sm text-ink-3">
                      {W.cancel}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {said && (
            <p role="alert" className="text-sm text-danger">
              {said}
            </p>
          )}
        </div>
      </Panel>
    </section>
  )
}
