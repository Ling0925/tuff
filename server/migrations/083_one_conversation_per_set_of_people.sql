-- One direct conversation per set of people.
--
-- Pressing Message on somebody opened a new conversation every time, so the
-- sidebar listed the same person twice with half the history in each. The
-- endpoint now answers with the one these people already have; this folds
-- the ones made before that into the oldest of each set: their messages
-- move across, what pointed at them points at it, and they go.
with sets as (
  select c.id, c.created_at,
         (select array_agg(cm.actor_id order by cm.actor_id) from conversation_member cm
          where cm.conversation_id = c.id and cm.deleted_at is null and cm.joined_at is not null) as people
  from conversation c
  where c.project_id is null and not c.channel and c.deleted_at is null
),
ranked as (
  select id, people,
         first_value(id) over (partition by people order by created_at, id) as keeper
  from sets
  where people is not null
),
dupes as (
  select id, keeper from ranked where id <> keeper
),
moved as (
  update message m set conversation_id = d.keeper
  from dupes d where m.conversation_id = d.id
  returning m.id
),
told as (
  update notification n set object_id = d.keeper
  from dupes d where n.object_type = 'conversation' and n.object_id = d.id
  returning n.id
),
unplaced as (
  delete from sidebar_place sp using dupes d
  where sp.kind = 'conversation' and sp.object_id = d.id
  returning sp.id
)
update conversation c set deleted_at = now()
from dupes d where c.id = d.id;
