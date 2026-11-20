/*
 * A setting as a line of the lists: what it is
 * and a sentence under it on the left, the control on the right, in a
 * panel with its neighbours. The page was headings, loose checkboxes and
 * grey paragraphs at three sizes, and read as a form nobody had laid out.
 */
export function Line({
  label,
  hint,
  children,
  wrap = false,
}: {
  label: string
  hint?: React.ReactNode
  children?: React.ReactNode
  wrap?: boolean
}) {
  return (
    <div className={`flex min-h-[56px] items-center gap-4 px-4 py-3 ${wrap ? 'flex-wrap' : ''}`}>
      <div className="flex min-w-[160px] flex-1 flex-col gap-1">
        <span className="text-base text-ink">{label}</span>
        {hint && <span className="text-sm text-ink-3">{hint}</span>}
      </div>
      {/* Wrapping, it may be narrower than its controls in a row: on a
          phone the time zone went off the edge of the screen. */}
      {children && <div className={`flex flex-wrap items-center gap-2 ${wrap ? 'min-w-px max-w-full' : 'shrink-0'}`}>{children}</div>}
    </div>
  )
}
