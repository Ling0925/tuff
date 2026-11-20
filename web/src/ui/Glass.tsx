/**
 * A glass surface.
 *
 * Blur and saturation behind the panel, a tint over it, a bright rim along
 * the top edge. It runs as a `backdrop-filter`, so the elements underneath
 * are painted through it and are otherwise untouched — the text under it
 * stays selectable and the links stay clickable. Cloning the content into
 * the panel and blurring the copy gets the same picture and none of that.
 *
 * Where this goes is in the glass spec and matters more than the
 * effect: chrome and controls only. The product is dense with data and glass
 * on a task list makes it unreadable and slow.
 *
 * ## There was a lens here
 *
 * The refraction used to be real: an SVG `feDisplacementMap` run as a
 * `backdrop-filter`, bending what was behind the panel along a map built
 * from its shape, rebuilt on resize and given a fresh filter id each time
 * because Safari caches one by id and freezes.
 *
 * It renders in Chromium and nowhere else. WebKit parses `url(#x)`, answers
 * yes to `CSS.supports` and paints nothing at all — so on an iPhone, Chrome
 * there included, every glass surface came up with no blur whatever, while
 * the one panel that set a plain blur in its own style was right on the same
 * screen. That is what named the fault.
 *
 * Detecting the engine fixed the blur and bought a worse problem: the
 * material became two materials, bent on a laptop and flat on a phone. One
 * product that looks like two is the thing the rule about a single lens was
 * written against, and the bend was the half of it only some people could
 * ever see.
 *
 * So the lens is gone rather than guarded. What is left is what every engine
 * draws the same way, and the rim and the elevation carry the material.
 */
export function Glass({
  children,
  radius = 16,
  tone = 'regular',
  className = '',
  style,
  ...rest
}: {
  children: React.ReactNode
  radius?: number
  /**
   * `accent` is the prominent variant: the same surface and the same edge,
   * tinted with the action colour.
   *
   * It is far more opaque than the regular tone, and that is not a
   * compromise — a light translucent surface over a light ground goes pale,
   * and the label on it stops separating. The material has to carry white
   * text, so it stays nearly solid and the glass shows in the edge and the
   * rim rather than in how much comes through.
   */
  tone?: 'regular' | 'accent'
  className?: string
  style?: React.CSSProperties
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`glass ${className}`}
      /* The paint lives in `theme.css` under this attribute — tint, edge,
         shadow, blur, saturation — because it has to change with the theme,
         and one copy of those numbers is one place for them to be wrong. */
      data-lens="off"
      data-tone={tone}
      style={{ borderRadius: radius, ...style }}
      {...rest}
    >
      {children}
    </div>
  )
}
