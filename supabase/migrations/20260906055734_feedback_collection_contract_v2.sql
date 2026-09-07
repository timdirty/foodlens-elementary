-- Explicit collection states are evidence, not truthy/falsey defaults.
-- Legacy audit aggregates remain unchanged and are read as unverified.
create function private.validate_feedback_contract_v2(
  audit jsonb, contexts jsonb, feedback jsonb, actual_people integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reasons jsonb := audit -> 'reasonCounts';
  teacher jsonb := audit -> 'teacherContext';
  collection_status text := audit ->> 'reasonCollectionStatus';
  field_status text;
  field_value jsonb;
  entry record;
  value_sum numeric := 0;
  expected_feedback jsonb := '{}'::jsonb;
  actual_feedback jsonb := '{}'::jsonb;
  normalized_reason text;
  operation jsonb;
  expected_operation jsonb;
  expected_operation_status text;
begin
  if audit -> 'feedbackSchemaVersion' is distinct from '2'::jsonb
    or pg_catalog.jsonb_typeof(reasons) is distinct from 'object'
    or not (reasons ?& array['portion','taste','texture','temperature','time','other'])
    or not coalesce(collection_status in ('not-collected','collected','legacy-unverified'), false)
    or pg_catalog.jsonb_typeof(teacher) is distinct from 'object'
    or actual_people is null or actual_people <= 0
    or audit -> 'actualDiners' is distinct from pg_catalog.to_jsonb(actual_people)
  then
    raise exception 'invalid feedback v2 audit contract' using errcode = '22023';
  end if;
  for entry in select key, value from pg_catalog.jsonb_each(reasons) loop
    if entry.key !~ '^[a-z][a-z0-9-]{0,39}$'
      or pg_catalog.jsonb_typeof(entry.value) not in ('number','null') then
      raise exception 'invalid anonymous reason value' using errcode = '22023';
    end if;
    if entry.value <> 'null'::jsonb then
      if (entry.value::text)::numeric < 0 or (entry.value::text)::numeric > 20000
        or (entry.value::text)::numeric <> pg_catalog.trunc((entry.value::text)::numeric) then
        raise exception 'invalid anonymous reason count' using errcode = '22023';
      end if;
      value_sum := value_sum + (entry.value::text)::numeric;
    end if;
    if (collection_status = 'not-collected' and entry.value <> 'null'::jsonb)
      or (collection_status = 'collected' and entry.value = 'null'::jsonb) then
      raise exception 'reason collection status contradicts counts' using errcode = '22023';
    end if;
    if collection_status = 'collected' and (entry.value::text)::numeric > 0 then
      normalized_reason := case when entry.key in ('portion','taste','texture','temperature','time','nutrition','other') then entry.key else 'other' end;
      expected_feedback := pg_catalog.jsonb_set(expected_feedback, array[normalized_reason],
        pg_catalog.to_jsonb(coalesce((expected_feedback ->> normalized_reason)::integer, 0) + (entry.value::text)::integer));
    end if;
  end loop;
  if value_sum > actual_people then
    raise exception 'anonymous reason total exceeds actual diners' using errcode = '22023';
  end if;
  for entry in select * from (values ('deliveryStatus','deliveryDelayMinutes'), ('temperatureStatus','temperatureConcern')) as fields(status_key,value_key) loop
    field_status := teacher ->> entry.status_key;
    field_value := teacher -> entry.value_key;
    if not (teacher ? entry.value_key)
      or not coalesce(field_status in ('not-collected','recorded','legacy-unverified'), false)
      or (field_status = 'not-collected' and field_value <> 'null'::jsonb)
      or (field_status = 'recorded' and field_value = 'null'::jsonb) then
      raise exception 'teacher observation status contradicts value' using errcode = '22023';
    end if;
    if field_value <> 'null'::jsonb then
      if entry.value_key = 'deliveryDelayMinutes' then
        if pg_catalog.jsonb_typeof(field_value) is distinct from 'number' then
          raise exception 'delivery delay must be integer minutes or null' using errcode = '22023';
        end if;
        if (field_value::text)::numeric < 0 or (field_value::text)::numeric > 1440
          or (field_value::text)::numeric <> pg_catalog.trunc((field_value::text)::numeric) then
          raise exception 'delivery delay is outside allowed minutes' using errcode = '22023';
        end if;
      elsif pg_catalog.jsonb_typeof(field_value) is distinct from 'boolean' then
        raise exception 'temperature concern must be boolean or null' using errcode = '22023';
      end if;
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(teacher -> 'note') is distinct from 'string'
    or pg_catalog.char_length(teacher ->> 'note') > 500 then
    raise exception 'invalid teacher observation note' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(contexts) is distinct from 'array'
    or pg_catalog.jsonb_typeof(feedback) is distinct from 'array' then
    raise exception 'feedback projections must be arrays' using errcode = '22023';
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(contexts) as item where item ->> 'context_type' = 'operational') <> 1 then
    raise exception 'feedback v2 requires one operational context' using errcode = '22023';
  end if;
  select item into operation from pg_catalog.jsonb_array_elements(contexts) as item where item ->> 'context_type' = 'operational';
  expected_operation := pg_catalog.jsonb_build_object(
    'feedback_schema_version', 2, 'reason_collection_status', collection_status,
    'reason_counts', reasons, 'delivery_status', teacher -> 'deliveryStatus',
    'temperature_status', teacher -> 'temperatureStatus',
    'delivery_delay_minutes', teacher -> 'deliveryDelayMinutes',
    'temperature_concern', teacher -> 'temperatureConcern', 'note', teacher -> 'note');
  expected_operation_status := case when collection_status = 'collected'
    and teacher ->> 'deliveryStatus' = 'recorded' and teacher ->> 'temperatureStatus' = 'recorded'
    then 'confirmed' else 'recorded' end;
  if operation -> 'context_value' is distinct from expected_operation
    or operation ->> 'status' is distinct from expected_operation_status then
    raise exception 'operational projection does not match feedback audit' using errcode = '22023';
  end if;
  for entry in select value from pg_catalog.jsonb_array_elements(feedback) loop
    normalized_reason := entry.value ->> 'reason_code';
    if entry.value ->> 'actor_role' is distinct from 'student'
      or not coalesce(normalized_reason in ('portion','taste','texture','temperature','time','nutrition','other'), false)
      or pg_catalog.jsonb_typeof(entry.value -> 'response_count') is distinct from 'number' then
      raise exception 'invalid normalized anonymous feedback row' using errcode = '22023';
    end if;
    if (entry.value ->> 'response_count')::numeric <= 0
      or (entry.value ->> 'response_count')::numeric > 20000
      or (entry.value ->> 'response_count')::numeric <> pg_catalog.trunc((entry.value ->> 'response_count')::numeric)
      or actual_feedback ? normalized_reason then
      raise exception 'feedback counts must be explicit positive unique buckets' using errcode = '22023';
    end if;
    actual_feedback := pg_catalog.jsonb_set(actual_feedback, array[normalized_reason], entry.value -> 'response_count');
  end loop;
  if actual_feedback is distinct from expected_feedback then
    raise exception 'normalized feedback does not match collection status and audit counts' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.validate_feedback_contract_v2(jsonb,jsonb,jsonb,integer) from public, anon;
grant execute on function private.validate_feedback_contract_v2(jsonb,jsonb,jsonb,integer) to authenticated, service_role;

-- Check the final transaction state, since the atomic RPC replaces child rows.
-- Direct Data API writes must satisfy the same audit/projection invariant.
create function private.guard_feedback_projection_v2()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  school uuid;
  batch_id uuid;
  batch public.meal_batches%rowtype;
  contexts jsonb;
  feedback jsonb;
begin
  if tg_table_name = 'meal_batches' then
    school := new.school_id; batch_id := new.id;
    if tg_op = 'UPDATE' and old.audit_payload -> 'feedbackSchemaVersion' = '2'::jsonb
      and new.audit_payload -> 'feedbackSchemaVersion' is distinct from '2'::jsonb then
      raise exception 'feedback v2 audit cannot be downgraded' using errcode = '22023';
    end if;
  elsif tg_op = 'DELETE' then
    school := old.school_id; batch_id := old.meal_batch_id;
  else
    school := new.school_id; batch_id := new.meal_batch_id;
  end if;
  if tg_table_name <> 'meal_batches' then
    if tg_op = 'UPDATE' then
      if old.school_id is distinct from new.school_id or old.meal_batch_id is distinct from new.meal_batch_id then
        raise exception 'feedback evidence cannot change school or batch' using errcode = '22023';
      end if;
    end if;
  end if;
  select * into batch from public.meal_batches where school_id = school and id = batch_id for update;
  if not found or batch.audit_payload -> 'feedbackSchemaVersion' is distinct from '2'::jsonb then return null; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row)), '[]'::jsonb) into contexts
    from public.meal_contexts as row where row.school_id = school and row.meal_batch_id = batch_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row)), '[]'::jsonb) into feedback
    from public.feedback_events as row where row.school_id = school and row.meal_batch_id = batch_id;
  perform private.validate_feedback_contract_v2(batch.audit_payload, contexts, feedback, batch.actual_people);
  return null;
end;
$$;
revoke all on function private.guard_feedback_projection_v2() from public, anon, authenticated;
create constraint trigger meal_batches_feedback_v2 after insert or update on public.meal_batches
  deferrable initially deferred for each row execute function private.guard_feedback_projection_v2();
create constraint trigger meal_contexts_feedback_v2 after insert or update or delete on public.meal_contexts
  deferrable initially deferred for each row execute function private.guard_feedback_projection_v2();
create constraint trigger feedback_events_feedback_v2 after insert or update or delete on public.feedback_events
  deferrable initially deferred for each row execute function private.guard_feedback_projection_v2();

create function public.foodlens_feedback_contract_version()
returns integer language sql stable security invoker set search_path = '' as $$ select 2; $$;
revoke all on function public.foodlens_feedback_contract_version() from public, anon;
grant execute on function public.foodlens_feedback_contract_version() to authenticated, service_role;

create or replace function public.save_meal_evidence_chain(payload jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_school_id uuid;
  v_client_case_id uuid;
  v_menu jsonb;
  v_menu_items jsonb;
  v_meal_record jsonb;
  v_batch jsonb;
  v_contexts jsonb;
  v_feedback jsonb;
  v_measurements jsonb;
  v_human_decision jsonb;
  v_item jsonb;
  v_menu_version_id uuid;
  v_natural_menu_version_id uuid;
  v_requested_menu_version_id uuid;
  v_meal_record_id uuid;
  v_requested_meal_record_id uuid;
  v_batch_meal_record_id uuid;
  v_meal_batch_id uuid;
  v_requested_meal_batch_id uuid;
  v_child_id uuid;
  v_requested_menu_item_id uuid;
  v_canonical_menu_item_id uuid;
  v_client_menu_item_id uuid;
  v_menu_item_sort_order smallint;
  v_human_decision_id uuid;
  v_service_date date;
  v_batch_service_date date;
  v_meal_served_on date;
  v_meal_period text;
  v_batch_meal_period text;
  v_record_meal_period text;
  v_batch_class_id uuid;
  v_meal_class_id uuid;
  v_meal_total_supply_g integer;
  v_meal_leftover_g integer;
  v_menu_version_number integer;
  v_menu_status text;
  v_menu_item_id_map jsonb := '{}'::jsonb;
  v_menu_sort_order_map jsonb := '{}'::jsonb;
  v_menu_item_ids jsonb := '[]'::jsonb;
  v_context_ids jsonb := '[]'::jsonb;
  v_feedback_ids jsonb := '[]'::jsonb;
  v_measurement_ids jsonb := '[]'::jsonb;
  v_existing_batch boolean := false;
  v_payload_hash text;
  v_existing_payload_hash text;
begin
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'payload must be a JSON object';
  end if;

  begin
    v_school_id := nullif(payload ->> 'school_id', '')::uuid;
    v_client_case_id := nullif(payload ->> 'client_case_id', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '22023',
        message = 'school_id and client_case_id must be UUID values';
  end;

  if v_school_id is null or v_client_case_id is null then
    raise exception using
      errcode = '22023',
      message = 'school_id and client_case_id are required';
  end if;

  if auth.uid() is null
    or not private.is_school_member(
      v_school_id,
      array['teacher', 'admin']
    )
  then
    raise exception using
      errcode = '42501',
      message = 'not authorized for this school';
  end if;

  v_menu := payload -> 'menu_version';
  v_menu_items := payload -> 'menu_items';
  v_meal_record := payload -> 'meal_record';
  v_batch := payload -> 'meal_batch';
  v_contexts := payload -> 'contexts';
  v_feedback := payload -> 'feedback';
  v_measurements := payload -> 'measurements';
  v_human_decision := payload -> 'human_decision';

  if v_menu is null or pg_catalog.jsonb_typeof(v_menu) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'menu_version must be a JSON object';
  end if;
  if v_menu_items is null
    or pg_catalog.jsonb_typeof(v_menu_items) <> 'array'
    or pg_catalog.jsonb_array_length(v_menu_items) = 0
  then
    raise exception using
      errcode = '22023',
      message = 'menu_items must be a non-empty JSON array';
  end if;
  if v_meal_record is null
    or pg_catalog.jsonb_typeof(v_meal_record) <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record must be a JSON object';
  end if;
  if v_batch is null or pg_catalog.jsonb_typeof(v_batch) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'meal_batch must be a JSON object';
  end if;
  if pg_catalog.jsonb_typeof(v_meal_record -> 'side_dishes') <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'meal_record.side_dishes must be a JSON array';
  end if;

  if v_contexts is null or v_contexts = 'null'::jsonb then
    v_contexts := '[]'::jsonb;
  end if;
  if v_feedback is null or v_feedback = 'null'::jsonb then
    v_feedback := '[]'::jsonb;
  end if;
  if v_measurements is null or v_measurements = 'null'::jsonb then
    v_measurements := '[]'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(v_contexts) <> 'array'
    or pg_catalog.jsonb_typeof(v_feedback) <> 'array'
    or pg_catalog.jsonb_typeof(v_measurements) <> 'array'
  then
    raise exception using
      errcode = '22023',
      message = 'contexts, feedback, and measurements must be JSON arrays';
  end if;
  if v_human_decision is not null
    and v_human_decision <> 'null'::jsonb
    and pg_catalog.jsonb_typeof(v_human_decision) <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'human_decision must be a JSON object or null';
  end if;

  begin
    v_requested_menu_version_id :=
      nullif(v_menu ->> 'id', '')::uuid;
    v_requested_meal_record_id :=
      nullif(v_meal_record ->> 'id', '')::uuid;
    v_batch_meal_record_id :=
      nullif(v_batch ->> 'meal_record_id', '')::uuid;
    v_requested_meal_batch_id :=
      nullif(v_batch ->> 'id', '')::uuid;
    v_meal_class_id := nullif(v_meal_record ->> 'class_id', '')::uuid;
    v_batch_class_id := nullif(v_batch ->> 'class_id', '')::uuid;
    v_service_date := nullif(v_menu ->> 'service_date', '')::date;
    v_meal_served_on := nullif(v_meal_record ->> 'served_on', '')::date;
    v_menu_version_number :=
      nullif(v_menu ->> 'version_number', '')::integer;
    v_meal_total_supply_g :=
      nullif(v_meal_record ->> 'total_supply_g', '')::integer;
    v_meal_leftover_g :=
      nullif(v_meal_record ->> 'leftover_g', '')::integer;
    v_batch_service_date := coalesce(
      nullif(v_batch ->> 'service_date', '')::date,
      v_service_date
    );
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'menu, meal record, batch, or service values are invalid';
  end;

  if v_service_date is null then
    raise exception using
      errcode = '22023',
      message = 'menu_version.service_date is required';
  end if;
  if v_menu_version_number is null then
    raise exception using
      errcode = '22023',
      message = 'menu_version.version_number is required';
  end if;

  v_meal_period := coalesce(
    nullif(v_menu ->> 'meal_period', ''),
    'lunch'
  );
  v_batch_meal_period := coalesce(
    nullif(v_batch ->> 'meal_period', ''),
    v_meal_period
  );
  v_record_meal_period := coalesce(
    nullif(v_meal_record ->> 'meal_period', ''),
    v_meal_period
  );
  if v_batch_service_date <> v_service_date
    or v_batch_meal_period <> v_meal_period
  then
    raise exception using
      errcode = '22023',
      message = 'menu_version and meal_batch must describe the same date and meal period';
  end if;
  if v_requested_meal_record_id is null
    or v_batch_meal_record_id is null
    or v_requested_meal_record_id <> v_batch_meal_record_id
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record.id must equal meal_batch.meal_record_id';
  end if;
  if v_meal_class_id is null
    or v_batch_class_id is null
    or v_meal_class_id <> v_batch_class_id
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record and meal_batch must reference the same class';
  end if;
  if v_meal_served_on is null
    or v_meal_served_on <> v_batch_service_date
    or v_record_meal_period <> v_batch_meal_period
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record and meal_batch must describe the same date and meal period';
  end if;
  if v_meal_period <> 'lunch'
    or v_batch_meal_period <> 'lunch'
    or v_record_meal_period <> 'lunch'
  then
    raise exception using
      errcode = '22023',
      message = 'FoodLens currently supports lunch meal periods only';
  end if;
  if v_meal_total_supply_g is null
    or v_meal_total_supply_g < 0
    or v_meal_leftover_g is null
    or v_meal_leftover_g < 0
    or v_meal_leftover_g > v_meal_total_supply_g
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record leftover weight must be between zero and total supply';
  end if;
  if coalesce(v_meal_record ->> 'measurement_method', '')
    not in ('scale', 'manual', 'sample-extrapolation')
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record measurement_method is not supported';
  end if;
  if coalesce(v_meal_record ->> 'source', '') not in ('manual', 'import') then
    raise exception using
      errcode = '22023',
      message = 'meal_record source is not supported';
  end if;

  perform 1
  from public.classes as class
  where class.school_id = v_school_id
    and class.id = v_meal_class_id;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'meal_record class does not belong to the current school';
  end if;

  -- Serialize concurrent retries of the same school-scoped client key. The
  -- unique constraint remains the final database invariant.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_school_id::text || ':' || v_client_case_id::text,
      0
    )
  );

  -- Different class cases can share one school/date/period/version menu. Lock
  -- that natural key as well as the client case so concurrent writers cannot
  -- race to create different UUIDs for the same canonical menu.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meal-menu:' || v_school_id::text || ':' || v_service_date::text || ':'
        || v_meal_period || ':' || v_menu_version_number::text,
      0
    )
  );

  select menu.id
  into v_natural_menu_version_id
  from public.menu_versions as menu
  where menu.school_id = v_school_id
    and menu.service_date = v_service_date
    and menu.meal_period = v_meal_period
    and menu.version_number = v_menu_version_number
  for update;

  v_payload_hash := pg_catalog.md5(payload::text);

  select
    batch.id,
    batch.menu_version_id,
    batch.meal_record_id,
    batch.payload_hash
  into
    v_meal_batch_id,
    v_menu_version_id,
    v_meal_record_id,
    v_existing_payload_hash
  from public.meal_batches as batch
  where batch.school_id = v_school_id
    and batch.client_case_id = v_client_case_id
  for update;
  v_existing_batch := found;

  if v_existing_batch then
    if v_requested_meal_batch_id is not null
      and v_requested_meal_batch_id <> v_meal_batch_id
    then
      raise exception using
        errcode = '23505',
        message = 'client_case_id already belongs to a different meal_batch id';
    end if;
    if v_meal_record_id is null
      or v_requested_meal_record_id <> v_meal_record_id
    then
      raise exception using
        errcode = '23505',
        message = 'client_case_id already belongs to a different meal_record id';
    end if;
    -- A payload UUID is only a client alias. The persisted batch must keep the
    -- canonical menu selected by the school/date/period/version natural key.
    if v_natural_menu_version_id is null
      or v_natural_menu_version_id <> v_menu_version_id
    then
      raise exception using
        errcode = '23505',
        message = 'client_case_id already belongs to a different canonical menu';
    end if;

    -- An exact network retry must not rewrite created_at or evidence timestamps.
    -- A changed payload with the same case and stable aggregate IDs is treated
    -- as an intentional replacement and continues through the transaction.
    if v_existing_payload_hash = v_payload_hash then
      select coalesce(
        pg_catalog.jsonb_agg(
          coalesce(
            canonical_item.id,
            (entry.value ->> 'id')::uuid
          )
          order by entry.ordinality
        ),
        '[]'::jsonb
      )
      into v_menu_item_ids
      from pg_catalog.jsonb_array_elements(v_menu_items)
        with ordinality as entry(value, ordinality)
      join public.menu_items as canonical_item
        on canonical_item.school_id = v_school_id
       and canonical_item.menu_version_id = v_menu_version_id
       and canonical_item.sort_order =
         (entry.value ->> 'sort_order')::smallint;

      if pg_catalog.jsonb_array_length(v_menu_item_ids)
        <> pg_catalog.jsonb_array_length(v_menu_items)
      then
        raise exception using
          errcode = '23514',
          message = 'stored canonical menu items do not match retry payload';
      end if;

      select coalesce(
        pg_catalog.jsonb_agg(
          (entry.value ->> 'id')::uuid
          order by entry.ordinality
        ),
        '[]'::jsonb
      )
      into v_context_ids
      from pg_catalog.jsonb_array_elements(v_contexts)
        with ordinality as entry(value, ordinality);

      select coalesce(
        pg_catalog.jsonb_agg(
          (entry.value ->> 'id')::uuid
          order by entry.ordinality
        ),
        '[]'::jsonb
      )
      into v_feedback_ids
      from pg_catalog.jsonb_array_elements(v_feedback)
        with ordinality as entry(value, ordinality);

      select coalesce(
        pg_catalog.jsonb_agg(
          (entry.value ->> 'id')::uuid
          order by entry.ordinality
        ),
        '[]'::jsonb
      )
      into v_measurement_ids
      from pg_catalog.jsonb_array_elements(v_measurements)
        with ordinality as entry(value, ordinality);

      if v_human_decision is not null
        and v_human_decision <> 'null'::jsonb
      then
        v_human_decision_id :=
          nullif(v_human_decision ->> 'id', '')::uuid;
      end if;

      return pg_catalog.jsonb_build_object(
        'school_id', v_school_id,
        'client_case_id', v_client_case_id,
        'menu_version_id', v_menu_version_id,
        'meal_record_id', v_meal_record_id,
        'meal_batch_id', v_meal_batch_id,
        'menu_item_ids', v_menu_item_ids,
        'context_ids', v_context_ids,
        'feedback_ids', v_feedback_ids,
        'measurement_ids', v_measurement_ids,
        'human_decision_id', v_human_decision_id
      );
    end if;
  else
    v_meal_record_id := v_requested_meal_record_id;
    v_meal_batch_id := coalesce(
      v_requested_meal_batch_id,
      pg_catalog.gen_random_uuid()
    );
    v_menu_version_id := v_natural_menu_version_id;

    if v_menu_version_id is null
      and v_requested_menu_version_id is not null
      and exists (
        select 1
        from public.menu_versions as requested_menu
        where requested_menu.school_id = v_school_id
          and requested_menu.id = v_requested_menu_version_id
      )
    then
      raise exception using
        errcode = '23505',
        message = 'requested menu_version id already belongs to another natural key';
    end if;

    v_menu_version_id := coalesce(
      v_menu_version_id,
      v_requested_menu_version_id,
      pg_catalog.gen_random_uuid()
    );
  end if;

  perform private.validate_feedback_contract_v2(payload -> 'audit_payload', v_contexts, v_feedback, (v_batch ->> 'actual_people')::integer);

  v_menu_status := coalesce(nullif(v_menu ->> 'status', ''), 'draft');

  insert into public.menu_versions (
    id,
    school_id,
    service_date,
    meal_period,
    version_number,
    title,
    source_system,
    source_reference,
    status,
    provenance,
    confirmed_by,
    confirmed_at
  ) values (
    v_menu_version_id,
    v_school_id,
    v_service_date,
    v_meal_period,
    v_menu_version_number,
    v_menu ->> 'title',
    v_menu ->> 'source_system',
    nullif(v_menu ->> 'source_reference', ''),
    v_menu_status,
    v_menu ->> 'provenance',
    case when v_menu_status = 'confirmed' then auth.uid() end,
    case
      when v_menu_status = 'confirmed' then coalesce(
        nullif(v_menu ->> 'confirmed_at', '')::timestamptz,
        pg_catalog.now()
      )
    end
  )
  on conflict on constraint menu_versions_service_version_key do update set
    title = excluded.title,
    source_system = excluded.source_system,
    source_reference = excluded.source_reference,
    status = excluded.status,
    provenance = excluded.provenance,
    confirmed_by = excluded.confirmed_by,
    confirmed_at = excluded.confirmed_at
  returning id into v_menu_version_id;

  for v_item in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_menu_items) as entry(value)
  loop
    begin
      v_requested_menu_item_id := nullif(v_item ->> 'id', '')::uuid;
      v_menu_item_sort_order :=
        nullif(v_item ->> 'sort_order', '')::smallint;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = 'every menu_items entry requires a UUID id and integer sort_order';
    end;
    if v_requested_menu_item_id is null then
      raise exception using
        errcode = '22023',
        message = 'every menu_items entry requires id';
    end if;
    if v_menu_item_id_map ? v_requested_menu_item_id::text then
      raise exception using
        errcode = '22023',
        message = 'menu_items ids must be unique within a payload';
    end if;
    if v_menu_item_sort_order is null then
      raise exception using
        errcode = '22023',
        message = 'every menu_items entry requires sort_order';
    end if;
    if v_menu_sort_order_map ? v_menu_item_sort_order::text then
      raise exception using
        errcode = '22023',
        message = 'menu_items sort_order values must be unique within a payload';
    end if;
    v_menu_sort_order_map := v_menu_sort_order_map
      || pg_catalog.jsonb_build_object(v_menu_item_sort_order::text, true);

    -- sort_order is the stable item identity inside a canonical menu version.
    -- A client-generated UUID is retained as an alias so child references can
    -- be translated without weakening the composite tenant foreign keys.
    select menu_item.id
    into v_canonical_menu_item_id
    from public.menu_items as menu_item
    where menu_item.school_id = v_school_id
      and menu_item.menu_version_id = v_menu_version_id
      and menu_item.sort_order = v_menu_item_sort_order
    for update;

    if v_canonical_menu_item_id is null then
      if exists (
        select 1
        from public.menu_items as requested_item
        where requested_item.school_id = v_school_id
          and requested_item.id = v_requested_menu_item_id
      ) then
        raise exception using
          errcode = '23505',
          message = 'requested menu_items.id already belongs to another menu or sort order';
      end if;
      v_canonical_menu_item_id := v_requested_menu_item_id;
    end if;

    insert into public.menu_items (
      id,
      school_id,
      menu_version_id,
      sort_order,
      display_name,
      normalized_name,
      category,
      preparation_method,
      standard_portion_g,
      weight_basis,
      status,
      provenance
    ) values (
      v_canonical_menu_item_id,
      v_school_id,
      v_menu_version_id,
      v_menu_item_sort_order,
      v_item ->> 'display_name',
      v_item ->> 'normalized_name',
      v_item ->> 'category',
      nullif(v_item ->> 'preparation_method', ''),
      nullif(v_item ->> 'standard_portion_g', '')::integer,
      nullif(v_item ->> 'weight_basis', ''),
      coalesce(nullif(v_item ->> 'status', ''), 'proposed'),
      v_item ->> 'provenance'
    )
    on conflict on constraint menu_items_school_menu_sort_key do update set
      display_name = excluded.display_name,
      normalized_name = excluded.normalized_name,
      category = excluded.category,
      preparation_method = excluded.preparation_method,
      standard_portion_g = excluded.standard_portion_g,
      weight_basis = excluded.weight_basis,
      status = excluded.status,
      provenance = excluded.provenance
    returning id into v_canonical_menu_item_id;

    v_menu_item_id_map := v_menu_item_id_map
      || pg_catalog.jsonb_build_object(
        v_requested_menu_item_id::text,
        v_canonical_menu_item_id::text
      );

    v_menu_item_ids := v_menu_item_ids
      || pg_catalog.jsonb_build_array(v_canonical_menu_item_id);
  end loop;

  -- Persist the operational summary before the optional one-to-one batch link.
  -- Any later batch or child failure still rolls this upsert back because the
  -- complete function call is one PostgreSQL transaction statement.
  insert into public.meal_records (
    id,
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
    created_by,
    created_at,
    updated_at
  ) values (
    v_meal_record_id,
    v_school_id,
    v_meal_class_id,
    v_meal_served_on,
    v_record_meal_period,
    v_meal_record ->> 'staple',
    v_meal_record ->> 'main_dish',
    array(
      select pg_catalog.jsonb_array_elements_text(
        v_meal_record -> 'side_dishes'
      )
    ),
    v_meal_record ->> 'menu_signature',
    (v_meal_record ->> 'planned_people')::integer,
    (v_meal_record ->> 'actual_people')::integer,
    v_meal_total_supply_g,
    v_meal_leftover_g,
    v_meal_record ->> 'measurement_method',
    coalesce(v_meal_record ->> 'notes', ''),
    v_meal_record ->> 'source',
    auth.uid(),
    coalesce(
      nullif(v_meal_record ->> 'created_at', '')::timestamptz,
      pg_catalog.now()
    ),
    coalesce(
      nullif(v_meal_record ->> 'updated_at', '')::timestamptz,
      pg_catalog.now()
    )
  )
  on conflict (school_id, id) do update set
    class_id = excluded.class_id,
    served_on = excluded.served_on,
    meal_period = excluded.meal_period,
    staple = excluded.staple,
    main_dish = excluded.main_dish,
    side_dishes = excluded.side_dishes,
    menu_signature = excluded.menu_signature,
    planned_people = excluded.planned_people,
    actual_people = excluded.actual_people,
    total_supply_g = excluded.total_supply_g,
    leftover_g = excluded.leftover_g,
    measurement_method = excluded.measurement_method,
    notes = excluded.notes,
    source = excluded.source,
    updated_at = excluded.updated_at
  returning id into v_meal_record_id;

  insert into public.meal_batches (
    id,
    school_id,
    client_case_id,
    payload_hash,
    audit_payload,
    meal_record_id,
    menu_version_id,
    class_id,
    service_date,
    meal_period,
    status,
    planned_people,
    notified_people,
    actual_people,
    planned_supply_g,
    produced_weight_g,
    delivered_weight_g,
    served_weight_g,
    weight_basis,
    provenance
  ) values (
    v_meal_batch_id,
    v_school_id,
    v_client_case_id,
    v_payload_hash,
    coalesce(payload -> 'audit_payload', '{}'::jsonb),
    v_meal_record_id,
    v_menu_version_id,
    nullif(v_batch ->> 'class_id', '')::uuid,
    v_batch_service_date,
    v_batch_meal_period,
    coalesce(nullif(v_batch ->> 'status', ''), 'planned'),
    (v_batch ->> 'planned_people')::integer,
    nullif(v_batch ->> 'notified_people', '')::integer,
    nullif(v_batch ->> 'actual_people', '')::integer,
    (v_batch ->> 'planned_supply_g')::integer,
    nullif(v_batch ->> 'produced_weight_g', '')::integer,
    nullif(v_batch ->> 'delivered_weight_g', '')::integer,
    nullif(v_batch ->> 'served_weight_g', '')::integer,
    v_batch ->> 'weight_basis',
    v_batch ->> 'provenance'
  )
  on conflict (school_id, client_case_id) do update set
    payload_hash = excluded.payload_hash,
    audit_payload = excluded.audit_payload,
    meal_record_id = excluded.meal_record_id,
    menu_version_id = excluded.menu_version_id,
    class_id = excluded.class_id,
    service_date = excluded.service_date,
    meal_period = excluded.meal_period,
    status = excluded.status,
    planned_people = excluded.planned_people,
    notified_people = excluded.notified_people,
    actual_people = excluded.actual_people,
    planned_supply_g = excluded.planned_supply_g,
    produced_weight_g = excluded.produced_weight_g,
    delivered_weight_g = excluded.delivered_weight_g,
    served_weight_g = excluded.served_weight_g,
    weight_basis = excluded.weight_basis,
    provenance = excluded.provenance
  returning id into v_meal_batch_id;

  -- Only batch-owned children are replaced. Menu items remain version-owned
  -- and are upserted by stable IDs so another class can reuse the same menu.
  delete from public.human_decisions
  where school_id = v_school_id
    and meal_batch_id = v_meal_batch_id;
  delete from public.feedback_events
  where school_id = v_school_id
    and meal_batch_id = v_meal_batch_id;
  delete from public.waste_measurements
  where school_id = v_school_id
    and meal_batch_id = v_meal_batch_id;
  delete from public.meal_contexts
  where school_id = v_school_id
    and meal_batch_id = v_meal_batch_id;

  for v_item in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_contexts) as entry(value)
  loop
    v_child_id := nullif(v_item ->> 'id', '')::uuid;
    if v_child_id is null then
      raise exception using
        errcode = '22023',
        message = 'every contexts entry requires a UUID id';
    end if;

    insert into public.meal_contexts (
      id,
      school_id,
      meal_batch_id,
      context_type,
      context_value,
      observed_at,
      status,
      source_reference,
      provenance
    ) values (
      v_child_id,
      v_school_id,
      v_meal_batch_id,
      v_item ->> 'context_type',
      v_item -> 'context_value',
      coalesce(
        nullif(v_item ->> 'observed_at', '')::timestamptz,
        pg_catalog.now()
      ),
      coalesce(nullif(v_item ->> 'status', ''), 'recorded'),
      nullif(v_item ->> 'source_reference', ''),
      v_item ->> 'provenance'
    );

    v_context_ids := v_context_ids
      || pg_catalog.jsonb_build_array(v_child_id);
  end loop;

  for v_item in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_feedback) as entry(value)
  loop
    v_child_id := nullif(v_item ->> 'id', '')::uuid;
    if v_child_id is null then
      raise exception using
        errcode = '22023',
        message = 'every feedback entry requires a UUID id';
    end if;
    v_client_menu_item_id := nullif(v_item ->> 'menu_item_id', '')::uuid;
    if v_client_menu_item_id is null then
      v_canonical_menu_item_id := null;
    elsif not (v_menu_item_id_map ? v_client_menu_item_id::text) then
      raise exception using
        errcode = '22023',
        message = 'feedback.menu_item_id must reference a menu item in the payload';
    else
      v_canonical_menu_item_id :=
        (v_menu_item_id_map ->> v_client_menu_item_id::text)::uuid;
    end if;

    insert into public.feedback_events (
      id,
      school_id,
      meal_batch_id,
      menu_item_id,
      actor_role,
      reason_code,
      rating,
      response_count,
      note,
      status,
      provenance
    ) values (
      v_child_id,
      v_school_id,
      v_meal_batch_id,
      v_canonical_menu_item_id,
      v_item ->> 'actor_role',
      v_item ->> 'reason_code',
      nullif(v_item ->> 'rating', '')::smallint,
      coalesce(nullif(v_item ->> 'response_count', '')::integer, 1),
      coalesce(v_item ->> 'note', ''),
      coalesce(nullif(v_item ->> 'status', ''), 'submitted'),
      v_item ->> 'provenance'
    );

    v_feedback_ids := v_feedback_ids
      || pg_catalog.jsonb_build_array(v_child_id);
  end loop;

  for v_item in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_measurements) as entry(value)
  loop
    v_child_id := nullif(v_item ->> 'id', '')::uuid;
    if v_child_id is null then
      raise exception using
        errcode = '22023',
        message = 'every measurements entry requires a UUID id';
    end if;
    v_client_menu_item_id := nullif(v_item ->> 'menu_item_id', '')::uuid;
    if v_client_menu_item_id is null then
      v_canonical_menu_item_id := null;
    elsif not (v_menu_item_id_map ? v_client_menu_item_id::text) then
      raise exception using
        errcode = '22023',
        message = 'measurements.menu_item_id must reference a menu item in the payload';
    else
      v_canonical_menu_item_id :=
        (v_menu_item_id_map ->> v_client_menu_item_id::text)::uuid;
    end if;

    insert into public.waste_measurements (
      id,
      school_id,
      meal_batch_id,
      menu_item_id,
      waste_source,
      measurement_method,
      weight_state,
      net_weight_g,
      tare_weight_g,
      gross_weight_g,
      estimate_low_g,
      estimate_high_g,
      contamination_g,
      sample_plate_count,
      measured_at,
      status,
      provenance,
      note
    ) values (
      v_child_id,
      v_school_id,
      v_meal_batch_id,
      v_canonical_menu_item_id,
      v_item ->> 'waste_source',
      v_item ->> 'measurement_method',
      v_item ->> 'weight_state',
      (v_item ->> 'net_weight_g')::integer,
      nullif(v_item ->> 'tare_weight_g', '')::integer,
      nullif(v_item ->> 'gross_weight_g', '')::integer,
      nullif(v_item ->> 'estimate_low_g', '')::integer,
      nullif(v_item ->> 'estimate_high_g', '')::integer,
      coalesce(nullif(v_item ->> 'contamination_g', '')::integer, 0),
      nullif(v_item ->> 'sample_plate_count', '')::integer,
      coalesce(
        nullif(v_item ->> 'measured_at', '')::timestamptz,
        pg_catalog.now()
      ),
      coalesce(nullif(v_item ->> 'status', ''), 'recorded'),
      v_item ->> 'provenance',
      coalesce(v_item ->> 'note', '')
    );

    v_measurement_ids := v_measurement_ids
      || pg_catalog.jsonb_build_array(v_child_id);
  end loop;

  if v_human_decision is not null
    and v_human_decision <> 'null'::jsonb
  then
    v_human_decision_id :=
      nullif(v_human_decision ->> 'id', '')::uuid;
    if v_human_decision_id is null then
      raise exception using
        errcode = '22023',
        message = 'human_decision.id must be a UUID';
    end if;

    insert into public.human_decisions (
      id,
      school_id,
      recommendation_kind,
      recommendation_key,
      prediction_id,
      meal_batch_id,
      decision,
      decided_by_role,
      decided_supply_g,
      safety_margin_g,
      rationale,
      status,
      provenance,
      decided_at
    ) values (
      v_human_decision_id,
      v_school_id,
      v_human_decision ->> 'recommendation_kind',
      v_human_decision ->> 'recommendation_key',
      nullif(v_human_decision ->> 'prediction_id', ''),
      v_meal_batch_id,
      v_human_decision ->> 'decision',
      nullif(v_human_decision ->> 'decided_by_role', ''),
      nullif(v_human_decision ->> 'decided_supply_g', '')::integer,
      coalesce(
        nullif(v_human_decision ->> 'safety_margin_g', '')::integer,
        0
      ),
      v_human_decision ->> 'rationale',
      coalesce(nullif(v_human_decision ->> 'status', ''), 'active'),
      v_human_decision ->> 'provenance',
      coalesce(
        nullif(v_human_decision ->> 'decided_at', '')::timestamptz,
        pg_catalog.now()
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'school_id', v_school_id,
    'client_case_id', v_client_case_id,
    'menu_version_id', v_menu_version_id,
    'meal_record_id', v_meal_record_id,
    'meal_batch_id', v_meal_batch_id,
    'menu_item_ids', v_menu_item_ids,
    'context_ids', v_context_ids,
    'feedback_ids', v_feedback_ids,
    'measurement_ids', v_measurement_ids,
    'human_decision_id', v_human_decision_id
  );
end;
$function$;

comment on function public.save_meal_evidence_chain(jsonb) is
  'Atomically replaces one school meal batch evidence aggregate. Stable client_case_id and child UUIDs make network retries duplicate-safe.';

revoke all on function public.save_meal_evidence_chain(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_meal_evidence_chain(jsonb)
to authenticated;
