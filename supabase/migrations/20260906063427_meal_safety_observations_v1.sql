-- Per-meal anonymous safety observations are independent of waste collection
-- finality. No old experiment summary is converted into per-meal evidence.
create table public.meal_safety_observations (
  id uuid not null,
  school_id uuid not null references public.schools(id),
  meal_record_id uuid not null,
  revision integer not null check (revision >= 1),
  previous_observation_id uuid,
  observation jsonb not null,
  submitted_by uuid not null default auth.uid() references auth.users(id),
  received_at timestamptz not null default clock_timestamp(),
  primary key (school_id, id),
  unique (school_id, meal_record_id, revision),
  foreign key (school_id, meal_record_id)
    references public.meal_records(school_id, id),
  foreign key (school_id, previous_observation_id)
    references public.meal_safety_observations(school_id, id)
);
create index meal_safety_previous_idx
  on public.meal_safety_observations(school_id, previous_observation_id);
create index meal_safety_submitter_idx on public.meal_safety_observations(submitted_by);
create index meal_safety_natural_lookup_idx
  on public.meal_records(school_id, class_id, served_on, meal_period);

alter table public.meal_safety_observations enable row level security;
revoke all on public.meal_safety_observations from public, anon, authenticated, service_role;
grant select, insert on public.meal_safety_observations to authenticated, service_role;
create policy meal_safety_staff_read on public.meal_safety_observations
  for select to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));
create policy meal_safety_staff_append on public.meal_safety_observations
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin'])
    and submitted_by = (select auth.uid()));

create function private.meal_safety_integer(value jsonb, minimum integer, maximum integer)
returns boolean language sql immutable security invoker set search_path = ''
as $$
  select case when jsonb_typeof(value) = 'number' then
    (value::text)::numeric between minimum and maximum
    and (value::text)::numeric = trunc((value::text)::numeric)
    else false end;
$$;

create function private.validate_meal_safety_observation(value jsonb)
returns void language plpgsql immutable security invoker set search_path = ''
as $$
declare
  v_item jsonb;
  v_name text;
  v_total integer;
  v_actual integer;
  v_collected boolean := false;
begin
  if jsonb_typeof(value) is distinct from 'object'
    or not value ?& array['schemaVersion','id','mealRecordId','revision','previousObservationId',
      'provenance','mealSnapshot','sourceTitle','sourceReference','recordedAt','revisionReason',
      'shortage','refill','satisfaction']
    or (select count(*) from jsonb_object_keys(value)) <> 14
    or value->'schemaVersion' is distinct from '1'::jsonb
    or value->>'provenance' is distinct from 'school-record'
    or jsonb_typeof(value->'id') is distinct from 'string'
    or jsonb_typeof(value->'mealRecordId') is distinct from 'string'
    or not private.meal_safety_integer(value->'revision', 1, 2147483647)
  then raise exception using errcode = '22023', message = 'invalid meal safety identity or schema'; end if;
  perform (value->>'id')::uuid;
  perform (value->>'mealRecordId')::uuid;
  if (value->>'revision')::integer = 1 then
    if value->'previousObservationId' is distinct from 'null'::jsonb then
      raise exception using errcode = '22023', message = 'first safety revision cannot have predecessor';
    end if;
  else
    if jsonb_typeof(value->'previousObservationId') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'safety revision requires predecessor';
    end if;
    perform (value->>'previousObservationId')::uuid;
  end if;
  v_item := value->'mealSnapshot';
  if jsonb_typeof(v_item) is distinct from 'object'
    or not v_item ?& array['classId','servedOn','mealPeriod','actualPeople','menuSignature']
    or (select count(*) from jsonb_object_keys(v_item)) <> 5
    or jsonb_typeof(v_item->'classId') is distinct from 'string'
    or jsonb_typeof(v_item->'servedOn') is distinct from 'string'
    or (v_item->>'servedOn') !~ '^\d{4}-\d{2}-\d{2}$'
    or v_item->>'mealPeriod' is distinct from 'lunch'
    or not private.meal_safety_integer(v_item->'actualPeople', 0, 20000)
    or jsonb_typeof(v_item->'menuSignature') is distinct from 'string'
    or length(btrim(v_item->>'menuSignature')) not between 1 and 1000
  then raise exception using errcode = '22023', message = 'invalid meal safety snapshot'; end if;
  perform (v_item->>'classId')::uuid;
  perform (v_item->>'servedOn')::date;
  v_actual := (v_item->>'actualPeople')::integer;
  if jsonb_typeof(value->'sourceTitle') is distinct from 'string'
    or length(value->>'sourceTitle') > 160
    or jsonb_typeof(value->'sourceReference') is distinct from 'string'
    or length(value->>'sourceReference') > 240
    or jsonb_typeof(value->'revisionReason') is distinct from 'string'
    or length(value->>'revisionReason') > 500
    or ((value->>'revision')::integer > 1 and length(btrim(value->>'revisionReason')) < 3)
    or jsonb_typeof(value->'recordedAt') is distinct from 'string'
    or (value->>'recordedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
  then raise exception using errcode = '22023', message = 'invalid meal safety source or time'; end if;
  perform (value->>'recordedAt')::timestamptz;
  foreach v_name in array array['shortage', 'refill'] loop
    v_item := value->v_name;
    if jsonb_typeof(v_item) is distinct from 'object'
      or not v_item ?& array['status','eventCount','observedDiners']
      or (select count(*) from jsonb_object_keys(v_item)) <> 3
    then raise exception using errcode = '22023', message = 'invalid safety event observation'; end if;
    if v_item->>'status' = 'not-collected' then
      if v_item->'eventCount' is distinct from 'null'::jsonb
        or v_item->'observedDiners' is distinct from 'null'::jsonb then
        raise exception using errcode = '22023', message = 'uncollected safety events must remain null';
      end if;
    elsif v_item->>'status' = 'recorded' then
      v_collected := true;
      if not private.meal_safety_integer(v_item->'eventCount', 0, 20000)
        or not private.meal_safety_integer(v_item->'observedDiners', 1, v_actual) then
        raise exception using errcode = '22023', message = 'invalid recorded safety count or denominator';
      end if;
    else raise exception using errcode = '22023', message = 'invalid safety event status'; end if;
  end loop;
  v_item := value->'satisfaction';
  if jsonb_typeof(v_item) is distinct from 'object'
    or not v_item ?& array['status','invitedDiners','ratings']
    or (select count(*) from jsonb_object_keys(v_item)) <> 3
  then raise exception using errcode = '22023', message = 'invalid satisfaction observation'; end if;
  if v_item->>'status' = 'not-collected' then
    if v_item->'invitedDiners' is distinct from 'null'::jsonb
      or v_item->'ratings' is distinct from 'null'::jsonb then
      raise exception using errcode = '22023', message = 'uncollected satisfaction must remain null';
    end if;
  elsif v_item->>'status' = 'collected' then
    v_collected := true;
    if not private.meal_safety_integer(v_item->'invitedDiners', 1, v_actual)
      or jsonb_typeof(v_item->'ratings') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'invalid satisfaction denominator or ratings';
    end if;
    if jsonb_array_length(v_item->'ratings') <> 5
      or exists (select 1 from jsonb_array_elements(v_item->'ratings') rating
        where not private.meal_safety_integer(rating, 0, 20000)) then
      raise exception using errcode = '22023', message = 'satisfaction requires five integer rating bins';
    end if;
    select sum((rating::text)::integer) into v_total
      from jsonb_array_elements(v_item->'ratings') rating;
    if v_total > (v_item->>'invitedDiners')::integer then
      raise exception using errcode = '22023', message = 'satisfaction replies exceed invited diners';
    end if;
  else raise exception using errcode = '22023', message = 'invalid satisfaction status'; end if;
  if v_collected and (length(btrim(value->>'sourceTitle')) < 3
    or length(btrim(value->>'sourceReference')) < 3) then
    raise exception using errcode = '22023', message = 'collected safety data requires traceable source';
  end if;
end;
$$;

create function private.guard_meal_safety_observation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_meal public.meal_records;
  v_latest public.meal_safety_observations;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'meal safety observations are append-only';
  end if;
  if auth.uid() is null or not private.is_school_member(new.school_id, array['teacher','admin']) then
    raise exception using errcode = '42501', message = 'meal safety requires same-school staff';
  end if;
  perform private.validate_meal_safety_observation(new.observation);
  if new.id is distinct from (new.observation->>'id')::uuid
    or new.meal_record_id is distinct from (new.observation->>'mealRecordId')::uuid
    or new.revision is distinct from (new.observation->>'revision')::integer
    or new.previous_observation_id is distinct from (new.observation->>'previousObservationId')::uuid then
    raise exception using errcode = '22023', message = 'meal safety projections disagree with audit payload';
  end if;
  -- Row lock serializes attendance/menu corrections against the captured anchor.
  select * into v_meal from public.meal_records
    where school_id = new.school_id and id = new.meal_record_id for update;
  if not found or v_meal.source not in ('manual','import') then
    raise exception using errcode = '22023', message = 'meal safety requires a formal same-school meal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|','meal-safety',new.school_id,v_meal.class_id,v_meal.served_on,v_meal.meal_period),0));
  if (select count(*) from public.meal_records where school_id = new.school_id
    and class_id = v_meal.class_id and served_on = v_meal.served_on
    and meal_period = v_meal.meal_period) <> 1 then
    raise exception using errcode = '23505', message = 'ambiguous class/date/meal period; resolve duplicate meals first';
  end if;
  if new.observation->'mealSnapshot' is distinct from jsonb_build_object(
    'classId',v_meal.class_id,'servedOn',v_meal.served_on,'mealPeriod',v_meal.meal_period,
    'actualPeople',v_meal.actual_people,'menuSignature',v_meal.menu_signature) then
    raise exception using errcode = '22023', message = 'meal safety snapshot is stale or mismatched';
  end if;
  select * into v_latest from public.meal_safety_observations
    where school_id = new.school_id and meal_record_id = new.meal_record_id
    order by revision desc limit 1;
  if new.revision <> coalesce(v_latest.revision,0) + 1
    or new.previous_observation_id is distinct from v_latest.id then
    raise exception using errcode = '40001', message = 'meal safety revision conflict; reload latest observation';
  end if;
  if v_latest.id is not null and (new.observation->>'recordedAt')::timestamptz
    < (v_latest.observation->>'recordedAt')::timestamptz then
    raise exception using errcode = '22023', message = 'meal safety revision time predates predecessor';
  end if;
  new.submitted_by := auth.uid();
  new.received_at := clock_timestamp();
  return new;
end;
$$;
create trigger meal_safety_validate_append before insert or update or delete
  on public.meal_safety_observations for each row execute function private.guard_meal_safety_observation();

create function private.guard_meal_safety_parent()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  -- Every parent insert/update takes the same natural-key lock as an observation.
  -- Duplicate meal imports remain possible, but no observation may be newly
  -- recorded while that key is ambiguous; analytics excludes older observations.
  if tg_op = 'UPDATE' then
    if (new.school_id,new.id,new.class_id,new.served_on,new.meal_period)
      is distinct from (old.school_id,old.id,old.class_id,old.served_on,old.meal_period)
      and exists (select 1 from public.meal_safety_observations
        where school_id = old.school_id and meal_record_id = old.id) then
      raise exception using errcode = '55000', message = 'meal safety parent identity is immutable';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      concat_ws('|','meal-safety',old.school_id,old.class_id,old.served_on,old.meal_period),0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|','meal-safety',new.school_id,new.class_id,new.served_on,new.meal_period),0));
  return new;
end;
$$;
create trigger meal_safety_parent_guard before insert or update on public.meal_records
  for each row execute function private.guard_meal_safety_parent();

create function public.foodlens_meal_safety_contract_version()
returns integer language sql stable security invoker set search_path = '' as $$ select 1; $$;

create function public.save_meal_safety_observation(p_school_id uuid, p_observation jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  v_existing public.meal_safety_observations;
  v_id uuid;
begin
  if auth.uid() is null or not private.is_school_member(p_school_id,array['teacher','admin']) then
    raise exception using errcode = '42501', message = 'meal safety requires same-school staff';
  end if;
  perform private.validate_meal_safety_observation(p_observation);
  v_id := (p_observation->>'id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|','meal-safety-request',p_school_id,v_id),0));
  select * into v_existing from public.meal_safety_observations where school_id = p_school_id and id = v_id;
  if found then
    if v_existing.observation is distinct from p_observation then
      raise exception using errcode = '23505', message = 'same meal safety id has different payload';
    end if;
    return; -- Exact retry remains valid even after a subsequent meal correction.
  end if;
  insert into public.meal_safety_observations(id,school_id,meal_record_id,revision,previous_observation_id,observation)
    values(v_id,p_school_id,(p_observation->>'mealRecordId')::uuid,(p_observation->>'revision')::integer,
      (p_observation->>'previousObservationId')::uuid,p_observation);
end;
$$;
revoke all on function private.meal_safety_integer(jsonb,integer,integer),
  private.validate_meal_safety_observation(jsonb), private.guard_meal_safety_observation(),
  private.guard_meal_safety_parent(), public.foodlens_meal_safety_contract_version(),
  public.save_meal_safety_observation(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.meal_safety_integer(jsonb,integer,integer),
  private.validate_meal_safety_observation(jsonb), public.foodlens_meal_safety_contract_version(),
  public.save_meal_safety_observation(uuid,jsonb) to authenticated, service_role;
