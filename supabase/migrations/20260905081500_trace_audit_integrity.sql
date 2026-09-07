-- Keep final collection and destination evidence auditable even when a browser
-- client calls the Data API directly. Application validation remains useful
-- feedback, but these invariants belong at the database boundary as well.

create or replace function private.guard_collection_event_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.school_id is distinct from old.school_id
      or new.meal_batch_id is distinct from old.meal_batch_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception using
        errcode = '22023',
        message = 'collection event identity and source batch are immutable';
    end if;

    if old.status in ('collected', 'cancelled')
      and (to_jsonb(new) - 'updated_at')
        is distinct from (to_jsonb(old) - 'updated_at')
    then
      raise exception using
        errcode = '55000',
        message = 'completed or cancelled collection evidence is immutable';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.guard_destination_receipt_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.school_id is distinct from old.school_id
      or new.collection_event_id is distinct from old.collection_event_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception using
        errcode = '22023',
        message = 'destination receipt identity and collection link are immutable';
    end if;

    if old.status in ('verified', 'rejected')
      and (to_jsonb(new) - 'updated_at')
        is distinct from (to_jsonb(old) - 'updated_at')
    then
      raise exception using
        errcode = '55000',
        message = 'verified or rejected destination evidence is immutable';
    end if;
  end if;

  if new.status = 'verified' and new.verified_by is not null then
    if actor_id is null or new.verified_by is distinct from actor_id then
      raise exception using
        errcode = '42501',
        message = 'destination receipt verifier must be the authenticated user';
    end if;

    -- The client must explicitly request verification, but it cannot invent
    -- the audit timestamp. Preserve the original timestamp on idempotent
    -- retries of an already-verified receipt.
    if tg_op = 'INSERT' or old.status <> 'verified' then
      new.verified_at := statement_timestamp();
    else
      new.verified_at := old.verified_at;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_collection_event_audit() from public;
revoke all on function private.guard_destination_receipt_audit() from public;

create trigger collection_events_guard_audit
  before insert or update on public.collection_events
  for each row execute function private.guard_collection_event_audit();

create trigger destination_receipts_guard_audit
  before insert or update on public.destination_receipts
  for each row execute function private.guard_destination_receipt_audit();

alter table public.destination_receipts
  add constraint destination_receipts_verified_after_received_check check (
    status <> 'verified' or verified_at >= received_at
  );

drop policy destination_receipts_delete on public.destination_receipts;
create policy destination_receipts_delete on public.destination_receipts
  for delete to authenticated
  using (
    private.is_school_member(school_id, array['teacher', 'admin'])
    and status = 'submitted'
  );

drop policy collection_events_delete on public.collection_events;
create policy collection_events_delete on public.collection_events
  for delete to authenticated
  using (
    private.is_school_member(school_id, array['teacher', 'admin'])
    and status = 'scheduled'
  );

comment on function private.guard_collection_event_audit() is
  'Freezes completed collection evidence and its source identity.';
comment on function private.guard_destination_receipt_audit() is
  'Binds verification to the authenticated actor, owns verification time, and freezes final receipt evidence.';
