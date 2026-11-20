import { PROJECT_SAID as W } from '../../words/project.js'
import { Icon } from '../glyphs.jsx'
import { fold, byKey, useFold } from './fold.js'

/**
 * The one press that folds the project's column into the sidebar and brings
 * it back.
 *
 * In the bar, at the end of the block that stands over the sidebar: how the
 * window is laid out is about the window, which is what the bar holds,
 * and it is the same control in the same place
 * whichever way the column is — so it never moves under the pointer that
 * pressed it. Its room is kept where there is no project to fold, so the
 * bar does not shift on the way into one.
 */
export function FoldToggle() {
  const { folded, slot } = useFold()
  const said = folded ? W.toolsToColumn : W.toolsToSidebar
  return (
    <button
      data-testid="tools-fold"
      data-row
      aria-label={said}
      aria-pressed={slot ? folded : undefined}
      title={said}
      tabIndex={slot ? undefined : -1}
      aria-hidden={slot ? undefined : true}
      onClick={(e) => fold(!folded, byKey(e))}
      className="flex size-8 shrink-0 items-center justify-center text-ink-3 mouse:hover:text-ink-2"
      style={{ borderRadius: 'var(--r-row)', visibility: slot ? 'visible' : 'hidden' }}
    >
      <Icon name="panel" size={16} />
    </button>
  )
}
