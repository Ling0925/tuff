import { useEffect, useState } from 'react'
import { seedLinks } from '../data/files.js'
import { readTheme, writeTheme, type Theme } from '../data/theme.js'
import { Doc } from './Doc.jsx'
import { Icon, type IconName } from './glyphs.jsx'
import { dayMonthLong } from '../data/words.js'
import { PUBLIC_DOC as W } from '../words/publicDoc.js'

/* The reader's own choice, as the app's: what the system says, light or
   dark — kept on this browser, the same key the app keeps it under. */
const LOOKS: { id: Theme; icon: IconName; said: string }[] = [
  { id: 'system', icon: 'contrast', said: W.system },
  { id: 'light', icon: 'sun', said: W.light },
  { id: 'dark', icon: 'moon', said: W.dark },
]

export function Looks() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  return (
    <span role="radiogroup" aria-label={W.theme} className="flex items-center gap-[2px] rounded-full p-[2px] bg-track">
      {LOOKS.map((l) => {
        const on = l.id === theme
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={l.said}
            title={l.said}
            data-look={l.id}
            onClick={() => {
              setTheme(l.id)
              writeTheme(l.id)
            }}
            className="flex size-7 items-center justify-center rounded-full transition-colors"
            style={
              on ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: 'var(--segment-shadow)' } : { color: 'var(--ink-3)' }
            }
          >
            <Icon name={l.icon} size={14} />
          </button>
        )
      })}
    </span>
  )
}

/**
 * A document anybody can read, by its link.
 *
 * No session and nothing around it: the title, the words, the pictures, when
 * it last changed, and the way to Tuff under it. Read-only, in the product's
 * own reading style, light or dark as the reader's system is.
 */
type Shared = {
  name: string
  body: unknown
  updated_at: string
  pictures: Record<string, { url: string; display_url: string | null }>
}

export function PublicDoc({ token }: { token: string }) {
  const [doc, setDoc] = useState<Shared | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let alive = true
    fetch(`/api/public/docs/${encodeURIComponent(token)}`, { headers: { 'x-api-version': '1' } })
      .then(async (r) => {
        if (!alive) return
        if (!r.ok) return setMissing(true)
        const got = (await r.json()) as Shared
        /* Its pictures' links, given with it: a reader here has no session
           to ask for them one by one. */
        seedLinks(got.pictures)
        setDoc(got)
      })
      .catch(() => alive && setMissing(true))
    return () => {
      alive = false
    }
  }, [token])
  useEffect(() => {
    document.title = doc ? `${doc.name} — Tuff` : missing ? W.notSharedTitle : 'Tuff'
  }, [doc, missing])

  return (
    <div data-public-doc data-page className="min-h-screen bg-surface text-ink">
      <main className="mx-auto flex max-w-[720px] flex-col px-4 pt-16 pb-12 sm:px-8">
        {missing ? (
          <div className="flex flex-col gap-3 pt-16 text-center">
            <h1 className="text-title font-semibold">{W.notShared}</h1>
            <p className="text-md text-ink-2">{W.notSharedBody}</p>
          </div>
        ) : doc ? (
          <article className="reads flex flex-col gap-6">
            <h1 className="text-display leading-[1.15] font-semibold sm:text-hero" style={{ letterSpacing: '-0.025em' }}>
              {doc.name}
            </h1>
            <Doc body={doc.body} />
          </article>
        ) : null}
        <footer
          className="mt-16 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-6 text-sm text-ink-3"
          style={{ borderColor: 'var(--line)' }}
        >
          {doc && <span>{W.updated(dayMonthLong(new Date(doc.updated_at), true))}</span>}
          <span className="ml-auto flex items-center gap-4">
            <Looks />
            <a href="/" className="flex items-center gap-2 text-ink-2">
              <img src="/favicon.png" alt="" draggable={false} width={16} height={16} style={{ borderRadius: 4 }} />
              {W.madeWith}
            </a>
          </span>
        </footer>
      </main>
    </div>
  )
}
