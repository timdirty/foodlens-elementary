-- FoodLens cloud-mode hardening.
-- This migration keeps every cross-table relationship inside one school and
-- makes scan confirmation safe to retry after a network timeout.

do $migration_preflight$
begin
  if exists (
    select 1 from public.classes where grade not in (5, 6)
  ) then
    raise exception 'FoodLens 002 preflight: classes outside grades 5 and 6 must be migrated first';
  end if;

  if exists (
    select 1
    from public.meal_records as meal
    join public.classes as class on class.id = meal.class_id
    where class.school_id <> meal.school_id
  ) or exists (
    select 1
    from public.plate_scans as scan
    join public.meal_records as meal on meal.id = scan.meal_record_id
    where meal.school_id <> scan.school_id
  ) or exists (
    select 1
    from public.scan_detections as detection
    join public.plate_scans as scan on scan.id = detection.scan_id
    where scan.school_id <> detection.school_id
  ) or exists (
    select 1
    from public.scan_corrections as correction
    join public.scan_detections as detection
      on detection.id = correction.detection_id
    where detection.school_id <> correction.school_id
  ) then
    raise exception 'FoodLens 002 preflight: cross-school scan relationships must be repaired first';
  end if;

  if exists (
    select 1
    from public.experiments as experiment
    join public.classes as class on class.id = experiment.class_id
    where class.school_id <> experiment.school_id
  ) or exists (
    select 1
    from public.experiments as experiment
    join public.supply_predictions as prediction
      on prediction.id = experiment.linked_prediction_id
    where prediction.school_id <> experiment.school_id
  ) then
    raise exception 'FoodLens 002 preflight: cross-school experiment relationships must be repaired first';
  end if;
end
$migration_preflight$;

alter table public.classes drop constraint classes_grade_check;
alter table public.classes
  add constraint classes_grade_check check (grade in (5, 6)),
  add constraint classes_school_id_id_key unique (school_id, id);

alter table public.meal_records
  add constraint meal_records_school_id_id_key unique (school_id, id),
  add constraint meal_records_school_class_fkey
    foreign key (school_id, class_id)
    references public.classes (school_id, id);

alter table public.plate_scans
  drop constraint plate_scans_client_request_id_key;
alter table public.plate_scans
  add constraint plate_scans_school_request_key
    unique (school_id, client_request_id),
  add constraint plate_scans_school_id_id_key unique (school_id, id),
  add column payload_hash text,
  add column content_sha256 text,
  add constraint plate_scans_payload_hash_format
    check (payload_hash is null or payload_hash ~ '^[0-9a-f]{32}$'),
  add constraint plate_scans_content_hash_format
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint plate_scans_school_meal_fkey
    foreign key (school_id, meal_record_id)
    references public.meal_records (school_id, id)
    on delete cascade;

alter table public.scan_detections
  add constraint scan_detections_school_id_id_key unique (school_id, id),
  add constraint scan_detections_school_scan_fkey
    foreign key (school_id, scan_id)
    references public.plate_scans (school_id, id)
    on delete cascade,
  add constraint scan_detections_remaining_lte_original
    check (ai_remaining_g <= ai_original_g);

alter table public.scan_corrections
  add constraint scan_corrections_school_detection_fkey
    foreign key (school_id, detection_id)
    references public.scan_detections (school_id, id)
    on delete cascade,
  add constraint scan_corrections_remaining_lte_original
    check (corrected_remaining_g <= corrected_original_g);

alter table public.experiments
  drop constraint experiments_linked_prediction_id_fkey;
alter table public.supply_predictions
  drop constraint supply_predictions_pkey,
  add constraint supply_predictions_pkey primary key (school_id, id);
alter table public.experiments
  drop constraint experiments_pkey,
  add constraint experiments_pkey primary key (school_id, id),
  add constraint experiments_school_class_fkey
    foreign key (school_id, class_id)
    references public.classes (school_id, id),
  add constraint experiments_school_prediction_fkey
    foreign key (school_id, linked_prediction_id)
    references public.supply_predictions (school_id, id);
alter table public.research_sections
  drop constraint research_sections_pkey,
  add constraint research_sections_pkey primary key (school_id, id);

create index if not exists experiments_class_idx
  on public.experiments (school_id, class_id);
create index if not exists experiments_prediction_idx
  on public.experiments (school_id, linked_prediction_id);
create index if not exists meal_records_created_by_idx
  on public.meal_records (created_by);
create index if not exists plate_scans_reviewed_by_idx
  on public.plate_scans (reviewed_by);

create or replace function public.force_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create or replace function public.force_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger meal_records_force_created_by
  before insert or update on public.meal_records
  for each row execute function public.force_created_by();
create trigger supply_predictions_force_created_by
  before insert or update on public.supply_predictions
  for each row execute function public.force_created_by();
create trigger experiments_force_created_by
  before insert or update on public.experiments
  for each row execute function public.force_created_by();
create trigger research_sections_force_updated_by
  before insert or update on public.research_sections
  for each row execute function public.force_updated_by();
create trigger impact_settings_force_updated_by
  before insert or update on public.impact_settings
  for each row execute function public.force_updated_by();
create trigger project_profiles_force_updated_by
  before insert or update on public.project_profiles
  for each row execute function public.force_updated_by();

create or replace function public.is_school_member(
  target_school uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as membership
    where membership.school_id = target_school
      and membership.user_id = auth.uid()
      and (
        allowed_roles is null
        or membership.role = any (allowed_roles)
      )
  );
$$;

create or replace function public.confirm_scan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := nullif(payload ->> 'school_id', '')::uuid;
  v_request uuid := nullif(payload ->> 'client_request_id', '')::uuid;
  v_meal uuid;
  v_requested_meal uuid;
  v_requested_meal_text text := nullif(payload #>> '{meal,id}', '');
  v_class uuid;
  v_scan uuid;
  v_detection uuid;
  v_item jsonb;
  v_correction jsonb;
  v_index integer;
  v_detection_count integer;
  v_correction_count integer;
  v_leftover integer := 0;
  v_meal_supply integer;
  v_image_path text := nullif(payload ->> 'image_path', '');
  v_image_hash text := nullif(payload ->> 'image_sha256', '');
  v_content_hash text := nullif(payload ->> 'content_sha256', '');
  v_payload_hash text;
  v_existing public.plate_scans%rowtype;
begin
  if v_school is null or v_request is null then
    raise exception 'school_id and client_request_id are required'
      using errcode = '22023';
  end if;

  if not public.is_school_member(v_school, array['teacher', 'admin']) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if (v_image_path is null) <> (v_image_hash is null)
    or (
      v_image_hash is not null
      and v_image_hash !~ '^[0-9a-f]{64}$'
    ) then
    raise exception 'image path and SHA-256 fingerprint must be provided together'
      using errcode = '22023';
  end if;

  if v_content_hash is null or v_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'content SHA-256 fingerprint is required'
      using errcode = '22023';
  end if;

  v_payload_hash := md5(payload::text);

  -- Serialize equal retry keys, so concurrent retries cannot create two meals.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_school::text || ':' || v_request::text, 0)
  );

  select scan.*
  into v_existing
  from public.plate_scans as scan
  where scan.school_id = v_school
    and scan.client_request_id = v_request;

  if found then
    if v_existing.payload_hash is distinct from v_payload_hash
      or v_existing.content_sha256 is distinct from v_content_hash then
      raise exception 'idempotency key already belongs to different scan content'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'meal_id', v_existing.meal_record_id,
      'scan_id', v_existing.id
    );
  end if;

  if v_image_path is not null
    and v_image_path not like (v_school::text || '/%') then
    raise exception 'image_path must begin with the current school id'
      using errcode = '22023';
  end if;

  if jsonb_typeof(payload #> '{analysis,detections}') is distinct from 'array'
    or jsonb_typeof(payload -> 'corrections') is distinct from 'array' then
    raise exception 'detections and corrections must be arrays'
      using errcode = '22023';
  end if;

  v_detection_count := jsonb_array_length(payload #> '{analysis,detections}');
  v_correction_count := jsonb_array_length(payload -> 'corrections');
  if v_detection_count < 1 or v_detection_count > 12
    or v_correction_count <> v_detection_count then
    raise exception 'detections and corrections must contain 1 to 12 matching items'
      using errcode = '22023';
  end if;

  if coalesce(payload #>> '{analysis,provider}', '') = ''
    or coalesce(payload #>> '{analysis,model}', '') = '' then
    raise exception 'analysis provider and model are required'
      using errcode = '22023';
  end if;

  for v_index in 0..(v_detection_count - 1) loop
    v_item := (payload #> '{analysis,detections}') -> v_index;
    v_correction := (payload -> 'corrections') -> v_index;

    if not (
      coalesce(v_item ->> 'category', '') = any (
        array['rice', 'noodles', 'meat', 'vegetable', 'egg', 'fruit', 'other']
      )
    ) or not (
      coalesce(v_correction ->> 'category', '') = any (
        array['rice', 'noodles', 'meat', 'vegetable', 'egg', 'fruit', 'other']
      )
    ) then
      raise exception 'unsupported food category' using errcode = '22023';
    end if;

    if coalesce(v_item ->> 'label', '') = ''
      or coalesce(v_correction ->> 'label', '') = '' then
      raise exception 'every detection needs a label' using errcode = '22023';
    end if;

    if (v_item ->> 'originalG')::integer not between 1 and 5000
      or (v_item ->> 'remainingG')::integer not between 0 and (v_item ->> 'originalG')::integer
      or (v_item ->> 'remainingRatio')::numeric not between 0 and 1
      or (v_item ->> 'confidence')::numeric not between 0 and 1
      or (v_correction ->> 'originalG')::integer not between 1 and 5000
      or (v_correction ->> 'remainingG')::integer not between 0 and (v_correction ->> 'originalG')::integer
      or (v_correction ->> 'remainingRatio')::numeric not between 0 and 1
      or abs(
        (v_item ->> 'remainingG')::integer
        - round(
          (v_item ->> 'originalG')::integer
          * (v_item ->> 'remainingRatio')::numeric
        )
      ) > 1
      or abs(
        (v_correction ->> 'remainingG')::integer
        - round(
          (v_correction ->> 'originalG')::integer
          * (v_correction ->> 'remainingRatio')::numeric
        )
      ) > 1 then
      raise exception 'food weights, ratios, or confidence are out of range'
        using errcode = '22023';
    end if;

    v_leftover := v_leftover + (v_correction ->> 'remainingG')::integer;
  end loop;

  if v_requested_meal_text is not null then
    begin
      v_requested_meal := v_requested_meal_text::uuid;
    exception when invalid_text_representation then
      raise exception 'meal.id must be a UUID' using errcode = '22023';
    end;

    select meal.id, meal.total_supply_g
    into v_meal, v_meal_supply
    from public.meal_records as meal
    where meal.school_id = v_school
      and meal.id = v_requested_meal;

    if not found then
      raise exception 'meal does not belong to the current school'
        using errcode = '23503';
    end if;

    if v_leftover > v_meal_supply then
      raise exception 'plate estimate cannot exceed the meal supply weight'
        using errcode = '22023';
    end if;
  else
    v_class := nullif(payload #>> '{meal,class_id}', '')::uuid;
    perform 1
    from public.classes as class
    where class.school_id = v_school
      and class.id = v_class
      and class.active;

    if not found then
      raise exception 'class does not belong to the current school'
        using errcode = '23503';
    end if;

    if (payload #>> '{meal,planned_people}')::integer < 1
      or (payload #>> '{meal,actual_people}')::integer < 1
      or (payload #>> '{meal,total_supply_g}')::integer < v_leftover then
      raise exception 'meal people or total supply are out of range'
        using errcode = '22023';
    end if;

    insert into public.meal_records (
      school_id,
      class_id,
      served_on,
      meal_period,
      staple,
      main_dish,
      side_dishes,
      menu_signature,
      planned_people,
      actual_people,
      total_supply_g,
      leftover_g,
      measurement_method,
      notes,
      source,
      created_by
    ) values (
      v_school,
      v_class,
      (payload #>> '{meal,served_on}')::date,
      'lunch',
      payload #>> '{meal,staple}',
      payload #>> '{meal,main_dish}',
      array(
        select jsonb_array_elements_text(payload #> '{meal,side_dishes}')
      ),
      lower(
        (payload #>> '{meal,staple}') || '|' ||
        (payload #>> '{meal,main_dish}')
      ),
      (payload #>> '{meal,planned_people}')::integer,
      (payload #>> '{meal,actual_people}')::integer,
      (payload #>> '{meal,total_supply_g}')::integer,
      v_leftover,
      coalesce(nullif(payload #>> '{meal,measurement_method}', ''), 'ai-estimate'),
      coalesce(payload #>> '{meal,notes}', ''),
      'manual',
      auth.uid()
    )
    returning id into v_meal;
  end if;

  insert into public.plate_scans (
    school_id,
    meal_record_id,
    image_path,
    client_request_id,
    payload_hash,
    content_sha256,
    provider,
    model,
    schema_version,
    status,
    reviewed_by
  ) values (
    v_school,
    v_meal,
    v_image_path,
    v_request,
    v_payload_hash,
    v_content_hash,
    payload #>> '{analysis,provider}',
    payload #>> '{analysis,model}',
    '1',
    'confirmed',
    auth.uid()
  )
  returning id into v_scan;

  for v_index in 0..(v_detection_count - 1) loop
    v_item := (payload #> '{analysis,detections}') -> v_index;
    v_correction := (payload -> 'corrections') -> v_index;

    insert into public.scan_detections (
      scan_id,
      school_id,
      category,
      label,
      ai_original_g,
      ai_remaining_ratio,
      ai_remaining_g,
      confidence,
      sort_order
    ) values (
      v_scan,
      v_school,
      v_item ->> 'category',
      v_item ->> 'label',
      (v_item ->> 'originalG')::integer,
      (v_item ->> 'remainingRatio')::numeric,
      (v_item ->> 'remainingG')::integer,
      (v_item ->> 'confidence')::numeric,
      v_index
    )
    returning id into v_detection;

    if v_correction ->> 'category' <> v_item ->> 'category'
      or v_correction ->> 'label' <> v_item ->> 'label'
      or (v_correction ->> 'originalG')::integer <> (v_item ->> 'originalG')::integer
      or (v_correction ->> 'remainingRatio')::numeric <> (v_item ->> 'remainingRatio')::numeric
      or (v_correction ->> 'remainingG')::integer <> (v_item ->> 'remainingG')::integer then
      insert into public.scan_corrections (
        detection_id,
        school_id,
        corrected_category,
        corrected_label,
        corrected_original_g,
        corrected_remaining_ratio,
        corrected_remaining_g,
        note,
        corrected_by
      ) values (
        v_detection,
        v_school,
        v_correction ->> 'category',
        v_correction ->> 'label',
        (v_correction ->> 'originalG')::integer,
        (v_correction ->> 'remainingRatio')::numeric,
        (v_correction ->> 'remainingG')::integer,
        'student human review',
        auth.uid()
      );
    end if;
  end loop;

  return jsonb_build_object('meal_id', v_meal, 'scan_id', v_scan);
end;
$$;

revoke all on function public.confirm_scan(jsonb) from public;
grant execute on function public.confirm_scan(jsonb) to authenticated;
