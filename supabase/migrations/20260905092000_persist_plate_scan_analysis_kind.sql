-- Persist plate-analysis provenance as a constrained identity instead of
-- reconstructing it later from arbitrary provider display text.
alter table public.plate_scans
  add column analysis_kind text;

-- Old rows never persisted analysis.isMock. Only the two reserved FoodLens
-- sources are deterministic; every other legacy provider remains unverified.
update public.plate_scans
set analysis_kind = case
  when lower(btrim(provider)) = 'human-manual' then 'human-manual'
  when lower(btrim(provider)) = 'foodlens-mock' then 'mock-ai'
  else 'source-unverified'
end;

alter table public.plate_scans
  alter column analysis_kind set not null,
  add constraint plate_scans_analysis_kind_check
    check (
      analysis_kind in (
        'mock-ai',
        'real-ai',
        'human-manual',
        'source-unverified'
      )
    );

comment on column public.plate_scans.analysis_kind is
  'Server-derived plate analysis identity. Provider is audit detail only; legacy unknown providers remain source-unverified.';

-- This is the complete current privileged implementation. The public
-- security-invoker wrapper remains unchanged and is still the only exposed RPC.
create or replace function private.confirm_scan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_request uuid;
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
  v_provider text;
  v_model text;
  v_is_mock boolean;
  v_analysis_kind text;
  v_existing public.plate_scans%rowtype;
begin
  -- Keep malformed identifiers inside the stable RPC error contract instead of
  -- leaking PostgreSQL cast errors from DECLARE initializers.
  begin
    v_school := nullif(payload ->> 'school_id', '')::uuid;
    v_request := nullif(payload ->> 'client_request_id', '')::uuid;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'scan payload contains an invalid or out-of-range number or identifier';
  end;

  if v_school is null or v_request is null then
    raise exception 'school_id and client_request_id are required'
      using errcode = '22023';
  end if;

  if not private.is_school_member(v_school, array['teacher', 'admin']) then
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

  v_provider := btrim(coalesce(payload #>> '{analysis,provider}', ''));
  v_model := btrim(coalesce(payload #>> '{analysis,model}', ''));
  if v_provider = '' or v_model = '' then
    raise exception 'analysis provider and model are required'
      using errcode = '22023';
  end if;
  if char_length(v_provider) > 80 or char_length(v_model) > 120 then
    raise exception 'analysis provider or model exceeds its length limit'
      using errcode = '22023';
  end if;

  if payload #> '{analysis,analysisKind}' is not null
    or payload #> '{analysis,analysis_kind}' is not null
    or payload -> 'analysis_kind' is not null then
    raise exception 'analysis kind is server-derived and must not be supplied'
      using errcode = '22023';
  end if;

  if jsonb_typeof(payload #> '{analysis,isMock}') is distinct from 'boolean' then
    raise exception 'analysis.isMock must be a boolean'
      using errcode = '22023';
  end if;
  v_is_mock := (payload #>> '{analysis,isMock}')::boolean;

  if lower(v_provider) = 'human-manual' then
    if v_is_mock then
      raise exception 'human-manual analysis cannot be marked as Mock AI'
        using errcode = '22023';
    end if;
    v_analysis_kind := 'human-manual';
  elsif lower(v_provider) = 'foodlens-mock' then
    if not v_is_mock then
      raise exception 'foodlens-mock provider must be marked as Mock AI'
        using errcode = '22023';
    end if;
    v_analysis_kind := 'mock-ai';
  elsif v_is_mock then
    v_analysis_kind := 'mock-ai';
  else
    v_analysis_kind := 'real-ai';
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

    if btrim(coalesce(v_item ->> 'label', '')) = ''
      or btrim(coalesce(v_correction ->> 'label', '')) = ''
      or char_length(btrim(v_item ->> 'label')) > 30
      or char_length(btrim(v_correction ->> 'label')) > 30 then
      raise exception 'detection labels must contain 1 to 30 characters'
        using errcode = '22023';
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
    exception
      when invalid_text_representation or numeric_value_out_of_range then
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
    analysis_kind,
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
    v_analysis_kind,
    v_provider,
    v_model,
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
      btrim(v_item ->> 'label'),
      (v_item ->> 'originalG')::integer,
      (v_item ->> 'remainingRatio')::numeric,
      (v_item ->> 'remainingG')::integer,
      (v_item ->> 'confidence')::numeric,
      v_index
    )
    returning id into v_detection;

    if v_correction ->> 'category' <> v_item ->> 'category'
      or btrim(v_correction ->> 'label') <> btrim(v_item ->> 'label')
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
        btrim(v_correction ->> 'label'),
        (v_correction ->> 'originalG')::integer,
        (v_correction ->> 'remainingRatio')::numeric,
        (v_correction ->> 'remainingG')::integer,
        'student human review',
        auth.uid()
      );
    end if;
  end loop;

  return jsonb_build_object('meal_id', v_meal, 'scan_id', v_scan);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'scan payload contains an invalid or out-of-range number or identifier';
end;
$$;

revoke all on function private.confirm_scan(jsonb)
from public, anon, authenticated, service_role;
grant execute on function private.confirm_scan(jsonb) to authenticated;
