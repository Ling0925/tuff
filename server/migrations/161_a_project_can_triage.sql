/*
 * Triage.
 *
 * A project may mark one list as its triage: where what did not come from
 * the team's own hands waits to be accepted, declined or folded into the
 * task it repeats. A list like any other, drawn first; one a project.
 */
alter table task_list add column intake boolean not null default false;
create unique index task_list_one_intake on task_list (project_id) where intake and deleted_at is null;
