/**
 * A name somebody typed, kept to one line.
 *
 * A name is put where the product writes its own lines — a mail's subject,
 * the head of an agent's brief — and one with a line break in it started a
 * line of the product's: `Tuff Support\r\nBcc: …` in an invitation's
 * subject, a section in a brief. So line breaks and the other control
 * characters are spaces, wherever a name is saved or written out.
 */
export function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim()
}
