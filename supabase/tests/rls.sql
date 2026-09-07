begin;
set local search_path = public, extensions;

select plan(110);

select is(
  (
    select count(*)::integer
    from pg_class
    where oid = any (
      array[
        'public.schools'::regclass,
        'public.memberships'::regclass,
        'public.classes'::regclass,
        'public.meal_records'::regclass,
        'public.plate_scans'::regclass,
        'public.scan_detections'::regclass,
        'public.scan_corrections'::regclass,
        'public.supply_predictions'::regclass,
        'public.experiments'::regclass,
        'public.research_sections'::regclass,
        'public.impact_settings'::regclass,
        'public.project_profiles'::regclass,
        'public.data_retention_runs'::regclass,
        'public.menu_versions'::regclass,
        'public.menu_items'::regclass,
        'public.meal_batches'::regclass,
        'public.meal_contexts'::regclass,
        'public.feedback_events'::regclass,
        'public.waste_measurements'::regclass,
        'public.human_decisions'::regclass,
        'public.collection_events'::regclass,
        'public.destination_receipts'::regclass
      ]
    )
      and relrowsecurity
  ),
  22,
  'all operational tables have RLS'
);

select ok(not has_table_privilege('anon', 'public.meal_records', 'select'), 'anon cannot read meals');
select ok(not has_table_privilege('anon', 'public.research_sections', 'select'), 'anon cannot read research content');
select ok(has_function_privilege('authenticated', 'public.confirm_scan(jsonb)', 'execute'), 'authenticated can call atomic confirm_scan');
select ok(
  has_function_privilege('authenticated', 'public.consume_ai_quota(uuid)', 'execute'),
  'authenticated sessions can call the public AI quota RPC'
);
select ok(
  not has_function_privilege('anon', 'public.consume_ai_quota(uuid)', 'execute'),
  'anon cannot execute the AI quota RPC'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.ai_quota_windows'::regclass
  ),
  'the private AI quota table has RLS defense in depth'
);
select ok(
  not has_table_privilege('anon', 'private.ai_quota_windows', 'select')
    and not has_table_privilege('anon', 'private.ai_quota_windows', 'insert')
    and not has_table_privilege('authenticated', 'private.ai_quota_windows', 'select')
    and not has_table_privilege('authenticated', 'private.ai_quota_windows', 'insert')
    and not has_table_privilege('authenticated', 'private.ai_quota_windows', 'update')
    and not has_table_privilege('authenticated', 'private.ai_quota_windows', 'delete'),
  'browser roles have no direct access to private AI quota state'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'private'
      and tablename = 'ai_quota_windows'
  ),
  0,
  'the private AI quota table exposes no row policy to browser roles'
);
select ok(
  (
    select not prosecdef
      and proconfig @> array['search_path=""']::text[]
    from pg_proc
    where oid = 'public.consume_ai_quota(uuid)'::regprocedure
  ),
  'the public AI quota RPC is an invoker wrapper with a pinned search path'
);
select ok(
  (
    select prosecdef
      and proconfig @> array['search_path=""']::text[]
    from pg_proc
    where oid = 'private.consume_ai_quota(uuid)'::regprocedure
  ),
  'the privileged AI quota implementation stays private with a pinned search path'
);
select has_trigger('public', 'scan_detections', 'scan_detections_immutable', 'AI raw detections are immutable');
select ok(not has_table_privilege('authenticated', 'public.scan_detections', 'insert'), 'authenticated cannot bypass the scan RPC');
select ok(
  not has_table_privilege('authenticated', 'public.plate_scans', 'insert,update,delete')
    and not has_table_privilege('authenticated', 'public.scan_detections', 'insert,update,delete')
    and not has_table_privilege('authenticated', 'public.scan_corrections', 'insert,update,delete'),
  'authenticated receives read-only grants on every raw AI audit table'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.meal_batches',
    'delete'
  ),
  'authenticated cannot delete a meal batch and cascade its trace evidence'
);
select ok(
  not has_function_privilege('authenticated', 'private.set_updated_at()', 'execute')
    and not has_function_privilege('authenticated', 'private.force_created_by()', 'execute')
    and not has_function_privilege('authenticated', 'private.force_updated_by()', 'execute')
    and not has_function_privilege('authenticated', 'private.block_detection_mutation()', 'execute')
    and not has_function_privilege('authenticated', 'private.guard_final_trace_meal_batch()', 'execute')
    and not has_function_privilege('authenticated', 'private.guard_final_trace_upstream_child()', 'execute')
    and not has_function_privilege('authenticated', 'private.guard_destination_receipt_lifecycle()', 'execute')
    and not has_function_privilege('authenticated', 'private.guard_final_collection_delete()', 'execute')
    and not has_function_privilege('authenticated', 'private.guard_final_receipt_delete()', 'execute'),
  'authenticated cannot execute internal trigger functions'
);
select ok(exists (select 1 from pg_constraint where conname = 'plate_scans_school_request_key' and contype = 'u'), 'scan idempotency key is scoped by school');
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plate_scans'
      and column_name = 'analysis_kind'
      and is_nullable = 'NO'
  ),
  'every plate scan persists a non-null analysis identity'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.plate_scans'::regclass
      and conname = 'plate_scans_analysis_kind_check'
      and contype = 'c'
      and convalidated
      and pg_get_constraintdef(oid) like '%source-unverified%'
  ),
  'plate scan analysis identity is protected by a validated allowlist constraint'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.scan_corrections'::regclass
      and conname = 'scan_corrections_note_length_check'
      and contype = 'c'
      and convalidated
      and pg_get_constraintdef(oid) like '%char_length(note) <= 300%'
  ),
  'scan correction notes have a validated 300-character database limit'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plate_scans'
      and column_name in (
        'menu_context_version_id',
        'menu_context_signature',
        'menu_context_candidate_count'
      )
  ),
  3,
  'plate scans persist the server-derived menu context triplet'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.plate_scans'::regclass
      and conname = 'plate_scans_menu_context_complete'
      and contype = 'c'
      and convalidated
  ),
  'plate menu context is all-null or complete and limited to AI scans'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.plate_scans'::regclass
      and conname = 'plate_scans_school_menu_context_fkey'
      and contype = 'f'
      and convalidated
  ),
  'plate menu context version is constrained inside the same school'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.confirm_scan_core_v2(jsonb)',
    'execute'
  ),
  'browser sessions cannot bypass the menu-context wrapper and call the scan core'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.confirm_scan_core_v2_without_notes(jsonb)',
    'execute'
  ),
  'browser sessions cannot bypass correction-note validation through the prior core'
);
select ok(exists (select 1 from pg_constraint where conname = 'meal_records_school_class_fkey' and contype = 'f'), 'meal class relation is school scoped');
select ok(exists (select 1 from pg_constraint where conname = 'experiments_school_prediction_fkey' and contype = 'f'), 'experiment prediction relation is school scoped');
select ok(
  position(
    'PRIMARY KEY (school_id, id)' in (
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conrelid = 'public.research_sections'::regclass and contype = 'p'
    )
  ) > 0,
  'research section IDs are scoped by school'
);
select ok(not (select prosecdef from pg_proc where oid = 'public.confirm_scan(jsonb)'::regprocedure), 'public confirm_scan is only an invoker wrapper');
select ok(
  (
    select prosecdef
      and proconfig @> array['search_path=""']::text[]
    from pg_proc
    where oid = 'private.confirm_scan(jsonb)'::regprocedure
  ),
  'private confirm_scan is the pinned privileged implementation'
);
select is(
  (
    select count(*)::integer
    from pg_proc as function
    join pg_namespace as schema on schema.oid = function.pronamespace
    where schema.nspname = 'public'
      and function.prosecdef
  ),
  0,
  'the exposed public schema has no security definer functions'
);
select ok(
  not has_function_privilege('anon', 'public.confirm_scan(jsonb)', 'execute'),
  'anon cannot execute confirm_scan'
);
select ok(
  not has_function_privilege('authenticated', 'public.is_school_member(uuid,text[])', 'execute'),
  'membership helper is not an exposed authenticated RPC'
);
select ok(
  has_schema_privilege('authenticated', 'private', 'usage')
    and not has_schema_privilege('anon', 'private', 'usage')
    and not has_schema_privilege('anon', 'public', 'usage'),
  'only authenticated browser sessions can resolve the required API schemas'
);
select is(
  (
    select count(*)::integer
    from pg_proc as function
    join pg_namespace as schema on schema.oid = function.pronamespace
    where schema.nspname in ('public', 'private')
      and not coalesce(
        function.proconfig @> array['search_path=""']::text[],
        false
      )
  ),
  0,
  'every application function pins an empty search_path'
);
select ok(
  not exists (
    select 1
    from pg_default_acl as defaults
    join pg_namespace as schema
      on schema.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) as privilege
    where defaults.defaclrole = 'postgres'::regrole
      and schema.nspname = 'public'
      and privilege.grantee in (
        0,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid
      )
  ),
  'future public objects require explicit browser-role grants'
);
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and (
        table_name not in (
          'schools',
          'memberships',
          'classes',
          'meal_records',
          'plate_scans',
          'scan_detections',
          'scan_corrections',
          'supply_predictions',
          'experiments',
          'research_sections',
          'impact_settings',
          'project_profiles',
          'data_retention_runs',
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_safety_observations',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        )
        or (
          privilege_type <> 'SELECT'
          and (
            privilege_type not in ('INSERT', 'UPDATE', 'DELETE')
            or table_name not in (
              'classes',
              'meal_records',
              'supply_predictions',
              'experiments',
              'research_sections',
              'impact_settings',
              'project_profiles',
              'menu_versions',
              'menu_items',
              'meal_batches',
              'meal_safety_observations',
              'meal_contexts',
              'feedback_events',
              'waste_measurements',
              'human_decisions',
              'collection_events',
              'destination_receipts'
            )
            or (
              table_name = 'meal_records'
              and privilege_type = 'DELETE'
            )
            or (
              table_name = 'meal_safety_observations'
              and privilege_type in ('UPDATE', 'DELETE')
            )
          )
        )
      )
  ),
  'authenticated table grants follow the explicit read and write allowlists'
);
select ok(
  not exists (
    select 1
    from pg_constraint as foreign_key
    join pg_class as table_class on table_class.oid = foreign_key.conrelid
    join pg_namespace as schema on schema.oid = table_class.relnamespace
    where foreign_key.contype = 'f'
      and schema.nspname = 'public'
      and not exists (
        select 1
        from pg_index as index
        where index.indrelid = foreign_key.conrelid
          and index.indisvalid
          and index.indisready
          and index.indpred is null
          and (
            index.indkey::smallint[]
          )[0:cardinality(foreign_key.conkey) - 1] @> foreign_key.conkey
          and foreign_key.conkey @> (
            index.indkey::smallint[]
          )[0:cardinality(foreign_key.conkey) - 1]
      )
  ),
  'every public foreign key has a usable leading-column index'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and cmd = 'ALL'
  ),
  'write policies are operation-specific and do not duplicate SELECT policies'
);
select ok((select not public from storage.buckets where id = 'plate-images'), 'plate image bucket is private');
select is(
  (select file_size_limit from storage.buckets where id = 'plate-images'),
  4000000::bigint,
  'plate image bucket enforces the processed-image 4 MB limit'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'plate-images'),
  array['image/webp']::text[],
  'plate image bucket accepts only re-encoded WebP evidence'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in ('plate_images_read', 'plate_images_insert', 'plate_images_delete')
  ),
  3,
  'storage has read, insert, and delete school policies'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'UPDATE'
  ),
  'storage object overwrite is disabled because uploads use upsert false'
);
select ok(exists (select 1 from pg_constraint where conname = 'scan_detections_remaining_lte_original' and contype = 'c'), 'AI remaining weight cannot exceed its original portion');
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plate_scans'
      and column_name in ('payload_hash', 'content_sha256')
  ),
  2,
  'scan retries preserve server and client content fingerprints'
);
select has_trigger('public', 'meal_records', 'meal_records_force_created_by', 'meal creator is enforced by the database');
select ok(exists (select 1 from pg_constraint where conname = 'meal_records_measurement_is_meal_level' and contype = 'c'), 'class meal weights allow scale, manual, or disclosed sample extrapolation but never AI estimates');
select ok(exists (select 1 from pg_constraint where conname = 'experiments_periods_do_not_overlap' and contype = 'c'), 'experiment periods cannot overlap');
select ok(
  (select convalidated from pg_constraint where conname = 'meal_records_measurement_is_meal_level'),
  'meal-level measurement evidence constraint is validated for existing rows'
);
select ok(
  (select convalidated from pg_constraint where conname = 'experiments_periods_do_not_overlap'),
  'experiment period separation is validated for existing rows'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'supply_predictions'
      and column_name in ('independent_date_count', 'evidence_meal_ids')
  ),
  2,
  'predictions preserve independent-date count and exact evidence rows'
);

insert into auth.users (id, email, aud, role, email_confirmed_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'foodlens-a@example.test', 'authenticated', 'authenticated', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'foodlens-b@example.test', 'authenticated', 'authenticated', now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'foodlens-viewer@example.test', 'authenticated', 'authenticated', now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'foodlens-admin@example.test', 'authenticated', 'authenticated', now());

insert into public.schools (id, name)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'FoodLens test school A'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'FoodLens test school B');

insert into public.memberships (school_id, user_id, role)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'teacher'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'teacher'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'viewer'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'admin');

insert into public.classes (id, school_id, name, grade)
values
  ('aaaaaaaa-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', '五年一班', 5),
  ('bbbbbbbb-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000002', '五年二班', 5);

set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  'aaaaaaaa-7000-4700-8700-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '2026-10-27',
  'lunch',
  1,
  '白飯、咖哩雞、青菜',
  'structured',
  'FoodLens pgTAP fixture',
  'confirmed',
  'official',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '2026-10-27T02:00:00Z'
);

insert into public.menu_items (
  id,
  school_id,
  menu_version_id,
  sort_order,
  display_name,
  normalized_name,
  category,
  status,
  provenance
) values
  (
    'aaaaaaaa-7100-4710-8710-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-7000-4700-8700-000000000001',
    0,
    '白飯',
    '白飯',
    'rice',
    'confirmed',
    'official'
  ),
  (
    'aaaaaaaa-7100-4710-8710-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-7000-4700-8700-000000000001',
    1,
    '咖哩雞',
    '咖哩雞',
    'meat',
    'confirmed',
    'official'
  );

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
  source
) values (
  'aaaaaaaa-7200-4720-8720-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-1111-4111-8111-111111111111',
  '2026-10-27',
  'lunch',
  '白飯',
  '咖哩雞',
  array['青菜'],
  'confirmed-menu-signature-v1',
  25,
  25,
  6500,
  900,
  'scale',
  'confirmed menu context fixture',
  'manual'
);

insert into public.meal_batches (
  id,
  school_id,
  client_case_id,
  audit_payload,
  meal_record_id,
  menu_version_id,
  class_id,
  service_date,
  meal_period,
  status,
  planned_people,
  planned_supply_g,
  weight_basis,
  provenance
) values (
  'aaaaaaaa-7300-4730-8730-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-7300-4730-8730-000000000002',
  jsonb_build_object(
    'menuVersion',
    jsonb_build_object('signature', 'confirmed-menu-signature-v1')
  ),
  'aaaaaaaa-7200-4720-8720-000000000001',
  'aaaaaaaa-7000-4700-8700-000000000001',
  'aaaaaaaa-1111-4111-8111-111111111111',
  '2026-10-27',
  'lunch',
  'planned',
  25,
  6500,
  'ready_to_eat',
  'official'
);

insert into storage.objects (bucket_id, name)
values (
  'plate-images',
  'aaaaaaaa-0000-4000-8000-000000000001/2026/audit-evidence.webp'
);

create table public.foodlens_rls_test_payload (payload jsonb);
insert into public.foodlens_rls_test_payload values (
  jsonb_build_object(
    'school_id', 'aaaaaaaa-0000-4000-8000-000000000001',
    'client_request_id', 'aaaaaaaa-3333-4333-8333-333333333333',
    'content_sha256', repeat('a', 64),
    'meal', jsonb_build_object(
      'class_id', 'aaaaaaaa-1111-4111-8111-111111111111',
      'served_on', '2026-10-26',
      'staple', '白飯',
      'main_dish', '測試雞肉',
      'side_dishes', jsonb_build_array('青菜'),
      'planned_people', 25,
      'actual_people', 25,
      'total_supply_g', 6500,
      'leftover_g', 1100,
      'measurement_method', 'scale',
      'notes', 'pgTAP retry test'
    ),
    'analysis', jsonb_build_object(
      'provider', 'foodlens-test',
      'model', 'deterministic-v1',
      'isMock', false,
      'detections', jsonb_build_array(jsonb_build_object(
        'category', 'rice',
        'label', '白飯',
        'originalG', 120,
        'remainingRatio', 0.25,
        'remainingG', 30,
        'confidence', 0.9
      ))
    ),
    'corrections', jsonb_build_array(jsonb_build_object(
      'category', 'rice',
      'label', '白飯',
      'originalG', 120,
      'remainingRatio', 0.25,
      'remainingG', 30
    ))
  )
);
grant select on table public.foodlens_rls_test_payload to authenticated;

insert into private.ai_quota_windows (
  user_id,
  school_id,
  window_started_at,
  request_count,
  updated_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'bbbbbbbb-0000-4000-8000-000000000002',
  pg_catalog.date_bin(
    interval '60 seconds',
    pg_catalog.statement_timestamp(),
    timestamptz '1970-01-01 00:00:00+00'
  ) - interval '120 seconds',
  10,
  pg_catalog.statement_timestamp() - interval '120 seconds'
);

set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select results_eq(
  $$
    select public.consume_ai_quota('aaaaaaaa-0000-4000-8000-000000000001'::uuid)
    from pg_catalog.generate_series(1, 10)
  $$,
  $$ select true from pg_catalog.generate_series(1, 10) $$,
  'teacher can consume the first ten requests in a fixed 60-second window'
);
select is(
  public.consume_ai_quota('aaaaaaaa-0000-4000-8000-000000000001'::uuid),
  false,
  'the eleventh teacher request in the same window is refused atomically'
);
select results_eq(
  $$ select id from public.schools order by id $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
  'school A teacher can only read school A'
);
select is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'plate-images'
  ),
  1,
  'school A teacher can read school A image evidence'
);
reset role;

select is(
  (
    select request_count::integer
    from private.ai_quota_windows
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  10,
  'refused requests never increment the persisted quota count beyond ten'
);
select ok(
  not exists (
    select 1
    from private.ai_quota_windows
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  'an authorized quota call cleans fixed windows that can no longer be reused'
);

set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
select is(
  public.consume_ai_quota('aaaaaaaa-0000-4000-8000-000000000001'::uuid),
  false,
  'a teacher cannot consume paid AI quota for another school'
);
select results_eq(
  $$ select id from public.schools order by id $$,
  $$ values ('bbbbbbbb-0000-4000-8000-000000000002'::uuid) $$,
  'school B teacher can only read school B'
);
select is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'plate-images'
  ),
  0,
  'school B teacher cannot read school A image evidence'
);
reset role;

set local role anon;
select is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'plate-images'
  ),
  0,
  'anon cannot read the private image bucket'
);
reset role;

set local "request.jwt.claim.sub" = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
select is(
  public.consume_ai_quota('aaaaaaaa-0000-4000-8000-000000000001'::uuid),
  false,
  'a viewer cannot consume paid AI quota in their own school'
);
select results_eq(
  $$ select id from public.classes order by id $$,
  $$ values ('aaaaaaaa-1111-4111-8111-111111111111'::uuid) $$,
  'viewer can read classes in their own school'
);
select is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'plate-images'
  ),
  0,
  'viewer cannot read private plate image evidence'
);
select throws_like(
  $$ insert into public.classes (school_id, name, grade) values ('aaaaaaaa-0000-4000-8000-000000000001', '唯讀帳號不可新增', 5) $$,
  '%row-level security%',
  'viewer cannot use authenticated table grants to write'
);
reset role;

set local "request.jwt.claim.sub" = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
set local role authenticated;
select is(
  public.consume_ai_quota('aaaaaaaa-0000-4000-8000-000000000001'::uuid),
  true,
  'an admin can consume paid AI quota in their own school'
);
reset role;

set local role anon;
select throws_like(
  $$ select public.consume_ai_quota('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
  '%permission denied%',
  'anon cannot invoke the public AI quota RPC'
);
reset role;

set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select throws_like(
  $$ insert into public.classes (school_id, name, grade) values ('bbbbbbbb-0000-4000-8000-000000000002', '跨校班級', 5) $$,
  '%row-level security%',
  'school A teacher cannot insert a class into school B'
);
select throws_like(
  $$ insert into storage.objects (bucket_id, name) values ('plate-images', 'bbbbbbbb-0000-4000-8000-000000000002/2026/cross-school.webp') $$,
  '%row-level security%',
  'school A teacher cannot write to school B image path'
);
select throws_ok(
  $$
    select public.confirm_scan(
      jsonb_set(
        jsonb_set(
          payload,
          '{client_request_id}',
          '"aaaaaaaa-4444-4444-8444-444444444444"'::jsonb
        ),
        '{meal,class_id}',
        '"bbbbbbbb-2222-4222-8222-222222222222"'::jsonb
      )
    )
    from public.foodlens_rls_test_payload
  $$,
  '23503',
  'class does not belong to the current school',
  'scan RPC rejects a class from another school'
);
select results_eq(
  $$
    with first_call as materialized (
      select public.confirm_scan(payload) as result
      from public.foodlens_rls_test_payload
    ), retry_call as materialized (
      select public.confirm_scan(payload) as result
      from public.foodlens_rls_test_payload
      cross join first_call
    )
    select first_call.result = retry_call.result
    from first_call cross join retry_call
  $$,
  $$ values (true) $$,
  'same request and payload returns the original scan result'
);
select is(
  (
    select analysis_kind
    from public.plate_scans
    where client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
  ),
  'real-ai',
  'the server persists non-mock provider output as real AI'
);
select ok(
  (
    select menu_context_version_id is null
      and menu_context_signature is null
      and menu_context_candidate_count is null
    from public.plate_scans
    where client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
  ),
  'a scan that did not supply menu candidates keeps explicit null provenance'
);
select lives_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a200-4a20-8a20-000000000001',
          'correction_notes',
          jsonb_build_array('學生以電子秤結果修正份量')
        )
        || jsonb_build_object(
          'corrections',
          jsonb_build_array(
            (payload -> 'corrections' -> 0) || jsonb_build_object(
              'remainingRatio', 0.5,
              'remainingG', 60
            )
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  'an index-aligned correction note is accepted with a changed detection result'
);
select is(
  (
    select correction.note
    from public.scan_corrections as correction
    join public.scan_detections as detection
      on detection.id = correction.detection_id
     and detection.school_id = correction.school_id
    join public.plate_scans as scan
      on scan.id = detection.scan_id
     and scan.school_id = detection.school_id
    where scan.client_request_id = 'aaaaaaaa-a200-4a20-8a20-000000000001'
  ),
  '學生以電子秤結果修正份量',
  'confirm_scan preserves the student correction note instead of hard-coding it'
);
select lives_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a200-4a20-8a20-000000000001',
          'correction_notes',
          jsonb_build_array('學生以電子秤結果修正份量')
        )
        || jsonb_build_object(
          'corrections',
          jsonb_build_array(
            (payload -> 'corrections' -> 0) || jsonb_build_object(
              'remainingRatio', 0.5,
              'remainingG', 60
            )
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  'an exact retry including correction notes remains idempotent'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a200-4a20-8a20-000000000001',
          'correction_notes',
          jsonb_build_array('同一識別碼換成另一段註記')
        )
        || jsonb_build_object(
          'corrections',
          jsonb_build_array(
            (payload -> 'corrections' -> 0) || jsonb_build_object(
              'remainingRatio', 0.5,
              'remainingG', 60
            )
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  '23505',
  'idempotency key already belongs to different scan content',
  'changing only the correction note invalidates an idempotent retry'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload || jsonb_build_object(
        'client_request_id', 'aaaaaaaa-a200-4a20-8a20-000000000002',
        'correction_notes', jsonb_build_array(repeat('餐', 301))
      )
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'each correction note must contain at most 300 characters',
  'direct RPC calls cannot persist an oversized correction note'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload || jsonb_build_object(
        'client_request_id', 'aaaaaaaa-a200-4a20-8a20-000000000003',
        'correction_notes', jsonb_build_array()
      )
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'correction notes must match detections and corrections by index',
  'direct RPC calls cannot shift correction-note indexes with a short array'
);
select lives_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a100-4a10-8a10-000000000001',
          'menu_context_assertion',
          jsonb_build_object(
            'menu_version_signature', 'confirmed-menu-signature-v1',
            'candidate_count', 2
          )
        )
        || jsonb_build_object(
          'meal',
          (payload -> 'meal') || jsonb_build_object(
            'id', 'aaaaaaaa-7200-4720-8720-000000000001'
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  'an AI scan can attach the current confirmed menu candidate context'
);
select results_eq(
  $$
    select
      menu_context_version_id,
      menu_context_signature,
      menu_context_candidate_count
    from public.plate_scans
    where client_request_id = 'aaaaaaaa-a100-4a10-8a10-000000000001'
  $$,
  $$
    values (
      'aaaaaaaa-7000-4700-8700-000000000001'::uuid,
      'confirmed-menu-signature-v1'::text,
      2::smallint
    )
  $$,
  'the database persists its canonical menu id, signature, and candidate count'
);
create temporary table scanned_menu_reuse_audit as
select
  menu.updated_at as menu_updated_at,
  item.updated_at as item_updated_at,
  menu.confirmed_at
from public.menu_versions as menu
join public.menu_items as item
  on item.school_id = menu.school_id
 and item.menu_version_id = menu.id
 and item.sort_order = 0
where menu.id = 'aaaaaaaa-7000-4700-8700-000000000001';
select lives_ok(
  $$
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
    )
    select
      'aaaaaaaa-7000-4700-8700-000000000099',
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
      confirmed_at + interval '1 minute'
    from public.menu_versions
    where id = 'aaaaaaaa-7000-4700-8700-000000000001'
    on conflict on constraint menu_versions_service_version_key do update set
      title = excluded.title,
      source_system = excluded.source_system,
      source_reference = excluded.source_reference,
      status = excluded.status,
      provenance = excluded.provenance,
      confirmed_by = excluded.confirmed_by,
      confirmed_at = excluded.confirmed_at
  $$,
  'a later class can reuse a materially identical scanned menu version'
);
select results_eq(
  $$
    with reused as (
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
      )
      select
        'aaaaaaaa-7100-4710-8710-000000000099',
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
      from public.menu_items
      where id = 'aaaaaaaa-7100-4710-8710-000000000001'
      on conflict on constraint menu_items_school_menu_sort_key do update set
        display_name = excluded.display_name,
        normalized_name = excluded.normalized_name,
        category = excluded.category,
        preparation_method = excluded.preparation_method,
        standard_portion_g = excluded.standard_portion_g,
        weight_basis = excluded.weight_basis,
        status = excluded.status,
        provenance = excluded.provenance
      returning id
    )
    select id from reused
  $$,
  $$ values ('aaaaaaaa-7100-4710-8710-000000000001'::uuid) $$,
  'a later class item alias resolves to the immutable canonical candidate'
);
select results_eq(
  $$
    select
      menu.updated_at = audit.menu_updated_at,
      item.updated_at = audit.item_updated_at,
      menu.confirmed_at = audit.confirmed_at
    from public.menu_versions as menu
    join public.menu_items as item
      on item.school_id = menu.school_id
     and item.menu_version_id = menu.id
     and item.sort_order = 0
    cross join scanned_menu_reuse_audit as audit
    where menu.id = 'aaaaaaaa-7000-4700-8700-000000000001'
  $$,
  $$ values (true, true, true) $$,
  'material-equivalent reuse preserves the original confirmation and timestamps'
);
select throws_ok(
  $$
    update public.menu_versions
    set title = '不得改寫的掃描菜單'
    where id = 'aaaaaaaa-7000-4700-8700-000000000001'
  $$,
  'P0001',
  'a menu version referenced by a plate scan is immutable',
  'a cited menu version cannot be rewritten after plate analysis'
);
select throws_ok(
  $$
    update public.menu_items
    set display_name = '不得改寫的候選菜名'
    where id = 'aaaaaaaa-7100-4710-8710-000000000001'
  $$,
  'P0001',
  'menu candidates referenced by a plate scan are immutable',
  'an existing cited menu candidate cannot be changed'
);
select throws_ok(
  $$
    delete from public.menu_items
    where id = 'aaaaaaaa-7100-4710-8710-000000000002'
  $$,
  'P0001',
  'menu candidates referenced by a plate scan are immutable',
  'an existing cited menu candidate cannot be deleted'
);
select throws_ok(
  $$
    insert into public.menu_items (
      id,
      school_id,
      menu_version_id,
      sort_order,
      display_name,
      normalized_name,
      category,
      status,
      provenance
    ) values (
      'aaaaaaaa-7100-4710-8710-000000000003',
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-7000-4700-8700-000000000001',
      2,
      '不得事後新增',
      '不得事後新增',
      'other',
      'confirmed',
      'official'
    )
  $$,
  'P0001',
  'menu candidates referenced by a plate scan are immutable',
  'a cited menu candidate set cannot be extended after analysis'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload || jsonb_build_object(
        'client_request_id', 'aaaaaaaa-a100-4a10-8a10-000000000002',
        'menu_context_version_id', 'bbbbbbbb-0000-4000-8000-000000000002'
      )
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'menu context identity is server-derived and must not be supplied',
  'a caller cannot forge a persisted menu version id'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a100-4a10-8a10-000000000003',
          'menu_context_assertion',
          jsonb_build_object(
            'menu_version_signature', 'confirmed-menu-signature-v1',
            'candidate_count', 3
          )
        )
        || jsonb_build_object(
          'meal',
          (payload -> 'meal') || jsonb_build_object(
            'id', 'aaaaaaaa-7200-4720-8720-000000000001'
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  '40001',
  'confirmed menu context changed; analyze the plate again',
  'a stale or mismatched candidate count cannot be persisted'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a100-4a10-8a10-000000000004',
          'menu_context_assertion',
          jsonb_build_object(
            'menu_version_signature', 'white-rice-test-chicken',
            'candidate_count', 1
          )
        )
        || jsonb_build_object(
          'meal',
          (payload -> 'meal') || jsonb_build_object(
            'id',
            (
              select meal_record_id::text
              from public.plate_scans
              where client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
            )
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  '23503',
  'meal has no exact confirmed menu candidate context',
  'a menu assertion cannot create provenance for an unlinked meal'
);
select throws_ok(
  $$
    select public.confirm_scan(
      jsonb_set(payload, '{meal,notes}', '"changed content"'::jsonb)
    )
    from public.foodlens_rls_test_payload
  $$,
  '23505',
  'idempotency key already belongs to different scan content',
  'same request key cannot be reused for different scan content'
);
select lives_ok(
  $$
    select public.confirm_scan(
      jsonb_set(
        jsonb_set(
          payload,
          '{client_request_id}',
          '"aaaaaaaa-5555-4555-8555-555555555555"'::jsonb
        ),
        '{meal,id}',
        to_jsonb((
          select meal_record_id::text
          from public.plate_scans
          where school_id = 'aaaaaaaa-0000-4000-8000-000000000001'
            and client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
        ))
      )
    )
    from public.foodlens_rls_test_payload
  $$,
  'a second plate can attach to the existing meal without recreating it'
);
select lives_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-6666-4666-8666-666666666666'
        )
        || jsonb_build_object(
          'meal',
          (payload -> 'meal') || jsonb_build_object(
            'id',
            (
              select meal_record_id::text
              from public.plate_scans
              where client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
            )
          )
        )
        || jsonb_build_object(
          'analysis',
          (payload -> 'analysis') || jsonb_build_object(
            'provider', 'convincing-real-provider-name',
            'isMock', true
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  'structured mock provenance is accepted independently of provider display text'
);
select is(
  (
    select analysis_kind
    from public.plate_scans
    where client_request_id = 'aaaaaaaa-6666-4666-8666-666666666666'
  ),
  'mock-ai',
  'isMock persists Mock AI even when arbitrary provider text looks real'
);
select lives_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-7777-4777-8777-777777777777'
        )
        || jsonb_build_object(
          'meal',
          (payload -> 'meal') || jsonb_build_object(
            'id',
            (
              select meal_record_id::text
              from public.plate_scans
              where client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
            )
          )
        )
        || jsonb_build_object(
          'analysis',
          (payload -> 'analysis') || jsonb_build_object(
            'provider', 'human-manual',
            'model', 'manual-entry-v1',
            'isMock', false
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  'the reserved human provider is accepted with non-mock provenance'
);
select is(
  (
    select analysis_kind
    from public.plate_scans
    where client_request_id = 'aaaaaaaa-7777-4777-8777-777777777777'
  ),
  'human-manual',
  'the reserved human provider persists an explicit no-AI identity'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-8888-4888-8888-888888888888'
        )
        || jsonb_build_object(
          'analysis',
          (payload -> 'analysis') || jsonb_build_object(
            'analysisKind', 'real-ai'
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'analysis kind is server-derived and must not be supplied',
  'a caller cannot forge the persisted analysis identity'
);
select throws_ok(
  $$
    select public.confirm_scan(
      (
        payload
          || jsonb_build_object(
            'client_request_id',
            'aaaaaaaa-9999-4999-8999-999999999999'
          )
      ) #- '{analysis,isMock}'
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'analysis.isMock must be a boolean',
  'a caller must provide structured mock provenance'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a000-4a00-8a00-000000000001'
        )
        || jsonb_build_object(
          'analysis',
          (payload -> 'analysis') || jsonb_build_object(
            'provider', 'foodlens-mock',
            'isMock', false
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'foodlens-mock provider must be marked as Mock AI',
  'the reserved Mock provider cannot contradict structured provenance'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload
        || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a000-4a00-8a00-000000000002'
        )
        || jsonb_build_object(
          'analysis',
          (payload -> 'analysis') || jsonb_build_object(
            'provider', repeat('p', 81)
          )
        )
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'analysis provider or model exceeds its length limit',
  'direct RPC calls cannot persist an oversized provider audit value'
);
select throws_ok(
  $$
    select public.confirm_scan(
      jsonb_set(
        payload || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a000-4a00-8a00-000000000003'
        ),
        '{analysis,detections,0,label}',
        to_jsonb(repeat('餐', 31))
      )
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'detection labels must contain 1 to 30 characters',
  'direct RPC calls cannot persist an oversized detection label'
);
select throws_ok(
  $$
    select public.confirm_scan(
      jsonb_set(
        payload || jsonb_build_object(
          'client_request_id',
          'aaaaaaaa-a000-4a00-8a00-000000000004'
        ),
        '{analysis,detections,0,originalG}',
        to_jsonb('999999999999999999999999'::text)
      )
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'scan payload contains an invalid or out-of-range number or identifier',
  'out-of-range numeric casts stay inside the stable RPC error contract'
);
select throws_ok(
  $$
    select public.confirm_scan(
      payload || jsonb_build_object('client_request_id', 'not-a-uuid')
    )
    from public.foodlens_rls_test_payload
  $$,
  '22023',
  'scan payload contains an invalid or out-of-range number or identifier',
  'invalid UUID casts stay inside the stable RPC error contract'
);
reset role;

set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
select results_eq(
  $$
    select relation, row_count
    from (
      select 'meal_records'::text as relation, count(*) as row_count
      from public.meal_records
      union all
      select 'plate_scans'::text, count(*)
      from public.plate_scans
      union all
      select 'scan_detections'::text, count(*)
      from public.scan_detections
    ) as tenant_rows
    order by relation
  $$,
  $$
    values
      ('meal_records'::text, 0::bigint),
      ('plate_scans'::text, 0::bigint),
      ('scan_detections'::text, 0::bigint)
  $$,
  'school B cannot read school A meal or raw AI audit rows'
);
reset role;

select is(
  (
    select leftover_g
    from public.meal_records
    where id = (
      select meal_record_id
      from public.plate_scans
      where client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
    )
  ),
  1100,
  'class leftover uses the scale measurement, not the 30 g plate estimate'
);
select is(
  (
    select count(*)::integer
    from public.meal_records
    where id = (
      select meal_record_id
      from public.plate_scans
      where client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
    )
  ),
  1,
  'adding another plate does not duplicate or overwrite the existing meal'
);

select results_eq(
  $$
    select count(*), count(distinct meal_record_id)
    from public.plate_scans
    where school_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
  $$,
  $$ values (1::bigint, 1::bigint) $$,
  'a retry creates exactly one meal and one scan'
);
select throws_ok(
  $$
    update public.scan_detections
    set label = '不應被修改'
    where scan_id = (
      select id from public.plate_scans
      where client_request_id = 'aaaaaaaa-3333-4333-8333-333333333333'
    )
  $$,
  'P0001',
  'AI original detections are append-only',
  'AI original detections cannot be changed even by a database owner'
);

select * from finish();
rollback;
