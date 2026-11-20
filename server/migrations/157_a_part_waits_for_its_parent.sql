/*
 * After 156.
 */
/* A part waiting for its parent: Linear's issues come oldest first, and a
   parent may be numbered after its part. Linked when the team's last page
   is in, then gone. */
create table linear_import_parent (
  task_id uuid primary key references task(id),
  parent_number int not null
);
alter table linear_import_parent enable row level security;
create policy lip_own on linear_import_parent for all to tracker_app
  using (exists (select 1 from task t where t.id = task_id))
  with check (exists (select 1 from task t where t.id = task_id));
grant select, insert, delete on linear_import_parent to tracker_app;
