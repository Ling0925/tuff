/**
 * A body that is not the shape a body has — too deep, or not a document at
 * all. Thrown where a body is read and answered once, as the caller's
 * mistake, by `answerError` in `routes.ts`.
 */
export class BadShape extends Error {}
