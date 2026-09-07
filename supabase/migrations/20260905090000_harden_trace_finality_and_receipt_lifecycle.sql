-- Final collection and destination evidence is an audit boundary, not merely
-- another editable workflow state. Serialize finalization with upstream writes
-- and freeze the complete source chain once a pickup is final.

revoke delete on table public.meal_batches from authenticated;
drop policy if exists meal_batches_delete on public.meal_batches;

alter table public.collection_events
  drop constraint collection_events_school_batch_fkey,
  add constraint collection_events_school_batch_fkey
    foreign key (school_id, meal_batch_id)
    references public.meal_batches (school_id, id)
    on delete restrict;

alter table public.destination_receipts
  drop constraint destination_receipts_school_collection_fkey,
  add constraint destination_receipts_school_collection_fkey
    foreign key (school_id, collection_event_id)
    references public.collection_events (school_id, id)
    on delete restrict;

create function private.guard_final_trace_meal_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      old.school_id::text || ':trace:' || old.id::text,
      0
    )
  );

  if exists (
    select 1
    from public.collection_events as collection
    where collection.school_id = old.school_id
      and collection.meal_batch_id = old.id
      and collection.status in ('collected', 'cancelled')
  ) then
    raise exception using
      errcode = '55000',
      message = 'meal batch with final trace is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function private.guard_final_trace_upstream_child()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_school_id uuid;
  source_batch_id uuid;
begin
  if tg_op = 'INSERT' then
    source_school_id := new.school_id;
    source_batch_id := new.meal_batch_id;
  else
    source_school_id := old.school_id;
    source_batch_id := old.meal_batch_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      source_school_id::text || ':trace:' || source_batch_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.collection_events as collection
    where collection.school_id = source_school_id
      and collection.meal_batch_id = source_batch_id
      and collection.status in ('collected', 'cancelled')
  ) then
    raise exception using
      errcode = '55000',
      message = 'upstream evidence for a final trace is immutable';
  end if;

  if tg_op = 'UPDATE'
    and (
      new.school_id is distinct from old.school_id
      or new.meal_batch_id is distinct from old.meal_batch_id
    )
  then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        new.school_id::text || ':trace:' || new.meal_batch_id::text,
        0
      )
    );

    if exists (
      select 1
      from public.collection_events as collection
      where collection.school_id = new.school_id
        and collection.meal_batch_id = new.meal_batch_id
        and collection.status in ('collected', 'cancelled')
    ) then
      raise exception using
        errcode = '55000',
        message = 'upstream evidence for a final trace is immutable';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function private.guard_destination_receipt_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_status text;
  parent_collected_at timestamptz;
begin
  select collection.status, collection.collected_at
    into parent_status, parent_collected_at
  from public.collection_events as collection
  where collection.school_id = new.school_id
    and collection.id = new.collection_event_id;

  -- Leave an absent or tenant-mismatched parent to the composite foreign key,
  -- which preserves the standard FK error without leaking another school.
  if not found then
    return new;
  end if;

  if parent_status <> 'collected' or parent_collected_at is null then
    raise exception using
      errcode = '23514',
      message = 'destination receipt requires a collected event';
  end if;

  if new.received_at < parent_collected_at then
    raise exception using
      errcode = '23514',
      message = 'destination receipt cannot predate collection';
  end if;

  return new;
end;
$$;

create function private.guard_final_collection_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('collected', 'cancelled') then
    raise exception using
      errcode = '55000',
      message = 'completed or cancelled collection evidence is immutable';
  end if;
  return old;
end;
$$;

create function private.guard_final_receipt_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('verified', 'rejected') then
    raise exception using
      errcode = '55000',
      message = 'verified or rejected destination evidence is immutable';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_final_trace_meal_batch()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_final_trace_upstream_child()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_destination_receipt_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_final_collection_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_final_receipt_delete()
  from public, anon, authenticated, service_role;

create trigger meal_batches_guard_trace_finality
  before update or delete on public.meal_batches
  for each row execute function private.guard_final_trace_meal_batch();

create trigger meal_contexts_guard_trace_finality
  before insert or update or delete on public.meal_contexts
  for each row execute function private.guard_final_trace_upstream_child();
create trigger feedback_events_guard_trace_finality
  before insert or update or delete on public.feedback_events
  for each row execute function private.guard_final_trace_upstream_child();
create trigger waste_measurements_guard_trace_finality
  before insert or update or delete on public.waste_measurements
  for each row execute function private.guard_final_trace_upstream_child();
create trigger human_decisions_guard_trace_finality
  before insert or update or delete on public.human_decisions
  for each row execute function private.guard_final_trace_upstream_child();

create trigger destination_receipts_guard_collection_lifecycle
  before insert or update on public.destination_receipts
  for each row execute function private.guard_destination_receipt_lifecycle();
create trigger collection_events_guard_final_delete
  before delete on public.collection_events
  for each row execute function private.guard_final_collection_delete();
create trigger destination_receipts_guard_final_delete
  before delete on public.destination_receipts
  for each row execute function private.guard_final_receipt_delete();

comment on function private.guard_final_trace_meal_batch() is
  'Serializes against trace finalization and freezes a meal batch after a collected or cancelled event exists.';
comment on function private.guard_final_trace_upstream_child() is
  'Serializes against trace finalization and freezes contextual, feedback, measurement, and human-decision evidence.';
comment on function private.guard_destination_receipt_lifecycle() is
  'Requires every destination receipt to follow a collected event and prevents received_at from predating collected_at.';
comment on function private.guard_final_collection_delete() is
  'Blocks privileged callers from deleting completed or cancelled collection evidence.';
comment on function private.guard_final_receipt_delete() is
  'Blocks privileged callers from deleting verified or rejected destination evidence.';
