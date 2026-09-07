-- Make the class-level meal measurement independent from plate-image estimates.
alter table public.supply_predictions
  add column independent_date_count integer not null default 0,
  add column evidence_meal_ids text[] not null default '{}',
  add constraint supply_predictions_independent_date_count_check
    check (independent_date_count >= 0 and independent_date_count <= sample_size);

alter table public.meal_records
  add constraint meal_records_measurement_is_meal_level
    check (measurement_method in ('scale', 'manual')) not valid;

alter table public.experiments
  add constraint experiments_periods_do_not_overlap
    check (baseline_end < intervention_start) not valid;

-- Current local/cloud Data API defaults may auto-grant table privileges.
-- Re-establish the intended API boundary explicitly: raw scan rows are only
-- inserted by confirm_scan(), while teachers manage operational records.
revoke all on all tables in schema public from anon, authenticated;
grant select on
  public.schools,
  public.memberships,
  public.classes,
  public.meal_records,
  public.plate_scans,
  public.scan_detections,
  public.scan_corrections,
  public.supply_predictions,
  public.experiments,
  public.research_sections,
  public.impact_settings,
  public.project_profiles
to authenticated;
grant insert, update, delete on
  public.classes,
  public.meal_records,
  public.supply_predictions,
  public.experiments,
  public.research_sections,
  public.impact_settings,
  public.project_profiles
to authenticated;

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
  v_detection_count integer;
  v_correction_count integer;
  v_plate_estimate integer := 0;
  v_measured_leftover integer;
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

    v_plate_estimate := v_plate_estimate + (v_correction ->> 'remainingG')::integer;
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

    if v_plate_estimate > v_meal_supply then
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

    v_measured_leftover := nullif(payload #>> '{meal,leftover_g}', '')::integer;

    if coalesce(payload #>> '{meal,measurement_method}', '') not in ('scale', 'manual') then
      raise exception 'meal leftover must come from a scale or manual meal-level measurement'
        using errcode = '22023';
    end if;

    if v_measured_leftover is null or v_measured_leftover < 0 then
      raise exception 'meal-level leftover weight is required'
        using errcode = '22023';
    end if;

    if (payload #>> '{meal,planned_people}')::integer < 1
      or (payload #>> '{meal,actual_people}')::integer < 1
      or (payload #>> '{meal,total_supply_g}')::integer < v_measured_leftover then
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
      v_measured_leftover,
      payload #>> '{meal,measurement_method}',
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
