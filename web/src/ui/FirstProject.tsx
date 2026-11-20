import { useEffect, useRef, useState } from 'react'
import { api } from '../data/api.js'
import { known } from '../data/route.js'
import { ProjectMark } from './icons.jsx'
import { FIRST_PROJECT as W } from '../words/firstProject.js'
import { notALogin } from './kit.jsx'

/**
 * Where an empty workspace starts.
 *
 * It opened on My tasks with three zeros and an empty year: nothing to do and
 * nothing saying what to do first. So it is one obvious next step — a name
 * and a button — and a sample for somebody who would rather look around
 * first. In the middle of the screen, and nothing else on it.
 *
 * It offered four templates once, with the board each would make drawn
 * beside them. We kept the two ways in that people take: their own
 * project, or the sample.
 */
/* The mark a new project starts with: the board, in the blank tint. */
const MARK = { icon: 'board', tint: 9 }

export function FirstProject({
  me,
  onMade,
}: {
  /** Whose the first tasks will be — drawn on them in the preview. */
  me: { id: string; name: string }
  onMade: (projectId: string) => Promise<void> | void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'make' | 'sample' | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  async function open(request: Promise<{ id: string; slug?: string }>, what: 'make' | 'sample') {
    setBusy(what)
    setSaid(null)
    try {
      const r = await request
      // Its address, known before the list that would teach it arrives.
      if (r.slug) known({ projects: [{ id: r.id, slug: r.slug }] })
      await onMade(r.id)
    } catch {
      setSaid(W.couldNotCreate)
      setBusy(null)
    }
  }

  const make = () => {
    if (!name.trim() || busy) return
    void open(
      api<{ id: string; slug?: string }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          mark_icon: MARK.icon,
          mark_tint: MARK.tint,
        }),
      }),
      'make',
    )
  }

  /* It arrives as the landing does, quicker: out of a blur, rising and
     fading in, the heading first — 400 ms, the product's own pace for
     something seen once. `[data-reveal]` in theme.css. */
  const root = useRef<HTMLDivElement>(null)
  /* The name is the one thing to do, so it has the caret — where a key
     will type into it; on a phone a focused field is the keyboard over
     half the screen before anything was asked for. */
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) field.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      root.current?.querySelectorAll('[data-reveal]').forEach((el) => el.setAttribute('data-shown', '')),
    )
    return () => cancelAnimationFrame(frame)
  }, [])
  const step = (i: number) => ({ '--reveal-delay': `${i * 60}ms`, '--reveal-ms': '400ms' }) as React.CSSProperties

  return (
    /* In the middle of the screen, every line centred on one axis — auto
       margins in a scrolling column, so a short window scrolls instead of
       cutting the heading off; a phone keeps it at the top. */
    <div
      ref={root}
      data-first-project
      className="mx-auto flex w-full max-w-[480px] flex-col items-center px-4 pt-16 pb-12 text-center max-sm:pt-8 max-sm:pb-32 sm:my-auto"
    >
      <form
        className="flex w-full flex-col items-center gap-8"
        onSubmit={(e) => {
          e.preventDefault()
          make()
        }}
      >
        <div data-reveal style={step(0)} className="flex flex-col items-center gap-4">
          <p className="text-md text-ink-2">{W.welcome}</p>
          <h1 className="text-hero leading-[1.05] font-semibold max-sm:text-display text-ink" style={{ letterSpacing: '-0.03em' }}>
            {W.startYourFirst}
          </h1>
          <p className="text-lg leading-[1.5] text-ink-2">{W.inOnePlace}</p>
        </div>

        {/* The mark it will have, beside the name it will have. */}
        <label data-reveal style={step(1)} className="flex w-full flex-col">
          <span className="sr-only">{W.projectName}</span>
          <span
            className="flex h-14 items-center gap-3 rounded-[var(--r-card)] px-3 text-left transition-shadow duration-150 bg-sunken"
            style={{
              boxShadow: focused ? 'inset 0 0 0 2px var(--accent)' : 'inset 0 0 0 1px var(--line)',
            }}
          >
            <ProjectMark id="first-project" name={name || W.project} icon={MARK.icon} tint={MARK.tint} size={32} />
            <input
              {...notALogin}
              ref={field}
              data-testid="first-project-name"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              value={name}
              maxLength={200}
              placeholder={W.projectName}
              onChange={(e) => setName(e.target.value)}
              className="h-full min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-[var(--ink-3)]"
              style={{ color: 'var(--ink)' }}
            />
          </span>
        </label>

        <div data-reveal style={step(2)} className="flex w-full flex-col items-center gap-4">
          <button
            type="submit"
            data-testid="first-project-make"
            disabled={!name.trim() || busy !== null}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-full px-6 text-lg font-medium transition-[transform,opacity] duration-150 active:scale-[0.97] disabled:opacity-40 bg-accent"
            style={{ color: '#fff' }}
          >
            {busy === 'make' ? W.creating : W.createProject}
          </button>
          <button
            type="button"
            data-testid="first-project-sample"
            disabled={busy !== null}
            onClick={() => void open(api<{ id: string; slug?: string }>('/projects/sample', { method: 'POST' }), 'sample')}
            className="h-8 text-md font-medium transition-opacity disabled:opacity-40 text-accent"
          >
            {busy === 'sample' ? W.opening : W.orExploreASample}
          </button>
        </div>
        {said && (
          <p role="alert" className="text-base text-danger">
            {said}
          </p>
        )}
      </form>
    </div>
  )
}
