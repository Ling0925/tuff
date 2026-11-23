/*
 * A person, and somebody who wrote to a feedback page, may read Chinese.
 *
 * The column held English and French; adding a language is the column's
 * own list, and nothing else changes — `language_said` already answers
 * whatever the account said, and an account that said nothing is still
 * English.
 */
alter table app_user drop constraint app_user_language_check;
alter table app_user add constraint app_user_language_check check (language in ('en', 'fr', 'zh'));

alter table feedback_person drop constraint feedback_person_language_check;
alter table feedback_person add constraint feedback_person_language_check check (language in ('en', 'fr', 'zh'));
