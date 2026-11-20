/*
 * A picture knows how many pixels it is.
 *
 * Read off its first bytes when it is uploaded (`server/src/pixels.ts`), so
 * a picture put into a body by an agent holds its room before it loads, as
 * one dropped in by hand does: the browser measures what it uploads, and an
 * agent has nothing to measure with. Null for anything that is not a PNG,
 * JPEG, GIF or WebP, and for everything uploaded before this.
 */
alter table file add column pixel_width integer, add column pixel_height integer;
