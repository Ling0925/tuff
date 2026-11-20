/*
 * A project named in Cyrillic gets an address in Latin.
 *
 * `slugify` kept `[a-z0-9]` and threw the rest away, so a project called
 * «Лифты и конвейеры» had nothing left to make a slug from and fell to the
 * word `project`, and `keyify` to `PRJ`. The second such project became
 * `project2` and `PRJ2`. Addresses are meant to be read
 * — and a workspace of PRJ, PRJ2, PRJ3 is the opposite of that.
 *
 * Transliterated rather than kept: a slug is part of a URL that is pasted
 * into chat, typed from a screen and read aloud down a phone, and percent
 * encoding is none of those things.
 */

/*
 * The letters that become more than one letter first, then the rest.
 *
 * `translate` maps one character to one character, so the four-letter щ and
 * the two-letter ж cannot go through it. Both halves are lower case only,
 * because every caller lowercases first.
 */
create or replace function latinise(said text) returns text
language sql immutable strict as $$
  select translate(
    replace(replace(replace(replace(replace(replace(replace(replace(
      replace(replace(replace(lower(said),
        'щ', 'shch'), 'ж', 'zh'), 'ц', 'ts'), 'ч', 'ch'), 'ш', 'sh'),
        'ю', 'yu'), 'я', 'ya'), 'ї', 'yi'), 'є', 'ye'), 'ъ', ''), 'ь', ''),
    'абвгдеёзийклмнопрстуфхыэіґ',
    /* й is y and not j: it is how every Russian speaker writes it in a URL,
       and ы sharing the letter costs a slug nothing. */
    'abvgdeeziyklmnoprstufhyeig'
  )
$$;

/*
 * Both of them go through it, and nothing else about them changes.
 *
 * The fallbacks stay: a project named `!!!` still has to be called something,
 * and `project` is a better answer than an error on the way in.
 */
create or replace function slugify(said text) returns text
language sql immutable strict as $$
  select nullif(trim(both '-' from regexp_replace(latinise(said), '[^a-z0-9]+', '-', 'g')), '')
$$;

create or replace function keyify(said text) returns text
language sql immutable strict as $$
  select upper(substring(regexp_replace(latinise(said), '[^a-z]', '', 'g') from 1 for 3))
$$;

/*
 * What is already here keeps the address it has.
 *
 * A slug is in links people have sent each other, and rewriting one to a
 * better word breaks every one of them. The design asks for a stable URL, and
 * stable means stable after we learn something, not only before.
 */
