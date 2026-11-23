import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gutterFor, LANGUAGES, languageName, languageOf, useLit, type Lit } from '../data/code.js'
import { tokens } from '../data/highlight.js'
import { CODE as W, LANGUAGE_NAMES } from '../words/code.js'
import { Icon } from './glyphs.jsx'
import { Popover, Switch, usePhone } from './kit.jsx'

/**
 * A code block's bar and the block as it is read.
 *
 * The editor's node view (`editor/codeBlock.tsx`) and `Doc` draw a block
 * the same way, with the same pieces: a pill in its top right corner over
 * the code, drawn over it rather than above it so it never moves a line,
 * and there while the pointer is on the block or the caret is in it.
 */

/**
 * Whether a body read here draws its code blocks with their bar and the
 * highlighter. A room's messages do not: chat keeps the colours it had,
 * from `data/highlight.ts`, and no bar over a message.
 */
export const CodeTools = createContext(true)

/** The pill over a block. A press on it keeps the caret where it was. */
export function CodeBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="code-bar"
      contentEditable={false}
      data-node-control
      data-code-bar
      /* The caret stays in the code: a press that took the focus would
         put the bar away under the hand that is reaching for it. */
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input')) e.preventDefault()
      }}
    >
      {children}
    </div>
  )
}

/** Copy: the block's words, and a check for a moment to say it went. */
export function CopyCode({ text }: { text: () => string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(t)
  }, [done])
  return (
    <button
      type="button"
      data-code-copy
      data-done={done || undefined}
      aria-label={done ? W.copied : W.copy}
      title={done ? W.copied : W.copy}
      onClick={() => {
        void put(text()).then((ok) => ok && setDone(true))
      }}
      className="code-tool"
    >
      <Icon name={done ? 'check' : 'copy'} size={16} />
    </button>
  )
}

/** Onto the clipboard, by the old way where the new one is refused — an `http` address, an old browser. */
async function put(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    field.remove()
    return ok
  }
}

/**
 * The language, as a button that opens the list: "Auto detect" first, then
 * the languages by name, a check on the one chosen. The list opens with
 * the chosen one in view.
 */
export function LanguagePick({
  value,
  onPick,
  onOpen,
}: {
  value: unknown
  onPick: (id: string | null) => void
  onOpen: (open: boolean) => void
}) {
  const known = languageOf(value)
  const name = languageName(value) ?? W.autoDetect
  return (
    <Popover
      shape="bare"
      width={232}
      align="right"
      testId="code-language"
      said={W.language}
      onOpenChange={onOpen}
      label={
        <span className="code-tool code-tool-wide" data-control>
          <span className="max-w-[160px] truncate">{name}</span>
          <Icon name="chevR" size={12} style={{ transform: 'rotate(90deg)' }} />
        </span>
      }
    >
      {(close) => (
        <LanguageList
          chosen={value ? (known?.id ?? String(value)) : null}
          onPick={(id) => {
            close()
            onPick(id)
          }}
        />
      )}
    </Popover>
  )
}

function LanguageList({ chosen, onPick }: { chosen: string | null; onPick: (id: string | null) => void }) {
  const phone = usePhone()
  const list = useRef<HTMLDivElement | null>(null)
  /* Drawn with the chosen one in view, not scrolled to it after; and no
     taller than the room the panel was given, so it scrolls rather than
     being cut off at the panel's edge. */
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const room = Number.parseFloat(el.parentElement?.style.maxHeight ?? '')
    if (!phone && room > 0 && room < 320) el.style.maxHeight = `${room}px`
    const on = el.querySelector<HTMLElement>('[aria-checked="true"]')
    /* A phone's sheet is the scroller there; the list is, here. */
    const scroller = phone ? el.parentElement : el
    if (on && scroller) {
      const top = (phone ? el.offsetTop : 0) + on.offsetTop
      scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 2 + on.offsetHeight / 2)
    }
  }, [phone])
  const row = (id: string | null, said: string) => {
    const on = id === chosen
    return (
      <button
        key={id ?? 'auto'}
        type="button"
        role="menuitemradio"
        aria-checked={on}
        data-row
        data-code-language={id ?? 'auto'}
        onClick={() => onPick(id)}
        className="flex h-8 w-full shrink-0 items-center gap-2 px-3 text-left text-base text-ink mouse:hover:bg-[var(--hover)]"
      >
        <span className="min-w-px flex-1 truncate">{said}</span>
        <Icon name="check" size={14} className="text-accent" style={{ opacity: on ? 1 : 0 }} />
      </button>
    )
  }
  return (
    <div
      ref={list}
      role="menu"
      aria-label={W.language}
      data-menu
      data-node-control
      data-code-languages
      className={`relative flex flex-col py-1 ${phone ? '' : 'overflow-y-auto overscroll-contain'}`}
      style={phone ? undefined : { maxHeight: 320 }}
    >
      {row(null, W.autoDetect)}
      <span aria-hidden className="mx-2 my-1 h-px shrink-0 bg-[var(--line)]" />
      {LANGUAGES.map((l) => row(l.id, LANGUAGE_NAMES[l.id]))}
    </div>
  )
}

/** The sliders: how this block is drawn — its lines wrapped, its lines numbered. */
export function CodeOptions({
  wrap,
  lines,
  onWrap,
  onLines,
  onOpen,
}: {
  wrap: boolean
  lines: boolean
  onWrap: (on: boolean) => void
  onLines: (on: boolean) => void
  onOpen: (open: boolean) => void
}) {
  return (
    <Popover
      shape="bare"
      width={264}
      align="right"
      fit
      testId="code-options"
      said={W.options}
      onOpenChange={onOpen}
      label={
        <span className="code-tool" data-control>
          <Icon name="sliders" size={16} />
        </span>
      }
    >
      {() => (
        <div data-node-control className="flex flex-col py-2">
          <label className="flex h-10 items-center justify-between gap-4 px-4 text-base text-ink">
            <span className="min-w-px flex-1">{W.wrapLines}</span>
            <Switch on={wrap} onChange={onWrap} testId="code-wrap" said={W.wrapLines} />
          </label>
          <label className="flex h-10 items-center justify-between gap-4 px-4 text-base text-ink">
            <span className="min-w-px flex-1">{W.lineNumbers}</span>
            <Switch on={lines} onChange={onLines} testId="code-line-numbers" said={W.lineNumbers} />
          </label>
        </div>
      )}
    </Popover>
  )
}

/** The language a read block is in, for its label: the one it names, or the highlighter's guess. */
function readName(language: unknown, lit: Lit | null, guess: string | null): string | null {
  return languageName(language) ?? (lit && guess ? languageName(guess) : null)
}

/**
 * A code block in a body that is read and not edited — `Doc`.
 *
 * Coloured by the highlighter the editor uses, so a block reads the same
 * once it is sent; its language on the bar as words and Copy beside it, and
 * drawn wrapped or numbered as its writer left it.
 */
export function ReadCode({ code, language, wrap, numbered }: { code: string; language: unknown; wrap: boolean; numbered: boolean }) {
  const tools = useContext(CodeTools)
  if (!tools) return <ChatCode code={code} />
  return <ReadBlock code={code} language={language} wrap={wrap} numbered={numbered} />
}

function ReadBlock({ code, language, wrap, numbered }: { code: string; language: unknown; wrap: boolean; numbered: boolean }) {
  const lit = useLit()
  const tree = useMemo(() => (lit ? lit.tree(code, language) : null), [lit, code, language])
  const rows = useMemo(
    () => (lit && tree ? lit.lines(tree) : code.split('\n').map((l) => (l ? [{ text: l, classes: [] as string[] }] : []))),
    [lit, tree, code],
  )
  const name = readName(language, lit, tree && lit ? lit.guessed(tree) : null)
  return (
    <div
      className="code-block"
      data-code-block
      data-read
      data-wrap={wrap || undefined}
      data-lines={numbered || undefined}
      style={numbered ? ({ '--gutter': `${gutterFor(rows.length)}px` } as React.CSSProperties) : undefined}
    >
      <CodeBar>
        {name && (
          <span className="code-name" data-code-name>
            {name}
          </span>
        )}
        <CopyCode text={() => code} />
      </CodeBar>
      <pre className="text-sm">
        <code>
          {rows.map((runs, i) => (
            <Fragment key={i}>
              {numbered && <span className="code-ln" data-n={i + 1} aria-hidden />}
              {runs.map((r, k) =>
                r.classes.length ? (
                  <span key={k} className={r.classes.join(' ')}>
                    {r.text}
                  </span>
                ) : (
                  r.text
                ),
              )}
              {i < rows.length - 1 ? '\n' : null}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  )
}

/** A block in a message, as chat has always drawn one. */
function ChatCode({ code }: { code: string }) {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const t of tokens(code)) {
    if (t.from > at) parts.push(code.slice(at, t.from))
    parts.push(
      <span key={t.from} className={`tok-${t.tone}`}>
        {code.slice(t.from, t.to)}
      </span>,
    )
    at = t.to
  }
  if (at < code.length) parts.push(code.slice(at))
  return (
    <pre className="overflow-x-auto rounded-[var(--r-row)] px-4 py-3 text-sm bg-sunken" style={{ fontFamily: 'var(--font-mono)' }}>
      {parts}
    </pre>
  )
}
