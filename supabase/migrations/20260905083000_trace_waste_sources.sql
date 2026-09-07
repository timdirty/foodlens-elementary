-- One meal can leave several physically separate waste streams. A collection
-- event must therefore name the exact streams handed to one route; summing all
-- five measurements would silently mix liquids, inedible material, and edible
-- leftovers that may have different destinations.

create function private.canonical_trace_waste_sources(source_values text[])
returns text[]
language sql
immutable
strict
set search_path = ''
as $$
  select array_agg(source order by source_order)
  from (
    select distinct
      source,
      case source
        when 'preparation' then 1
        when 'unserved_edible' then 2
        when 'plate_edible' then 3
        when 'inedible' then 4
        when 'liquid' then 5
        else 99
      end as source_order
    from unnest(source_values) as source
  ) as normalized;
$$;

revoke all on function private.canonical_trace_waste_sources(text[])
  from public, anon;
grant execute on function private.canonical_trace_waste_sources(text[])
  to authenticated, service_role;

alter table public.collection_events
  add column waste_sources text[];

-- Existing rows cannot be classified truthfully from a destination name or a
-- total weight. Stop an in-place upgrade instead of inventing their contents;
-- operators must classify/export those rows before applying this migration.
do $$
begin
  if exists (select 1 from public.collection_events) then
    raise exception using
      errcode = '23502',
      message = 'existing collection events require explicit waste_sources classification',
      hint = 'Classify every legacy pickup by the five FoodLens waste streams before applying this migration.';
  end if;
end;
$$;

alter table public.collection_events
  alter column waste_sources set not null,
  add constraint collection_events_waste_sources_check check (
    cardinality(waste_sources) between 1 and 5
    and waste_sources <@ array[
      'preparation',
      'unserved_edible',
      'plate_edible',
      'inedible',
      'liquid'
    ]::text[]
    and array_position(waste_sources, null) is null
    and cardinality(waste_sources) = cardinality(
      private.canonical_trace_waste_sources(waste_sources)
    )
  );

create unique index collection_events_unique_source_route_idx
  on public.collection_events (
    school_id,
    meal_batch_id,
    (private.canonical_trace_waste_sources(waste_sources))
  )
  where status <> 'cancelled';

create function private.guard_collection_event_source_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serialize source allocation within one school meal batch so concurrent
  -- browser submissions cannot both pass the overlap check.
  perform pg_advisory_xact_lock(
    hashtextextended(new.school_id::text || ':trace:' || new.meal_batch_id::text, 0)
  );

  if new.status <> 'cancelled' and exists (
    select 1
    from public.collection_events as existing
    where existing.school_id = new.school_id
      and existing.meal_batch_id = new.meal_batch_id
      and existing.id <> new.id
      and existing.status <> 'cancelled'
      and existing.waste_sources && new.waste_sources
  ) then
    raise exception using
      errcode = '23505',
      message = 'waste source already belongs to another active collection event';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_collection_event_source_overlap()
  from public, anon;
grant execute on function private.guard_collection_event_source_overlap()
  to authenticated, service_role;

create trigger collection_events_guard_source_overlap
  before insert or update on public.collection_events
  for each row execute function private.guard_collection_event_source_overlap();

comment on column public.collection_events.waste_sources is
  'Exact waste streams included in this pickup. It prevents the app from treating every measured stream as if it followed the same route.';

alter table public.destination_receipts
  add constraint destination_receipts_official_document_check check (
    status <> 'verified'
    or provenance <> 'official'
    or document_sha256 is not null
  );

comment on constraint destination_receipts_official_document_check
  on public.destination_receipts is
  'Formal verified outcomes require a SHA-256 fingerprint of the externally retained facility document.';
