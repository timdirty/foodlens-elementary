begin;
set local search_path = public, extensions;

select plan(31);

select is(
  (
    select count(*)::integer
    from pg_class
    where oid = any (
      array[
        'public.data_retention_runs'::regclass,
        'private.data_retention_run_items'::regclass
      ]
    )
      and relrowsecurity
  ),
  2,
  'retention public and private tables both enable RLS'
);
select ok(
  not has_table_privilege('authenticated', 'private.data_retention_run_items', 'select')
    and not has_table_privilege('authenticated', 'private.data_retention_run_items', 'insert')
    and not has_table_privilege('authenticated', 'private.data_retention_run_items', 'update')
    and not has_table_privilege('authenticated', 'private.data_retention_run_items', 'delete'),
  'browser roles have no direct access to retention manifests'
);
select ok(
  has_function_privilege('authenticated', 'public.preview_data_retention(uuid,integer)', 'execute')
    and has_function_privilege('authenticated', 'public.prepare_data_retention(uuid,integer)', 'execute')
    and has_function_privilege('authenticated', 'public.finalize_data_retention(uuid,boolean,text)', 'execute'),
  'authenticated sessions can reach the guarded public retention RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.preview_data_retention(uuid,integer)', 'execute')
    and not has_function_privilege('anon', 'public.prepare_data_retention(uuid,integer)', 'execute')
    and not has_function_privilege('anon', 'public.finalize_data_retention(uuid,boolean,text)', 'execute'),
  'anonymous sessions cannot invoke retention RPCs'
);
select ok(
  (
    select count(*) = 3
    from pg_proc as function
    where function.oid = any (
      array[
        'public.preview_data_retention(uuid,integer)'::regprocedure,
        'public.prepare_data_retention(uuid,integer)'::regprocedure,
        'public.finalize_data_retention(uuid,boolean,text)'::regprocedure
      ]
    )
      and not function.prosecdef
      and function.proconfig @> array['search_path=""']::text[]
  ),
  'public retention RPCs are invoker wrappers with pinned search paths'
);
select ok(
  (
    select count(*) = 3
    from pg_proc as function
    where function.oid = any (
      array[
        'private.preview_data_retention(uuid,integer)'::regprocedure,
        'private.prepare_data_retention(uuid,integer)'::regprocedure,
        'private.finalize_data_retention(uuid,boolean,text)'::regprocedure
      ]
    )
      and function.prosecdef
      and function.proconfig @> array['search_path=""']::text[]
  ),
  'privileged retention implementations stay private and pin search paths'
);
select ok(
  not has_table_privilege('authenticated', 'public.meal_records', 'delete'),
  'browser sessions cannot delete aggregate meal evidence directly'
);
select ok(
  (
    select
      lower(qual) like '%owner_id%'
      and lower(qual) like '%not (exists%'
      and lower(qual) like '%plate_scans%'
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'plate_images_delete'
  ),
  'browser storage deletion is restricted to owned, unreferenced uploads'
);

insert into auth.users (id, email, aud, role, email_confirmed_at)
values
  ('11111111-1111-4111-8111-111111111111', 'retention-admin-a@example.test', 'authenticated', 'authenticated', now()),
  ('22222222-2222-4222-8222-222222222222', 'retention-teacher-a@example.test', 'authenticated', 'authenticated', now()),
  ('33333333-3333-4333-8333-333333333333', 'retention-viewer-a@example.test', 'authenticated', 'authenticated', now()),
  ('44444444-4444-4444-8444-444444444444', 'retention-admin-b@example.test', 'authenticated', 'authenticated', now());

insert into public.schools (id, name)
values
  ('11111111-0000-4000-8000-000000000001', 'Retention school A'),
  ('22222222-0000-4000-8000-000000000002', 'Retention school B');

insert into public.memberships (school_id, user_id, role)
values
  ('11111111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'admin'),
  ('11111111-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'teacher'),
  ('11111111-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'viewer'),
  ('22222222-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'admin');

set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

insert into public.classes (id, school_id, name, grade)
values (
  '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-0000-4000-8000-000000000001',
  '五年測試班',
  5
);

insert into public.project_profiles (
  school_id,
  project_name,
  subtitle,
  school_name,
  team_name,
  team_members,
  research_period,
  ai_disclosure,
  privacy_contact,
  data_retention_days,
  governance_reviewed_at,
  updated_by
) values (
  '11111111-0000-4000-8000-000000000001',
  'FoodLens',
  'Retention test',
  'Retention school A',
  'Test team',
  'Anonymous',
  'Test period',
  'Test disclosure',
  'Data admin',
  30,
  now(),
  '11111111-1111-4111-8111-111111111111'
);

insert into public.meal_records (
  id,
  school_id,
  class_id,
  served_on,
  staple,
  main_dish,
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
) values
  (
    '11111111-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '11111111-0000-4000-8000-000000000001',
    '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    current_date - 100,
    '白飯',
    '舊餐盤',
    '白飯|舊餐盤',
    25,
    25,
    6000,
    1200,
    'scale',
    '',
    'manual',
    '11111111-1111-4111-8111-111111111111',
    now() - interval '100 days',
    now() - interval '100 days'
  ),
  (
    '11111111-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '11111111-0000-4000-8000-000000000001',
    '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    current_date - 100,
    '白飯',
    '最近新增餐盤',
    '白飯|最近新增餐盤',
    25,
    25,
    6000,
    900,
    'scale',
    '',
    'manual',
    '11111111-1111-4111-8111-111111111111',
    now() - interval '100 days',
    now() - interval '1 day'
  );

insert into public.plate_scans (
  id,
  school_id,
  meal_record_id,
  image_path,
  client_request_id,
  analysis_kind,
  provider,
  model,
  status,
  reviewed_by,
  reviewed_at,
  created_at
) values
  (
    '11111111-cccc-4ccc-8ccc-ccccccccccc1',
    '11111111-0000-4000-8000-000000000001',
    '11111111-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '11111111-0000-4000-8000-000000000001/2026/expired.webp',
    '11111111-dddd-4ddd-8ddd-ddddddddddd1',
    'source-unverified',
    'foodlens-test',
    'retention-v1',
    'confirmed',
    '11111111-1111-4111-8111-111111111111',
    now() - interval '100 days',
    now() - interval '100 days'
  ),
  (
    '11111111-cccc-4ccc-8ccc-ccccccccccc2',
    '11111111-0000-4000-8000-000000000001',
    '11111111-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    null,
    '11111111-dddd-4ddd-8ddd-ddddddddddd2',
    'source-unverified',
    'foodlens-test',
    'retention-v1',
    'confirmed',
    '11111111-1111-4111-8111-111111111111',
    now() - interval '1 day',
    now() - interval '1 day'
  );

insert into public.scan_detections (
  id,
  scan_id,
  school_id,
  category,
  label,
  ai_original_g,
  ai_remaining_ratio,
  ai_remaining_g,
  confidence,
  sort_order
) values
  (
    '11111111-eeee-4eee-8eee-eeeeeeeeeee1',
    '11111111-cccc-4ccc-8ccc-ccccccccccc1',
    '11111111-0000-4000-8000-000000000001',
    'rice',
    '白飯',
    120,
    0.25,
    30,
    0.9,
    0
  ),
  (
    '11111111-eeee-4eee-8eee-eeeeeeeeeee2',
    '11111111-cccc-4ccc-8ccc-ccccccccccc2',
    '11111111-0000-4000-8000-000000000001',
    'rice',
    '白飯',
    120,
    0.2,
    24,
    0.9,
    0
  );

insert into public.scan_corrections (
  id,
  detection_id,
  school_id,
  corrected_category,
  corrected_label,
  corrected_original_g,
  corrected_remaining_ratio,
  corrected_remaining_g,
  note,
  corrected_by,
  corrected_at
) values (
  '11111111-ffff-4fff-8fff-fffffffffff1',
  '11111111-eeee-4eee-8eee-eeeeeeeeeee1',
  '11111111-0000-4000-8000-000000000001',
  'rice',
  '白飯',
  120,
  0.3,
  36,
  'old correction',
  '11111111-1111-4111-8111-111111111111',
  now() - interval '99 days'
);

insert into storage.objects (bucket_id, name, owner_id)
values
  (
    'plate-images',
    '11111111-0000-4000-8000-000000000001/2026/expired.webp',
    '11111111-1111-4111-8111-111111111111'
  ),
  (
    'plate-images',
    '11111111-0000-4000-8000-000000000001/2026/orphan.webp',
    '11111111-1111-4111-8111-111111111111'
  );

set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select is(
  (public.preview_data_retention(
    '11111111-0000-4000-8000-000000000001',
    30
  )->>'eligible_scan_count')::integer,
  1,
  'preview includes only evidence whose latest review is before the cutoff'
);
select is(
  (select count(*)::integer from public.plate_scans),
  2,
  'preview is read-only'
);
reset role;

set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
select throws_ok(
  $$ select public.prepare_data_retention(
    '11111111-0000-4000-8000-000000000001',
    30
  ) $$,
  '42501',
  'not authorized',
  'teacher cannot prepare irreversible retention cleanup'
);
reset role;

set local "request.jwt.claim.sub" = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
select throws_ok(
  $$ select public.preview_data_retention(
    '11111111-0000-4000-8000-000000000001',
    30
  ) $$,
  '42501',
  'not authorized',
  'viewer cannot inspect retention candidates'
);
reset role;

set local "request.jwt.claim.sub" = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
select throws_ok(
  $$ select public.prepare_data_retention(
    '11111111-0000-4000-8000-000000000001',
    30
  ) $$,
  '42501',
  'not authorized',
  'another school admin cannot prepare cleanup'
);
reset role;

set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select results_eq(
  $$
    select
      (prepared->>'eligible_scan_count')::integer,
      (prepared->>'eligible_image_count')::integer,
      jsonb_array_length(prepared->'image_paths')
    from (
      select public.prepare_data_retention(
        '11111111-0000-4000-8000-000000000001',
        30
      ) as prepared
    ) as result
  $$,
  $$ values (1, 1, 1) $$,
  'admin preparation snapshots one bounded scan and its private path'
);
select results_eq(
  $$
    select count(distinct prepared->>'run_id')
    from (
      values
        (public.prepare_data_retention(
          '11111111-0000-4000-8000-000000000001',
          30
        )),
        (public.prepare_data_retention(
          '11111111-0000-4000-8000-000000000001',
          30
        ))
    ) as calls(prepared)
  $$,
  $$ values (1::bigint) $$,
  'prepare is idempotent while a run remains active'
);

savepoint retention_failure_reason_probe;

select results_eq(
  $$
    select result->>'status', result->>'failure_reason'
    from (
      select public.finalize_data_retention(
        (select id from public.data_retention_runs where status = 'prepared'),
        false,
        'storage-provider-safe-reason'
      ) as result
    ) as failed
  $$,
  $$ values ('failed'::text, 'storage-provider-safe-reason'::text) $$,
  'failed finalization records the caller-safe failure reason without ambiguity'
);
select results_eq(
  $$
    select status, failure_reason
    from public.data_retention_runs
    where status = 'failed'
  $$,
  $$ values ('failed'::text, 'storage-provider-safe-reason'::text) $$,
  'the retention audit row persists the disambiguated failure reason'
);

rollback to savepoint retention_failure_reason_probe;

reset role;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select throws_like(
  $$
    delete from public.meal_records
    where id = '11111111-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  $$,
  '%permission denied%',
  'admin cannot bypass retention by deleting a meal row'
);
select throws_ok(
  $$
    select public.finalize_data_retention(
      (select id from public.data_retention_runs where status = 'prepared'),
      true,
      null
    )
  $$,
  '55000',
  'storage objects remain; database evidence was not deleted',
  'database finalization refuses to orphan a referenced storage object'
);
select is(
  (
    select count(*)::integer
    from public.plate_scans
    where id = '11111111-cccc-4ccc-8ccc-ccccccccccc1'
  ),
  1,
  'failed finalization leaves raw evidence intact'
);
reset role;

-- Simulate the successful result of the Storage API. Product code never issues
-- this SQL update; the finalizer independently verifies that the exact path is
-- gone before touching database evidence.
update storage.objects
set name = name || '.storage-api-removed'
where bucket_id = 'plate-images'
  and name = '11111111-0000-4000-8000-000000000001/2026/expired.webp';

set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select results_eq(
  $$
    select
      result->>'status',
      (result->>'deleted_scan_count')::integer,
      (result->>'deleted_image_count')::integer
    from (
      select public.finalize_data_retention(
        (select id from public.data_retention_runs where status = 'prepared'),
        true,
        null
      ) as result
    ) as completed
  $$,
  $$ values ('completed'::text, 1, 1) $$,
  'admin finalization records exact completed counts'
);
select results_eq(
  $$
    select id
    from public.plate_scans
    order by id
  $$,
  $$
    values ('11111111-cccc-4ccc-8ccc-ccccccccccc2'::uuid)
  $$,
  'eligible scan is deleted while the recently reviewed scan remains'
);
select is(
  (select count(*)::integer from public.meal_records),
  2,
  'class-level meal measurements remain available for research'
);
select results_eq(
  $$
    select
      (select count(*) from public.scan_detections),
      (select count(*) from public.scan_corrections)
  $$,
  $$ values (1::bigint, 0::bigint) $$,
  'detections and corrections cascade only for the selected scan'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'data_retention_runs'
      and column_name in ('image_path', 'scan_id', 'meal_record_id')
  ),
  0,
  'public audit summary stores no raw evidence identifiers'
);
reset role;
select is(
  (select count(*)::integer from private.data_retention_run_items),
  0,
  'private retention manifest is removed after completion'
);
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select results_eq(
  $$
    select
      candidate_scan_count,
      deleted_scan_count,
      status
    from public.data_retention_runs
  $$,
  $$ values (1, 1, 'completed'::text) $$,
  'same-school members can read the completed audit summary'
);
select is(
  (
    select public.finalize_data_retention(
      (select id from public.data_retention_runs limit 1),
      true,
      null
    )->>'status'
  ),
  'completed',
  'completed finalization is safe to retry'
);
reset role;

set local "request.jwt.claim.sub" = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
select is(
  (select count(*)::integer from public.data_retention_runs),
  0,
  'another school cannot read the retention audit summary'
);
reset role;

select is(
  (
    select count(*)::integer
    from pg_proc as function
    join pg_namespace as schema on schema.oid = function.pronamespace
    where schema.nspname = 'public'
      and function.prosecdef
  ),
  0,
  'retention keeps the exposed public schema free of security definer functions'
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
  'all application functions still pin an empty search path'
);

select * from finish();
rollback;
