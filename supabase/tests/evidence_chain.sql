begin;
set local search_path = public, extensions;

select plan(172);

-- Schema, privilege, and tenant-boundary contract.
-- 01
select is(
  (
    select count(*)::integer
    from pg_class
    where oid = any (
      array[
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
  ),
  9,
  'all nine meal evidence-chain tables exist'
);

-- 02
select is(
  (
    select count(*)::integer
    from pg_class
    where oid = any (
      array[
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
  9,
  'all evidence-chain tables enable RLS'
);

-- 03
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and column_name = 'school_id'
  ),
  9,
  'every evidence-chain table carries school_id'
);

-- 04
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and column_name = 'provenance'
  ),
  9,
  'every evidence-chain table requires provenance'
);

-- 05
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
  ),
  'anon has zero table privileges on the evidence chain'
);

-- 06
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and table_name = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and privilege_type = any (array['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
  ),
  35,
  'authenticated has explicit CRUD grants except destructive meal-batch deletion'
);

-- 07
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'service_role'
      and table_name = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and privilege_type = any (array['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
  ),
  36,
  'service_role has deterministic Data API grants for all nine tables'
);

-- 08
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
  ),
  35,
  'every allowed operation has a separate policy and meal-batch deletion has none'
);

-- 09
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and cmd = 'ALL'
  ),
  'evidence writes use operation-specific policies'
);

-- 10
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and (
        coalesce(qual, '') ilike '%user_metadata%'
        or coalesce(with_check, '') ilike '%user_metadata%'
      )
  ),
  'authorization never trusts user_metadata'
);

-- 11
select is(
  (
    select count(*)::integer
    from pg_constraint as candidate_constraint
    join pg_class as table_class
      on table_class.oid = candidate_constraint.conrelid
    join pg_namespace as schema on schema.oid = table_class.relnamespace
    where schema.nspname = 'public'
      and table_class.relname = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and candidate_constraint.contype = 'u'
      and pg_get_constraintdef(candidate_constraint.oid)
        like 'UNIQUE (school_id, id)%'
  ),
  9,
  'every globally identified row also exposes a school-scoped candidate key'
);

-- 12
select is(
  (
    select count(*)::integer
    from pg_constraint as candidate_constraint
    join pg_class as table_class
      on table_class.oid = candidate_constraint.conrelid
    join pg_namespace as schema on schema.oid = table_class.relnamespace
    where schema.nspname = 'public'
      and table_class.relname = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and candidate_constraint.contype = 'f'
      and cardinality(candidate_constraint.conkey) = 2
  ),
  13,
  'all thirteen evidence relationships use composite school-scoped foreign keys'
);

-- 13
select ok(
  not exists (
    select 1
    from pg_constraint as foreign_key
    join pg_class as table_class on table_class.oid = foreign_key.conrelid
    join pg_namespace as schema on schema.oid = table_class.relnamespace
    where foreign_key.contype = 'f'
      and schema.nspname = 'public'
      and table_class.relname = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and not exists (
        select 1
        from pg_index as index
        where index.indrelid = foreign_key.conrelid
          and index.indisvalid
          and index.indisready
          and index.indpred is null
          and (index.indkey::smallint[])[0:cardinality(foreign_key.conkey) - 1]
            @> foreign_key.conkey
          and foreign_key.conkey @>
            (index.indkey::smallint[])[0:cardinality(foreign_key.conkey) - 1]
      )
  ),
  'every evidence-chain foreign key has a usable leading-column index'
);

-- 14
select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = any (
      array[
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
      and not tgisinternal
      and tgname like '%_force_created_by'
  ),
  9,
  'database attribution triggers protect all nine tables'
);

-- 15
select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = any (
      array[
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
      and not tgisinternal
      and tgname like '%_updated_at'
  ),
  9,
  'database timestamp triggers protect all nine tables'
);

-- 16
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collection_events'
      and column_name = 'actual_treatment_method'
  ),
  'collection events do not masquerade a planned route as an actual route'
);

-- 17
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'destination_receipts'
      and column_name = 'planned_treatment_method'
  ),
  'destination receipts do not duplicate the planned route'
);

-- 18
select has_column(
  'public',
  'collection_events',
  'planned_treatment_method',
  'collection events preserve the planned treatment route'
);

-- 19
select has_column(
  'public',
  'destination_receipts',
  'actual_treatment_method',
  'destination receipts preserve the actual treatment route'
);

-- 20
select is(
  (
    select count(distinct table_class.relname)::integer
    from pg_constraint as candidate_constraint
    join pg_class as table_class
      on table_class.oid = candidate_constraint.conrelid
    join pg_namespace as schema on schema.oid = table_class.relnamespace
    where schema.nspname = 'public'
      and table_class.relname = any (
        array[
          'menu_versions',
          'menu_items',
          'meal_batches',
          'meal_contexts',
          'feedback_events',
          'waste_measurements',
          'human_decisions',
          'collection_events',
          'destination_receipts'
        ]
      )
      and candidate_constraint.contype = 'c'
      and pg_get_constraintdef(candidate_constraint.oid) like '%demo%'
      and pg_get_constraintdef(candidate_constraint.oid) like '%measured%'
      and pg_get_constraintdef(candidate_constraint.oid) like '%estimated%'
      and pg_get_constraintdef(candidate_constraint.oid) like '%official%'
  ),
  9,
  'all tables constrain provenance to the four evidence labels'
);

-- Test principals and two isolated schools.
insert into auth.users (id, email, aud, role, email_confirmed_at)
values
  ('e1111111-1111-4111-8111-111111111111', 'evidence-teacher-a@example.test', 'authenticated', 'authenticated', now()),
  ('e2222222-2222-4222-8222-222222222222', 'evidence-teacher-b@example.test', 'authenticated', 'authenticated', now()),
  ('e3333333-3333-4333-8333-333333333333', 'evidence-viewer-a@example.test', 'authenticated', 'authenticated', now()),
  ('e4444444-4444-4444-8444-444444444444', 'evidence-admin-a@example.test', 'authenticated', 'authenticated', now());

insert into public.schools (id, name)
values
  ('eaaaaaaa-0000-4000-8000-000000000001', 'Evidence school A'),
  ('ebbbbbbb-0000-4000-8000-000000000002', 'Evidence school B');

insert into public.memberships (school_id, user_id, role)
values
  ('eaaaaaaa-0000-4000-8000-000000000001', 'e1111111-1111-4111-8111-111111111111', 'teacher'),
  ('ebbbbbbb-0000-4000-8000-000000000002', 'e2222222-2222-4222-8222-222222222222', 'teacher'),
  ('eaaaaaaa-0000-4000-8000-000000000001', 'e3333333-3333-4333-8333-333333333333', 'viewer'),
  ('eaaaaaaa-0000-4000-8000-000000000001', 'e4444444-4444-4444-8444-444444444444', 'admin');

insert into public.classes (id, school_id, name, grade)
values
  ('eaaaaaaa-0100-4100-8100-000000000001', 'eaaaaaaa-0000-4000-8000-000000000001', '五年證據班', 5),
  ('eaaaaaaa-0100-4100-8100-000000000002', 'eaaaaaaa-0000-4000-8000-000000000001', '六年證據班', 6),
  ('ebbbbbbb-0100-4100-8100-000000000002', 'ebbbbbbb-0000-4000-8000-000000000002', '六年證據班', 6);

set local "request.jwt.claim.sub" = 'e1111111-1111-4111-8111-111111111111';

insert into public.menu_versions (
  id,
  school_id,
  service_date,
  version_number,
  title,
  source_system,
  status,
  provenance,
  confirmed_by,
  confirmed_at,
  created_by
) values (
  'eaaaaaaa-1000-4100-8100-000000000001',
  'eaaaaaaa-0000-4000-8000-000000000001',
  date '2026-09-03',
  1,
  'School A lunch',
  'school-confirmed',
  'confirmed',
  'official',
  'e1111111-1111-4111-8111-111111111111',
  now(),
  'e1111111-1111-4111-8111-111111111111'
);

insert into public.menu_items (
  id,
  school_id,
  menu_version_id,
  sort_order,
  display_name,
  normalized_name,
  category,
  standard_portion_g,
  weight_basis,
  status,
  provenance,
  created_by
) values (
  'eaaaaaaa-2000-4200-8200-000000000001',
  'eaaaaaaa-0000-4000-8000-000000000001',
  'eaaaaaaa-1000-4100-8100-000000000001',
  1,
  '咖哩雞',
  '咖哩雞',
  'meat',
  90,
  'ready_to_eat',
  'confirmed',
  'official',
  'e1111111-1111-4111-8111-111111111111'
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
  source,
  created_by
) values (
  'eaaaaaaa-3000-4300-8300-000000000001',
  'eaaaaaaa-0000-4000-8000-000000000001',
  'eaaaaaaa-0100-4100-8100-000000000001',
  date '2026-09-03',
  '白飯',
  '咖哩雞',
  '白飯|咖哩雞',
  25,
  24,
  6200,
  900,
  'scale',
  'manual',
  'e1111111-1111-4111-8111-111111111111'
);

insert into public.meal_batches (
  id,
  school_id,
  meal_record_id,
  menu_version_id,
  class_id,
  service_date,
  status,
  planned_people,
  notified_people,
  actual_people,
  planned_supply_g,
  produced_weight_g,
  delivered_weight_g,
  served_weight_g,
  weight_basis,
  provenance,
  created_by
) values (
  'eaaaaaaa-4000-4400-8400-000000000001',
  'eaaaaaaa-0000-4000-8000-000000000001',
  'eaaaaaaa-3000-4300-8300-000000000001',
  'eaaaaaaa-1000-4100-8100-000000000001',
  'eaaaaaaa-0100-4100-8100-000000000001',
  date '2026-09-03',
  'closed',
  25,
  24,
  24,
  6500,
  6400,
  6300,
  6200,
  'ready_to_eat',
  'measured',
  'e1111111-1111-4111-8111-111111111111'
);

insert into public.supply_predictions (
  id,
  school_id,
  created_by,
  planned_people,
  menu_name,
  planned_supply_g,
  recommended_supply_g,
  average_leftover_rate,
  possible_saving_g,
  possible_saving_twd,
  confidence,
  match_level,
  sample_size,
  independent_date_count,
  evidence_meal_ids,
  history_start,
  history_end,
  reason,
  algorithm_version
) values (
  'evidence-prediction-a',
  'eaaaaaaa-0000-4000-8000-000000000001',
  'e1111111-1111-4111-8111-111111111111',
  25,
  '咖哩雞',
  6500,
  5600,
  0.1400,
  900,
  72,
  'medium',
  'exact',
  3,
  3,
  array['eaaaaaaa-3000-4300-8300-000000000001'],
  date '2026-08-01',
  date '2026-09-03',
  'Matched meal evidence',
  'evidence-test-v1'
);

set local "request.jwt.claim.sub" = 'e2222222-2222-4222-8222-222222222222';

insert into public.menu_versions (
  id,
  school_id,
  service_date,
  version_number,
  title,
  source_system,
  status,
  provenance,
  confirmed_by,
  confirmed_at,
  created_by
) values (
  'ebbbbbbb-1000-4100-8100-000000000002',
  'ebbbbbbb-0000-4000-8000-000000000002',
  date '2026-09-03',
  1,
  'School B lunch',
  'school-confirmed',
  'confirmed',
  'official',
  'e2222222-2222-4222-8222-222222222222',
  now(),
  'e2222222-2222-4222-8222-222222222222'
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
  provenance,
  created_by
) values (
  'ebbbbbbb-2000-4200-8200-000000000002',
  'ebbbbbbb-0000-4000-8000-000000000002',
  'ebbbbbbb-1000-4100-8100-000000000002',
  1,
  '青菜',
  '青菜',
  'vegetable',
  'confirmed',
  'official',
  'e2222222-2222-4222-8222-222222222222'
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
  source,
  created_by
) values (
  'ebbbbbbb-3000-4300-8300-000000000002',
  'ebbbbbbb-0000-4000-8000-000000000002',
  'ebbbbbbb-0100-4100-8100-000000000002',
  date '2026-09-03',
  '麵',
  '蔬菜',
  '麵|蔬菜',
  24,
  24,
  6000,
  1000,
  'scale',
  'manual',
  'e2222222-2222-4222-8222-222222222222'
);

insert into public.meal_batches (
  id,
  school_id,
  meal_record_id,
  menu_version_id,
  class_id,
  service_date,
  status,
  planned_people,
  notified_people,
  actual_people,
  planned_supply_g,
  produced_weight_g,
  delivered_weight_g,
  served_weight_g,
  weight_basis,
  provenance,
  created_by
) values (
  'ebbbbbbb-4000-4400-8400-000000000002',
  'ebbbbbbb-0000-4000-8000-000000000002',
  'ebbbbbbb-3000-4300-8300-000000000002',
  'ebbbbbbb-1000-4100-8100-000000000002',
  'ebbbbbbb-0100-4100-8100-000000000002',
  date '2026-09-03',
  'closed',
  24,
  24,
  24,
  6100,
  6100,
  6050,
  6000,
  'ready_to_eat',
  'measured',
  'e2222222-2222-4222-8222-222222222222'
);

-- Role and RLS behavior.
set local "request.jwt.claim.sub" = 'e1111111-1111-4111-8111-111111111111';
set local role authenticated;

-- 21
select results_eq(
  $$ select id from public.menu_versions order by id $$,
  $$ values ('eaaaaaaa-1000-4100-8100-000000000001'::uuid) $$,
  'school A teacher reads only school A menus'
);

-- 22
select throws_like(
  $$
    insert into public.menu_versions (
      school_id, service_date, version_number, title, source_system, status, provenance
    ) values (
      'ebbbbbbb-0000-4000-8000-000000000002',
      date '2026-09-04',
      1,
      'Cross-school menu',
      'test',
      'draft',
      'demo'
    )
  $$,
  '%row-level security%',
  'school A teacher cannot insert a school B menu'
);

-- 23
select throws_like(
  $$
    insert into public.menu_items (
      school_id,
      menu_version_id,
      sort_order,
      display_name,
      normalized_name,
      category,
      status,
      provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'ebbbbbbb-1000-4100-8100-000000000002',
      99,
      'Cross-school item',
      'Cross-school item',
      'other',
      'proposed',
      'demo'
    )
  $$,
  '%violates foreign key constraint%',
  'composite foreign keys reject a school B menu on a school A item'
);

-- 24
select lives_ok(
  $$
    insert into public.meal_contexts (
      id,
      school_id,
      meal_batch_id,
      context_type,
      context_value,
      observed_at,
      status,
      provenance,
      created_by
    ) values (
      'eaaaaaaa-6000-4600-8600-000000000001',
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'attendance',
      '{"actual_people":24}'::jsonb,
      now(),
      'confirmed',
      'measured',
      'e2222222-2222-4222-8222-222222222222'
    )
  $$,
  'teacher can write evidence for their own school'
);

-- 25
select is(
  (
    select created_by
    from public.meal_contexts
    where id = 'eaaaaaaa-6000-4600-8600-000000000001'
  ),
  'e1111111-1111-4111-8111-111111111111'::uuid,
  'created_by is forced to the authenticated teacher rather than trusted input'
);

-- 26
set local "request.jwt.claim.sub" = 'e3333333-3333-4333-8333-333333333333';
select is(
  (select count(*)::integer from public.menu_versions),
  1,
  'same-school viewer can read evidence'
);

-- 27
select throws_like(
  $$
    insert into public.meal_contexts (
      school_id,
      meal_batch_id,
      context_type,
      context_value,
      observed_at,
      status,
      provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'calendar',
      '{"event":"viewer write"}'::jsonb,
      now(),
      'recorded',
      'official'
    )
  $$,
  '%row-level security%',
  'viewer cannot use the authenticated insert grant to write evidence'
);

-- 28
set local "request.jwt.claim.sub" = 'e4444444-4444-4444-8444-444444444444';
select lives_ok(
  $$
    insert into public.feedback_events (
      school_id,
      meal_batch_id,
      menu_item_id,
      actor_role,
      reason_code,
      rating,
      response_count,
      status,
      provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'eaaaaaaa-2000-4200-8200-000000000001',
      'parent',
      'taste',
      4,
      2,
      'submitted',
      'measured'
    )
  $$,
  'same-school admin can write aggregated feedback evidence'
);

-- 29
set local "request.jwt.claim.sub" = 'e2222222-2222-4222-8222-222222222222';
select is(
  (
    select count(*)::integer
    from (
      select id from public.menu_versions where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      union all select id from public.menu_items where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      union all select id from public.meal_batches where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      union all select id from public.meal_contexts where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      union all select id from public.feedback_events where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      union all select id from public.waste_measurements where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      union all select id from public.human_decisions where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      union all select id from public.collection_events where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      union all select id from public.destination_receipts where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
    ) as school_a_evidence
  ),
  0,
  'school B teacher cannot read any school A evidence-chain row'
);

-- 30
select results_eq(
  $$
    update public.menu_versions
    set title = 'Cross-school overwrite'
    where id = 'eaaaaaaa-1000-4100-8100-000000000001'
    returning id
  $$,
  $$ select null::uuid where false $$,
  'school B teacher cannot update a school A row'
);

-- 31
reset role;
set local role anon;
select throws_like(
  $$ select * from public.menu_versions $$,
  '%permission denied%',
  'anon cannot query the evidence chain'
);

-- 32
reset role;
set local "request.jwt.claim.sub" = 'e1111111-1111-4111-8111-111111111111';
set local role authenticated;
select lives_ok(
  $$
    insert into public.waste_measurements (
      school_id,
      meal_batch_id,
      menu_item_id,
      waste_source,
      measurement_method,
      weight_state,
      net_weight_g,
      measured_at,
      status,
      provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'eaaaaaaa-2000-4200-8200-000000000001',
      'plate_edible',
      'scale',
      'standard_drained',
      100,
      now(),
      'confirmed',
      'measured'
    )
  $$,
  'teacher receives effective write access after both grant and RLS checks'
);
reset role;

-- Constraint behavior. Keep the caller identity for attribution triggers while
-- running as the transaction owner so a failing test isolates the constraint.
set local "request.jwt.claim.sub" = 'e1111111-1111-4111-8111-111111111111';

-- 33
select throws_like(
  $$
    insert into public.meal_contexts (
      school_id, meal_batch_id, context_type, context_value, observed_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'weather',
      '{}',
      now(),
      'recorded',
      'invented'
    )
  $$,
  '%violates check constraint%',
  'unknown provenance is rejected'
);

-- 34
select throws_like(
  $$
    insert into public.waste_measurements (
      school_id, meal_batch_id, waste_source, measurement_method, weight_state,
      net_weight_g, measured_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'mixed_bucket',
      'scale',
      'wet',
      100,
      now(),
      'recorded',
      'measured'
    )
  $$,
  '%violates check constraint%',
  'unclassified mixed waste cannot bypass the five-source model'
);

-- 35
select lives_ok(
  $$
    insert into public.waste_measurements (
      school_id, meal_batch_id, waste_source, measurement_method, weight_state,
      net_weight_g, measured_at, status, provenance
    )
    select
      'eaaaaaaa-0000-4000-8000-000000000001'::uuid,
      'eaaaaaaa-4000-4400-8400-000000000001'::uuid,
      source,
      'scale',
      'standard_drained',
      10,
      now(),
      'confirmed',
      'measured'
    from unnest(
      array[
        'unserved_edible',
        'plate_edible',
        'inedible',
        'preparation',
        'liquid'
      ]::text[]
    ) as source
  $$,
  'all five explicit waste sources are accepted'
);

-- 36
select is(
  (
    select count(distinct waste_source)::integer
    from public.waste_measurements
    where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
  ),
  5,
  'stored measurements preserve five distinct waste sources'
);

-- 37
select throws_like(
  $$
    insert into public.waste_measurements (
      school_id, meal_batch_id, waste_source, measurement_method, weight_state,
      net_weight_g, measured_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'plate_edible',
      'scale',
      'wet',
      -1,
      now(),
      'recorded',
      'measured'
    )
  $$,
  '%violates check constraint%',
  'negative waste weight is rejected'
);

-- 38
select throws_like(
  $$
    insert into public.waste_measurements (
      school_id, meal_batch_id, waste_source, measurement_method, weight_state,
      net_weight_g, tare_weight_g, gross_weight_g, measured_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'plate_edible',
      'scale',
      'wet',
      100,
      10,
      120,
      now(),
      'recorded',
      'measured'
    )
  $$,
  '%violates check constraint%',
  'net weight must equal gross minus tare when both are supplied'
);

-- 39
select throws_like(
  $$
    insert into public.waste_measurements (
      school_id, meal_batch_id, waste_source, measurement_method, weight_state,
      net_weight_g, measured_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'plate_edible',
      'calibrated_photo',
      'wet',
      70,
      now(),
      'recorded',
      'estimated'
    )
  $$,
  '%violates check constraint%',
  'estimated evidence requires lower and upper bounds'
);

-- 40
select throws_like(
  $$
    insert into public.waste_measurements (
      school_id, meal_batch_id, waste_source, measurement_method, weight_state,
      net_weight_g, estimate_low_g, estimate_high_g, measured_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'plate_edible',
      'manual_estimate',
      'wet',
      70,
      80,
      100,
      now(),
      'recorded',
      'estimated'
    )
  $$,
  '%violates check constraint%',
  'an estimate must lie inside its declared bounds'
);

-- 41
select throws_like(
  $$
    insert into public.waste_measurements (
      school_id, meal_batch_id, waste_source, measurement_method, weight_state,
      net_weight_g, estimate_low_g, estimate_high_g, measured_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'plate_edible',
      'calibrated_photo',
      'wet',
      70,
      60,
      80,
      now(),
      'recorded',
      'measured'
    )
  $$,
  '%violates check constraint%',
  'photo-derived evidence cannot be relabelled as measured'
);

-- 42
select lives_ok(
  $$
    insert into public.waste_measurements (
      school_id, meal_batch_id, waste_source, measurement_method, weight_state,
      net_weight_g, measured_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'unserved_edible',
      'facility_receipt',
      'dewatered',
      80,
      now(),
      'confirmed',
      'official'
    )
  $$,
  'official facility-receipt weight is accepted with truthful provenance'
);

-- 43
select lives_ok(
  $$
    insert into public.meal_batches (
      id, school_id, menu_version_id, class_id, service_date, status,
      planned_people, actual_people, planned_supply_g, produced_weight_g,
      served_weight_g, weight_basis, provenance
    ) values (
      'eaaaaaaa-4000-4400-8400-000000000043',
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-1000-4100-8100-000000000001',
      'eaaaaaaa-0100-4100-8100-000000000001',
      date '2026-09-04',
      'closed',
      25,
      25,
      6000,
      6000,
      5900,
      'ready_to_eat',
      'demo'
    )
  $$,
  'a closed classroom meal can preserve unknown delivery evidence as null'
);

-- 44
select throws_like(
  $$
    insert into public.menu_items (
      school_id, menu_version_id, sort_order, display_name, normalized_name,
      category, standard_portion_g, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-1000-4100-8100-000000000001',
      99,
      'Missing basis',
      'Missing basis',
      'other',
      100,
      'proposed',
      'demo'
    )
  $$,
  '%violates check constraint%',
  'a standard portion cannot omit raw, cooked, or ready-to-eat basis'
);

-- 45
select throws_like(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, prediction_id,
      meal_batch_id, decision, decided_supply_g, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'supply_prediction',
      'evidence-prediction-a',
      'evidence-prediction-a',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'rejected',
      5600,
      'Rejected decision must not pretend to select a quantity',
      'active',
      'official'
    )
  $$,
  '%violates check constraint%',
  'a rejected recommendation cannot carry a decided supply amount'
);

-- 46
select throws_like(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, prediction_id,
      meal_batch_id, decision, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'supply_prediction',
      'evidence-prediction-a',
      'evidence-prediction-a',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'accepted',
      'Accepted decision requires the human-selected amount',
      'active',
      'official'
    )
  $$,
  '%violates check constraint%',
  'an accepted recommendation requires a decided supply amount'
);

-- 47
select lives_ok(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, prediction_id,
      meal_batch_id, decision, decided_supply_g, safety_margin_g, rationale,
      status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'supply_prediction',
      'evidence-prediction-a',
      'evidence-prediction-a',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'adjusted',
      5700,
      200,
      'Dietitian keeps a documented safety margin',
      'active',
      'official'
    )
  $$,
  'a valid human adjustment remains distinct from the AI prediction'
);

-- 48
select lives_ok(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, meal_batch_id,
      decision, decided_by_role, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'responsibility_card',
      'headcount-reserve',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'pilot',
      'dietitian',
      'Run a bounded class-level pilot before any wider operational change',
      'active',
      'measured'
    )
  $$,
  'a responsibility card can record a small pilot without a supply prediction'
);

-- 49
select lives_ok(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, meal_batch_id,
      decision, decided_by_role, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'responsibility_card',
      'need-more-data',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'collect_more_data',
      'teacher-student-team',
      'Collect three independent meal days before choosing an intervention',
      'active',
      'measured'
    )
  $$,
  'a responsibility card can explicitly defer action pending more evidence'
);

-- 50
select throws_like(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, prediction_id,
      decision, decided_by_role, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'responsibility_card',
      'headcount-reserve',
      'evidence-prediction-a',
      'pilot',
      'school-committee',
      'A responsibility card must not silently become a prediction decision',
      'active',
      'measured'
    )
  $$,
  '%violates check constraint%',
  'a responsibility-card decision cannot claim a supply-prediction link'
);

-- 51
select throws_like(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, decision,
      decided_supply_g, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'supply_prediction',
      'missing-prediction',
      'accepted',
      5600,
      'A supply decision must retain its source prediction',
      'active',
      'official'
    )
  $$,
  '%violates check constraint%',
  'a supply-prediction decision cannot omit prediction_id'
);

-- 52
select throws_like(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, prediction_id,
      decision, decided_supply_g, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'supply_prediction',
      'wrong-key',
      'evidence-prediction-a',
      'accepted',
      5600,
      'The stable recommendation key must identify the linked prediction',
      'active',
      'official'
    )
  $$,
  '%violates check constraint%',
  'a supply decision recommendation_key must equal prediction_id'
);

-- 53
select throws_like(
  $$
    insert into public.collection_events (
      school_id, meal_batch_id, status, scheduled_at, weight_state,
      planned_destination_name, planned_treatment_method, waste_sources,
      provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'collected',
      now(),
      'wet',
      'Unknown pickup',
      'unknown',
      array['inedible'],
      'estimated'
    )
  $$,
  '%violates check constraint%',
  'collected status requires collection time, weight, and hauler'
);

insert into public.collection_events (
  id,
  school_id,
  meal_batch_id,
  status,
  scheduled_at,
  collected_at,
  hauler_name,
  manifest_reference,
  net_collected_weight_g,
  weight_state,
  planned_destination_name,
  planned_treatment_method,
  waste_sources,
  provenance,
  created_by
) values (
  'eaaaaaaa-5000-4500-8500-000000000001',
  'eaaaaaaa-0000-4000-8000-000000000001',
  'eaaaaaaa-4000-4400-8400-000000000001',
  'collected',
  timestamptz '2026-09-03 12:30:00+08',
  timestamptz '2026-09-03 13:30:00+08',
  'Evidence Hauler',
  'MANIFEST-A',
  1200,
  'standard_drained',
  'Planned Compost Site',
  'composting',
  array['preparation', 'unserved_edible', 'plate_edible'],
  'official',
  'e1111111-1111-4111-8111-111111111111'
);

-- 54
select throws_like(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, accepted_weight_g, received_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-5000-4500-8500-000000000001',
      'INVALID-VERIFY-MISSING-ACTOR',
      'Evidence Facility',
      'composting',
      1000,
      now(),
      'verified',
      'official'
    )
  $$,
  '%violates check constraint%',
  'verified destination requires verifier and verification time'
);

-- 55
select throws_like(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, accepted_weight_g, received_at, status,
      verified_by, verified_at, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-5000-4500-8500-000000000001',
      'INVALID-VERIFY-UNKNOWN-ROUTE',
      'Evidence Facility',
      'unknown',
      1000,
      now(),
      'verified',
      'e1111111-1111-4111-8111-111111111111',
      now(),
      'official'
    )
  $$,
  '%violates check constraint%',
  'unknown treatment route cannot be marked verified'
);

-- 56
select throws_like(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, received_at, status, document_sha256, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-5000-4500-8500-000000000001',
      'INVALID-HASH',
      'Evidence Facility',
      'unknown',
      now(),
      'submitted',
      'not-a-sha256',
      'official'
    )
  $$,
  '%violates check constraint%',
  'receipt document fingerprint must be a lowercase SHA-256 value'
);

insert into public.destination_receipts (
  school_id,
  collection_event_id,
  receipt_reference,
  facility_name,
  actual_treatment_method,
  received_at,
  status,
  provenance
) values (
  'eaaaaaaa-0000-4000-8000-000000000001',
  'eaaaaaaa-5000-4500-8500-000000000001',
  'SUBMITTED-NOT-VERIFIED',
  'Pending Evidence Facility',
  'unknown',
  now(),
  'submitted',
  'official'
);

-- 57
select is(
  (
    select count(*)::integer
    from public.destination_receipts
    where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      and status = 'verified'
  ),
  0,
  'a submitted receipt does not count as a verified destination'
);

-- 58
select lives_ok(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, accepted_weight_g, received_at, status,
      verified_by, verified_at, document_sha256, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-5000-4500-8500-000000000001',
      'VERIFIED-ACTUAL-ROUTE',
      'Actual Anaerobic Facility',
      'anaerobic_digestion',
      1050,
      now(),
      'verified',
      'e1111111-1111-4111-8111-111111111111',
      now(),
      repeat('a', 64),
      'official'
    )
  $$,
  'complete official evidence can verify the actual destination'
);

-- 59
select results_eq(
  $$
    select
      collection.planned_treatment_method,
      receipt.actual_treatment_method
    from public.collection_events as collection
    join public.destination_receipts as receipt
      on receipt.school_id = collection.school_id
     and receipt.collection_event_id = collection.id
    where receipt.receipt_reference = 'VERIFIED-ACTUAL-ROUTE'
  $$,
  $$ values ('composting'::text, 'anaerobic_digestion'::text) $$,
  'planned and verified treatment routes remain separate evidence'
);

-- 60
select throws_like(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, received_at, status, provenance
    ) values (
      'ebbbbbbb-0000-4000-8000-000000000002',
      'eaaaaaaa-5000-4500-8500-000000000001',
      'CROSS-SCHOOL-RECEIPT',
      'Wrong-school facility',
      'unknown',
      now(),
      'submitted',
      'official'
    )
  $$,
  '%violates foreign key constraint%',
  'destination receipts cannot attach across schools'
);

-- Atomic aggregate RPC contract.
-- 61
select has_column(
  'public',
  'meal_batches',
  'client_case_id',
  'meal batches persist a school-scoped client idempotency key'
);

-- 62
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meal_batches'::regclass
      and conname = 'meal_batches_school_client_case_key'
      and contype = 'u'
  ),
  'client_case_id is unique within a school'
);

-- 63
select ok(
  (
    select not prosecdef
      and proconfig @> array['search_path=""']::text[]
    from pg_proc
    where oid = 'public.save_meal_evidence_chain(jsonb)'::regprocedure
  ),
  'aggregate save RPC is SECURITY INVOKER with an empty search_path'
);

-- 64
select ok(
  has_function_privilege(
    'authenticated',
    'public.save_meal_evidence_chain(jsonb)',
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.save_meal_evidence_chain(jsonb)',
      'execute'
    )
    and not has_function_privilege(
      'service_role',
      'public.save_meal_evidence_chain(jsonb)',
      'execute'
    ),
  'only authenticated browser sessions receive explicit aggregate RPC execute permission'
);

-- Simulate a menu imported through another trusted school workflow before the
-- browser submits its own deterministic UUIDs for the same natural keys.
insert into public.menu_versions (
  id,
  school_id,
  service_date,
  meal_period,
  version_number,
  title,
  source_system,
  status,
  provenance,
  confirmed_by,
  confirmed_at,
  created_by
) values (
  'eaaaaaaa-7101-4710-8710-000000000001',
  'eaaaaaaa-0000-4000-8000-000000000001',
  date '2026-09-04',
  'lunch',
  1,
  'Canonical imported lunch',
  'trusted-import',
  'confirmed',
  'official',
  'e1111111-1111-4111-8111-111111111111',
  timestamptz '2026-09-04 08:00:00+08',
  'e1111111-1111-4111-8111-111111111111'
);

insert into public.menu_items (
  id,
  school_id,
  menu_version_id,
  sort_order,
  display_name,
  normalized_name,
  category,
  standard_portion_g,
  weight_basis,
  status,
  provenance,
  created_by
) values
  (
    'eaaaaaaa-7201-4720-8720-000000000001',
    'eaaaaaaa-0000-4000-8000-000000000001',
    'eaaaaaaa-7101-4710-8710-000000000001',
    0,
    '既有白飯',
    '白飯',
    'rice',
    120,
    'ready_to_eat',
    'confirmed',
    'official',
    'e1111111-1111-4111-8111-111111111111'
  ),
  (
    'eaaaaaaa-7201-4720-8720-000000000002',
    'eaaaaaaa-0000-4000-8000-000000000001',
    'eaaaaaaa-7101-4710-8710-000000000001',
    1,
    '既有青花菜',
    '青花菜',
    'vegetable',
    70,
    'ready_to_eat',
    'confirmed',
    'official',
    'e1111111-1111-4111-8111-111111111111'
  );

create temporary table evidence_chain_rpc_payload (payload jsonb not null)
on commit drop;

insert into evidence_chain_rpc_payload (payload) values (
  jsonb_build_object(
    'school_id', 'eaaaaaaa-0000-4000-8000-000000000001',
    'client_case_id', 'eaaaaaaa-7000-4700-8700-000000000001',
    'audit_payload', jsonb_build_object(
      'schemaVersion', '1',
      'id', 'atomic-evidence-case',
      'feedbackSchemaVersion', 2,
      'actualDiners', 24,
      'reasonCollectionStatus', 'collected',
      'reasonCounts', jsonb_build_object('portion',0,'taste',0,'texture',12,'temperature',0,'time',0,'other',0),
      'teacherContext', jsonb_build_object('deliveryStatus','recorded','temperatureStatus','recorded','deliveryDelayMinutes',5,'temperatureConcern',false,'note','')
    ),
    'menu_version', jsonb_build_object(
      'id', 'eaaaaaaa-7100-4710-8710-000000000001',
      'service_date', '2026-09-04',
      'meal_period', 'lunch',
      'version_number', 1,
      'title', 'Atomic evidence lunch',
      'source_system', 'school-confirmed',
      'source_reference', 'MENU-RPC-001',
      'status', 'confirmed',
      'provenance', 'official',
      'confirmed_at', '2026-09-04T08:00:00+08:00'
    ),
    'menu_items', jsonb_build_array(
      jsonb_build_object(
        'id', 'eaaaaaaa-7200-4720-8720-000000000001',
        'sort_order', 0,
        'display_name', '白飯',
        'normalized_name', '白飯',
        'category', 'rice',
        'standard_portion_g', 120,
        'weight_basis', 'ready_to_eat',
        'status', 'confirmed',
        'provenance', 'official'
      ),
      jsonb_build_object(
        'id', 'eaaaaaaa-7200-4720-8720-000000000002',
        'sort_order', 1,
        'display_name', '青花菜',
        'normalized_name', '青花菜',
        'category', 'vegetable',
        'preparation_method', '清炒',
        'standard_portion_g', 70,
        'weight_basis', 'ready_to_eat',
        'status', 'confirmed',
        'provenance', 'official'
      )
    ),
    'meal_record', jsonb_build_object(
      'id', 'eaaaaaaa-7250-4725-8725-000000000001',
      'class_id', 'eaaaaaaa-0100-4100-8100-000000000001',
      'served_on', '2026-09-04',
      'meal_period', 'lunch',
      'staple', '白飯',
      'main_dish', '青花菜午餐',
      'side_dishes', jsonb_build_array('青花菜'),
      'menu_signature', 'atomic-rice-broccoli-v1',
      'planned_people', 25,
      'actual_people', 24,
      'total_supply_g', 6500,
      'leftover_g', 420,
      'measurement_method', 'sample-extrapolation',
      'notes', 'Atomic evidence summary',
      'source', 'manual',
      'created_at', '2026-09-04T07:30:00+08:00',
      'updated_at', '2026-09-04T15:30:00+08:00'
    ),
    'meal_batch', jsonb_build_object(
      'id', 'eaaaaaaa-7300-4730-8730-000000000001',
      'meal_record_id', 'eaaaaaaa-7250-4725-8725-000000000001',
      'class_id', 'eaaaaaaa-0100-4100-8100-000000000001',
      'service_date', '2026-09-04',
      'meal_period', 'lunch',
      'status', 'closed',
      'planned_people', 25,
      'notified_people', 24,
      'actual_people', 24,
      'planned_supply_g', 6500,
      'produced_weight_g', 6400,
      'delivered_weight_g', 6300,
      'served_weight_g', 6200,
      'weight_basis', 'ready_to_eat',
      'provenance', 'measured'
    ),
    'contexts', jsonb_build_array(
      jsonb_build_object(
        'id', 'eaaaaaaa-7400-4740-8740-000000000001',
        'context_type', 'operational',
        'context_value', jsonb_build_object(
          'feedback_schema_version',2,'reason_collection_status','collected',
          'reason_counts',jsonb_build_object('portion',0,'taste',0,'texture',12,'temperature',0,'time',0,'other',0),
          'delivery_status','recorded','temperature_status','recorded','delivery_delay_minutes',5,'temperature_concern',false,'note',''
        ),
        'observed_at', '2026-09-04T12:00:00+08:00',
        'status', 'confirmed',
        'source_reference', 'CLASS-LOG-001',
        'provenance', 'measured'
      )
    ),
    'feedback', jsonb_build_array(
      jsonb_build_object(
        'id', 'eaaaaaaa-7500-4750-8750-000000000001',
        'menu_item_id', 'eaaaaaaa-7200-4720-8720-000000000002',
        'actor_role', 'student',
        'reason_code', 'texture',
        'rating', 2,
        'response_count', 12,
        'note', 'Anonymous class tally',
        'status', 'submitted',
        'provenance', 'measured'
      )
    ),
    'measurements', jsonb_build_array(
      jsonb_build_object(
        'id', 'eaaaaaaa-7600-4760-8760-000000000001',
        'menu_item_id', 'eaaaaaaa-7200-4720-8720-000000000002',
        'waste_source', 'plate_edible',
        'measurement_method', 'scale',
        'weight_state', 'standard_drained',
        'net_weight_g', 120,
        'tare_weight_g', 50,
        'gross_weight_g', 170,
        'contamination_g', 0,
        'sample_plate_count', 24,
        'measured_at', '2026-09-04T12:30:00+08:00',
        'status', 'confirmed',
        'provenance', 'measured',
        'note', 'Class-scale measurement'
      )
    ),
    'human_decision', jsonb_build_object(
      'id', 'eaaaaaaa-7700-4770-8770-000000000001',
      'recommendation_kind', 'responsibility_card',
      'recommendation_key', 'recipe-texture',
      'decision', 'pilot',
      'decided_by_role', 'dietitian',
      'rationale', 'Try one class before any school-wide recipe change',
      'status', 'active',
      'provenance', 'measured',
      'decided_at', '2026-09-04T15:00:00+08:00'
    )
  )
);

grant select on table evidence_chain_rpc_payload to authenticated, anon;

set local "request.jwt.claim.sub" = 'e1111111-1111-4111-8111-111111111111';
set local role authenticated;

-- The immutability guard must still persist ordinary corrections before any
-- plate scan cites this menu. RETURN OLD in a BEFORE UPDATE trigger silently
-- reports success while discarding NEW, including natural-key RPC upserts.
select results_eq(
  $$
    update public.menu_items
    set display_name = '校正白飯', standard_portion_g = 135
    where id = 'eaaaaaaa-7201-4720-8720-000000000001'
    returning display_name, standard_portion_g, created_by
  $$,
  $$
    values (
      '校正白飯'::text, 135,
      'e1111111-1111-4111-8111-111111111111'::uuid
    )
  $$,
  'an uncited menu item update returns corrected values and retains attribution'
);

select results_eq(
  $$
    select display_name, standard_portion_g
    from public.menu_items
    where id = 'eaaaaaaa-7201-4720-8720-000000000001'
  $$,
  $$ values ('校正白飯'::text, 135) $$,
  'a subsequent read observes the uncited menu item correction'
);

insert into public.menu_items (
  id, school_id, menu_version_id, sort_order, display_name, normalized_name,
  category, status, provenance
) values (
  'eaaaaaaa-7201-4720-8720-000000000099',
  'eaaaaaaa-0000-4000-8000-000000000001',
  'eaaaaaaa-7101-4710-8710-000000000001',
  99, '待刪除候選', '其他', 'other', 'proposed', 'official'
);

select results_eq(
  $$
    delete from public.menu_items
    where id = 'eaaaaaaa-7201-4720-8720-000000000099'
    returning display_name
  $$,
  $$ values ('待刪除候選'::text) $$,
  'an uncited menu item DELETE still returns the removed row'
);

select is(
  (
    select count(*)::integer
    from public.menu_items
    where id = 'eaaaaaaa-7201-4720-8720-000000000099'
  ),
  0,
  'an uncited menu item is actually removed after DELETE'
);

-- 65
select results_eq(
  $$
    with first_call as materialized (
      select public.save_meal_evidence_chain(payload) as result
      from evidence_chain_rpc_payload
    ), retry_call as materialized (
      select public.save_meal_evidence_chain(payload) as result
      from evidence_chain_rpc_payload
      cross join first_call
    )
    select first_call.result = retry_call.result
      and first_call.result ->> 'menu_version_id'
        = 'eaaaaaaa-7101-4710-8710-000000000001'
      and first_call.result ->> 'meal_record_id'
        = 'eaaaaaaa-7250-4725-8725-000000000001'
      and first_call.result -> 'menu_item_ids' = pg_catalog.jsonb_build_array(
        'eaaaaaaa-7201-4720-8720-000000000001'::uuid,
        'eaaaaaaa-7201-4720-8720-000000000002'::uuid
      )
    from first_call cross join retry_call
  $$,
  $$ values (true) $$,
  'a retry returns the same canonical aggregate identifiers'
);

select results_eq(
  $$
    select display_name, normalized_name, standard_portion_g,
      preparation_method, status
    from public.menu_items
    where menu_version_id = 'eaaaaaaa-7101-4710-8710-000000000001'
    order by sort_order
  $$,
  $$
    values
      ('白飯'::text, '白飯'::text, 120, null::text, 'confirmed'::text),
      ('青花菜'::text, '青花菜'::text, 70, '清炒'::text, 'confirmed'::text)
  $$,
  'aggregate RPC persists corrected canonical menu fields, not only canonical ids'
);

-- 66
select results_eq(
  $$
    select
      (
        select count(*)::integer
        from public.meal_batches as matching_batch
        where matching_batch.school_id = batch.school_id
          and matching_batch.client_case_id = batch.client_case_id
      ),
      meal.measurement_method,
      meal.created_by,
      meal.created_at,
      meal.updated_at
    from public.meal_records as meal
    join public.meal_batches as batch
      on batch.school_id = meal.school_id
     and batch.meal_record_id = meal.id
    where meal.school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      and meal.id = 'eaaaaaaa-7250-4725-8725-000000000001'
      and batch.id = 'eaaaaaaa-7300-4730-8730-000000000001'
  $$,
  $$
    values (
      1,
      'sample-extrapolation'::text,
      'e1111111-1111-4111-8111-111111111111'::uuid,
      timestamptz '2026-09-04 07:30:00+08',
      timestamptz '2026-09-04 15:30:00+08'
    )
  $$,
  'an exact retry preserves one linked sample summary and its audit timestamps'
);

-- 67
select is(
  (
    select audit_payload ->> 'id'
    from public.meal_batches
    where school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      and client_case_id = 'eaaaaaaa-7000-4700-8700-000000000001'
  ),
  'atomic-evidence-case',
  'the atomic save retains an exact versioned audit aggregate'
);

-- 68
select results_eq(
  $$
    select relation, row_count
    from (
      select 'contexts'::text as relation, count(*) as row_count
      from public.meal_contexts
      where meal_batch_id = 'eaaaaaaa-7300-4730-8730-000000000001'
      union all
      select 'feedback'::text, count(*)
      from public.feedback_events
      where meal_batch_id = 'eaaaaaaa-7300-4730-8730-000000000001'
      union all
      select 'human_decision'::text, count(*)
      from public.human_decisions
      where meal_batch_id = 'eaaaaaaa-7300-4730-8730-000000000001'
      union all
      select 'measurements'::text, count(*)
      from public.waste_measurements
      where meal_batch_id = 'eaaaaaaa-7300-4730-8730-000000000001'
    ) as child_counts
    order by relation
  $$,
  $$
    values
      ('contexts'::text, 1::bigint),
      ('feedback'::text, 1::bigint),
      ('human_decision'::text, 1::bigint),
      ('measurements'::text, 1::bigint)
  $$,
  'a retry replaces each batch-owned child collection without duplicates'
);

-- 69
select throws_like(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(payload, '{audit_payload,teacherContext,deliveryDelayMinutes}', '99'::jsonb),
            '{meal_record,notes}',
            '"MUST ROLLBACK"'::jsonb
          ),
          '{contexts,0,context_value,delivery_delay_minutes}',
          '99'::jsonb
        ),
        '{measurements,0,net_weight_g}',
        '-1'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '%violates check constraint%',
  'an invalid late child rejects the entire aggregate replacement'
);

-- 70
select results_eq(
  $$
    select
      (context.context_value ->> 'delivery_delay_minutes')::integer,
      measurement.net_weight_g,
      meal.notes,
      meal.leftover_g
    from public.meal_contexts as context
    cross join public.waste_measurements as measurement
    cross join public.meal_records as meal
    where context.id = 'eaaaaaaa-7400-4740-8740-000000000001'
      and measurement.id = 'eaaaaaaa-7600-4760-8760-000000000001'
      and meal.id = 'eaaaaaaa-7250-4725-8725-000000000001'
  $$,
  $$ values (5, 120, 'Atomic evidence summary'::text, 420) $$,
  'a failed replacement rolls the meal summary and earlier child writes back'
);

-- 71
select lives_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(payload, '{audit_payload,teacherContext,deliveryDelayMinutes}', '8'::jsonb),
                '{meal_record,notes}',
                '"Updated summary after correction"'::jsonb
              ),
              '{meal_record,leftover_g}',
              '430'::jsonb
            ),
            '{contexts,0,context_value,delivery_delay_minutes}',
            '8'::jsonb
          ),
          '{measurements,0,net_weight_g}',
          '140'::jsonb
        ),
        '{measurements,0,gross_weight_g}',
        '190'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  'a changed payload with stable aggregate IDs atomically replaces the case'
);

-- 72
select results_eq(
  $$
    select
      (context.context_value ->> 'delivery_delay_minutes')::integer,
      measurement.net_weight_g,
      meal.notes,
      meal.leftover_g,
      (select count(*)::integer from public.meal_contexts
        where meal_batch_id = 'eaaaaaaa-7300-4730-8730-000000000001'),
      (select count(*)::integer from public.waste_measurements
        where meal_batch_id = 'eaaaaaaa-7300-4730-8730-000000000001')
    from public.meal_contexts as context
    cross join public.waste_measurements as measurement
    cross join public.meal_records as meal
    where context.id = 'eaaaaaaa-7400-4740-8740-000000000001'
      and measurement.id = 'eaaaaaaa-7600-4760-8760-000000000001'
      and meal.id = 'eaaaaaaa-7250-4725-8725-000000000001'
  $$,
  $$
    values (
      8,
      140,
      'Updated summary after correction'::text,
      430,
      1,
      1
    )
  $$,
  'a successful replacement updates its summary and retains one child per stable ID'
);

-- 73
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        payload,
        '{school_id}',
        '"ebbbbbbb-0000-4000-8000-000000000002"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '42501',
  'not authorized for this school',
  'a teacher cannot save an evidence chain into another school'
);

-- 74
set local "request.jwt.claim.sub" = 'e3333333-3333-4333-8333-333333333333';
select throws_ok(
  $$
    select public.save_meal_evidence_chain(payload)
    from evidence_chain_rpc_payload
  $$,
  '42501',
  'not authorized for this school',
  'a same-school viewer cannot use the aggregate write RPC'
);

-- 75
set local "request.jwt.claim.sub" = 'e4444444-4444-4444-8444-444444444444';
select lives_ok(
  $$
    select public.save_meal_evidence_chain(payload)
    from evidence_chain_rpc_payload
  $$,
  'a same-school admin can save the evidence aggregate'
);

-- 76
reset role;
set local role anon;
select throws_like(
  $$
    select public.save_meal_evidence_chain(payload)
    from evidence_chain_rpc_payload
  $$,
  '%permission denied%',
  'anon cannot execute the evidence-chain save RPC'
);
reset role;

-- 77
select results_eq(
  $$
    select
      batch.menu_version_id,
      (
        select count(*)::integer
        from public.menu_versions as menu
        where menu.school_id = batch.school_id
          and menu.service_date = date '2026-09-04'
          and menu.meal_period = 'lunch'
          and menu.version_number = 1
      ),
      (
        select count(*)::integer
        from public.menu_versions as menu
        where menu.id = 'eaaaaaaa-7100-4710-8710-000000000001'
      )
    from public.meal_batches as batch
    where batch.school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      and batch.client_case_id = 'eaaaaaaa-7000-4700-8700-000000000001'
  $$,
  $$
    values (
      'eaaaaaaa-7101-4710-8710-000000000001'::uuid,
      1::integer,
      0::integer
    )
  $$,
  'a supplied menu UUID aliases the one canonical natural-key menu'
);

-- 78
select results_eq(
  $$
    select menu_item.sort_order, menu_item.id
    from public.menu_items as menu_item
    where menu_item.school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      and menu_item.menu_version_id = 'eaaaaaaa-7101-4710-8710-000000000001'
    order by menu_item.sort_order
  $$,
  $$
    values
      (0::smallint, 'eaaaaaaa-7201-4720-8720-000000000001'::uuid),
      (1::smallint, 'eaaaaaaa-7201-4720-8720-000000000002'::uuid)
  $$,
  'menu sort-order natural keys retain their canonical item UUIDs'
);

-- 79
select results_eq(
  $$
    select evidence_type, menu_item_id
    from (
      select 'feedback'::text as evidence_type, feedback.menu_item_id
      from public.feedback_events as feedback
      where feedback.id = 'eaaaaaaa-7500-4750-8750-000000000001'
      union all
      select 'measurement'::text, measurement.menu_item_id
      from public.waste_measurements as measurement
      where measurement.id = 'eaaaaaaa-7600-4760-8760-000000000001'
    ) as linked_evidence
    order by evidence_type
  $$,
  $$
    values
      ('feedback'::text, 'eaaaaaaa-7201-4720-8720-000000000002'::uuid),
      ('measurement'::text, 'eaaaaaaa-7201-4720-8720-000000000002'::uuid)
  $$,
  'feedback and measurements remap client item aliases to the canonical item'
);

-- 80
select has_column(
  'public',
  'human_decisions',
  'decided_by_role',
  'human decisions normalize the accountable decision-maker role'
);

-- 81
select is(
  (
    select decided_by_role
    from public.human_decisions
    where id = 'eaaaaaaa-7700-4770-8770-000000000001'
  ),
  'dietitian',
  'the aggregate RPC persists the responsibility decision-maker role'
);

-- 82
select throws_like(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, meal_batch_id,
      decision, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'responsibility_card',
      'missing-accountable-role',
      'eaaaaaaa-7300-4730-8730-000000000001',
      'pilot',
      'A responsibility card must retain who made the decision',
      'active',
      'measured'
    )
  $$,
  '%violates check constraint "human_decisions_responsibility_owner_check"%',
  'a responsibility-card decision cannot omit its accountable role'
);

-- 83
select throws_like(
  $$
    insert into public.human_decisions (
      school_id, recommendation_kind, recommendation_key, meal_batch_id,
      decision, decided_by_role, rationale, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'responsibility_card',
      'invalid-accountable-role',
      'eaaaaaaa-7300-4730-8730-000000000001',
      'pilot',
      'autonomous-ai',
      'The final decision must belong to an allowed human school role',
      'active',
      'measured'
    )
  $$,
  '%violates check constraint%',
  'an unknown or autonomous actor cannot be recorded as the human decision-maker'
);

-- 84
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(payload, '{menu_items,1,sort_order}', '0'::jsonb)
    )
    from evidence_chain_rpc_payload
  $$,
  '22023',
  'menu_items sort_order values must be unique within a payload',
  'duplicate menu sort positions are rejected before they can overwrite a canonical item'
);

-- 85
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        payload,
        '{feedback,0,menu_item_id}',
        '"eaaaaaaa-2000-4200-8200-000000000001"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '22023',
  'feedback.menu_item_id must reference a menu item in the payload',
  'a child cannot bypass the alias map to reference another menu version'
);

set local "request.jwt.claim.sub" = 'e1111111-1111-4111-8111-111111111111';
set local role authenticated;

-- 86
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        jsonb_set(
          payload,
          '{meal_record,class_id}',
          '"ebbbbbbb-0100-4100-8100-000000000002"'::jsonb
        ),
        '{meal_batch,class_id}',
        '"ebbbbbbb-0100-4100-8100-000000000002"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '23503',
  'meal_record class does not belong to the current school',
  'the aggregate RPC rejects a class belonging to another school'
);

-- 87
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        payload,
        '{meal_record,class_id}',
        '"eaaaaaaa-0100-4100-8100-000000000002"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '22023',
  'meal_record and meal_batch must reference the same class',
  'the summary and batch cannot disagree about their same-school class'
);

-- 88
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        payload,
        '{meal_record,served_on}',
        '"2026-09-05"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '22023',
  'meal_record and meal_batch must describe the same date and meal period',
  'the summary and batch cannot disagree about their service date'
);

-- 89
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        payload,
        '{meal_record,meal_period}',
        '"breakfast"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '22023',
  'meal_record and meal_batch must describe the same date and meal period',
  'the summary and batch cannot disagree about their meal period'
);

-- 90
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(payload, '{meal_record,leftover_g}', '7000'::jsonb)
    )
    from evidence_chain_rpc_payload
  $$,
  '22023',
  'meal_record leftover weight must be between zero and total supply',
  'the aggregate RPC rejects leftover weight above total supply'
);

-- 91
select results_eq(
  $$
    select
      meal.id,
      batch.meal_record_id,
      meal.class_id,
      meal.notes,
      meal.leftover_g,
      meal.created_by
    from public.meal_records as meal
    join public.meal_batches as batch
      on batch.school_id = meal.school_id
     and batch.meal_record_id = meal.id
    where batch.school_id = 'eaaaaaaa-0000-4000-8000-000000000001'
      and batch.client_case_id = 'eaaaaaaa-7000-4700-8700-000000000001'
  $$,
  $$
    values (
      'eaaaaaaa-7250-4725-8725-000000000001'::uuid,
      'eaaaaaaa-7250-4725-8725-000000000001'::uuid,
      'eaaaaaaa-0100-4100-8100-000000000001'::uuid,
      'Atomic evidence summary'::text,
      420,
      'e1111111-1111-4111-8111-111111111111'::uuid
    )
  $$,
  'rejected replacements leave the canonical summary and batch link unchanged'
);

-- 92
select throws_ok(
  $$
    select public.confirm_scan(
      jsonb_build_object(
        'school_id', 'eaaaaaaa-0000-4000-8000-000000000001',
        'client_request_id', 'eaaaaaaa-7800-4780-8780-000000000001',
        'content_sha256', repeat('c', 64),
        'meal', jsonb_build_object(
          'class_id', 'eaaaaaaa-0100-4100-8100-000000000001',
          'served_on', '2026-09-05',
          'staple', '白飯',
          'main_dish', '掃描安全測試',
          'side_dishes', jsonb_build_array('青菜'),
          'planned_people', 25,
          'actual_people', 24,
          'total_supply_g', 6500,
          'leftover_g', 420,
          'measurement_method', 'sample-extrapolation',
          'notes', 'confirm_scan must retain its stricter boundary'
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
    )
  $$,
  '22023',
  'meal leftover must come from a scale or manual meal-level measurement',
  'scan confirmation still rejects sample extrapolation as direct meal measurement'
);

-- 93
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        jsonb_set(
          payload,
          '{meal_record,id}',
          '"eaaaaaaa-7250-4725-8725-000000000099"'::jsonb
        ),
        '{meal_batch,meal_record_id}',
        '"eaaaaaaa-7250-4725-8725-000000000099"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '23505',
  'client_case_id already belongs to a different meal_record id',
  'a client case remains pinned to its original meal summary across changed retries'
);

-- 94
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            payload,
            '{menu_version,meal_period}',
            '"breakfast"'::jsonb
          ),
          '{meal_record,meal_period}',
          '"breakfast"'::jsonb
        ),
        '{meal_batch,meal_period}',
        '"breakfast"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '22023',
  'FoodLens currently supports lunch meal periods only',
  'the aggregate RPC rejects a uniformly unsupported meal period with a stable error'
);

-- 95
select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = any (
      array[
        'public.collection_events'::regclass,
        'public.destination_receipts'::regclass
      ]
    )
      and not tgisinternal
      and tgname like '%_guard_audit'
  ),
  2,
  'collection and destination tables both enforce database audit guards'
);

-- 96
select throws_ok(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, accepted_weight_g, received_at, status,
      verified_by, verified_at, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-5000-4500-8500-000000000001',
      'SPOOFED-VERIFIER',
      'Evidence Facility',
      'composting',
      1000,
      now(),
      'verified',
      'e3333333-3333-4333-8333-333333333333',
      now(),
      'official'
    )
  $$,
  '42501',
  'destination receipt verifier must be the authenticated user',
  'a teacher cannot attribute verification to another account'
);

-- 97
select ok(
  (
    select verified_by = 'e1111111-1111-4111-8111-111111111111'::uuid
      and verified_at > timestamptz '2026-09-05 00:00:00+00'
    from public.destination_receipts
    where receipt_reference = 'VERIFIED-ACTUAL-ROUTE'
  ),
  'verified destination evidence keeps the authenticated actor and a database-owned timestamp'
);

-- 98
select throws_ok(
  $$
    update public.destination_receipts
    set facility_name = 'Rewritten Facility'
    where receipt_reference = 'VERIFIED-ACTUAL-ROUTE'
  $$,
  '55000',
  'verified or rejected destination evidence is immutable',
  'verified destination evidence cannot be rewritten'
);

-- 99
select throws_ok(
  $$
    update public.collection_events
    set planned_destination_name = 'Rewritten Destination'
    where id = 'eaaaaaaa-5000-4500-8500-000000000001'
  $$,
  '55000',
  'completed or cancelled collection evidence is immutable',
  'completed collection evidence cannot be rewritten'
);

-- 100
with deleted as (
  delete from public.destination_receipts
  where receipt_reference = 'VERIFIED-ACTUAL-ROUTE'
  returning 1
)
select is(
  (select count(*)::integer from deleted),
  0,
  'authenticated users cannot delete a verified destination receipt'
);

-- 101
with deleted as (
  delete from public.collection_events
  where id = 'eaaaaaaa-5000-4500-8500-000000000001'
  returning 1
)
select is(
  (select count(*)::integer from deleted),
  0,
  'authenticated users cannot delete completed collection evidence'
);

-- 102
with deleted as (
  delete from public.destination_receipts
  where receipt_reference = 'SUBMITTED-NOT-VERIFIED'
  returning 1
)
select is(
  (select count(*)::integer from deleted),
  1,
  'a teacher can remove a submitted receipt draft before verification'
);

insert into public.collection_events (
  id, school_id, meal_batch_id, status, scheduled_at, weight_state,
  planned_destination_name, planned_treatment_method, waste_sources, provenance
) values (
  'eaaaaaaa-5000-4500-8500-000000000099',
  'eaaaaaaa-0000-4000-8000-000000000001',
  'eaaaaaaa-4000-4400-8400-000000000001',
  'scheduled',
  now(),
  'standard_drained',
  'Draft destination',
  'unknown',
  array['inedible'],
  'official'
);

-- 103
with deleted as (
  delete from public.collection_events
  where id = 'eaaaaaaa-5000-4500-8500-000000000099'
  returning 1
)
select is(
  (select count(*)::integer from deleted),
  1,
  'a teacher can remove a scheduled collection draft before handoff'
);

-- 104
select results_eq(
  $$
    select delivered_weight_g, notified_people
    from public.meal_batches
    where id = 'eaaaaaaa-4000-4400-8400-000000000043'
  $$,
  $$ values (null::integer, null::integer) $$,
  'closing a meal does not manufacture unobserved delivery or notification facts'
);

-- 105
select col_not_null(
  'public',
  'collection_events',
  'waste_sources',
  'every collection event must identify its exact waste streams'
);

-- 106
select throws_like(
  $$
    insert into public.collection_events (
      school_id, meal_batch_id, status, scheduled_at, weight_state,
      planned_destination_name, planned_treatment_method, waste_sources,
      provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'scheduled',
      now(),
      'standard_drained',
      'Empty source route',
      'other',
      array[]::text[],
      'official'
    )
  $$,
  '%violates check constraint%',
  'an empty waste-source allocation is rejected'
);

-- 107
select throws_ok(
  $$
    insert into public.collection_events (
      school_id, meal_batch_id, status, scheduled_at, weight_state,
      planned_destination_name, planned_treatment_method, waste_sources,
      provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'scheduled',
      now(),
      'standard_drained',
      'Overlapping route',
      'other',
      array['plate_edible', 'inedible'],
      'official'
    )
  $$,
  '23505',
  'waste source already belongs to another active collection event',
  'a partly overlapping source set cannot be assigned to two active routes'
);

-- 108
select lives_ok(
  $$
    insert into public.collection_events (
      id, school_id, meal_batch_id, status, scheduled_at, weight_state,
      planned_destination_name, planned_treatment_method, waste_sources,
      provenance
    ) values (
      'eaaaaaaa-5000-4500-8500-000000000097',
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'cancelled',
      now(),
      'standard_drained',
      'Cancelled liquid route',
      'other',
      array['liquid'],
      'official'
    )
  $$,
  'a cancelled event remains as audit history without reserving its source'
);

-- 109
select lives_ok(
  $$
    insert into public.collection_events (
      id, school_id, meal_batch_id, status, scheduled_at, weight_state,
      planned_destination_name, planned_treatment_method, waste_sources,
      provenance
    ) values (
      'eaaaaaaa-5000-4500-8500-000000000096',
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'scheduled',
      now(),
      'standard_drained',
      'Replacement liquid route',
      'other',
      array['liquid'],
      'official'
    )
  $$,
  'an active route can reuse a source after the previous event was cancelled'
);

-- 110
select throws_like(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, accepted_weight_g, received_at, status,
      verified_by, verified_at, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-5000-4500-8500-000000000001',
      'VERIFIED-WITHOUT-DOCUMENT',
      'Evidence Facility',
      'composting',
      1000,
      now(),
      'verified',
      'e1111111-1111-4111-8111-111111111111',
      now(),
      'official'
    )
  $$,
  '%destination_receipts_official_document_check%',
  'formal verification requires a retained facility-document fingerprint'
);

-- 111
select throws_like(
  $$
    insert into public.collection_events (
      school_id, meal_batch_id, status, scheduled_at, weight_state,
      planned_destination_name, planned_treatment_method, waste_sources,
      provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000043',
      'scheduled',
      now(),
      'standard_drained',
      'Null source route',
      'other',
      array['liquid', null]::text[],
      'official'
    )
  $$,
  '%violates check constraint%',
  'a waste-source array cannot hide a null element'
);

-- 112
select ok(
  not has_table_privilege(
    'authenticated',
    'public.meal_batches',
    'delete'
  ),
  'authenticated sessions cannot delete meal batches'
);

-- 113
select results_eq(
  $$
    select conname, confdeltype
    from pg_constraint
    where conname in (
      'collection_events_school_batch_fkey',
      'destination_receipts_school_collection_fkey'
    )
    order by conname
  $$,
  $$
    values
      ('collection_events_school_batch_fkey'::name, 'r'::"char"),
      ('destination_receipts_school_collection_fkey'::name, 'r'::"char")
  $$,
  'final trace foreign keys use RESTRICT instead of cascading evidence deletion'
);

-- 114
select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = any (
      array[
        'public.meal_batches'::regclass,
        'public.meal_contexts'::regclass,
        'public.feedback_events'::regclass,
        'public.waste_measurements'::regclass,
        'public.human_decisions'::regclass
      ]
    )
      and not tgisinternal
      and tgname like '%_guard_trace_finality'
  ),
  5,
  'the batch and all four upstream child tables enforce final-trace guards'
);

-- 115
select has_trigger(
  'public',
  'destination_receipts',
  'destination_receipts_guard_collection_lifecycle',
  'destination receipts enforce their parent collection lifecycle'
);

-- 116
select ok(
  not has_function_privilege(
    'authenticated',
    'private.guard_final_trace_meal_batch()',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'private.guard_final_trace_upstream_child()',
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.guard_destination_receipt_lifecycle()',
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.guard_final_collection_delete()',
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.guard_final_receipt_delete()',
      'execute'
    ),
  'browser sessions cannot call internal finality trigger functions directly'
);

-- 117
select throws_ok(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, received_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-5000-4500-8500-000000000096',
      'RECEIPT-FOR-SCHEDULED-PICKUP',
      'Premature Facility',
      'unknown',
      now(),
      'submitted',
      'official'
    )
  $$,
  '23514',
  'destination receipt requires a collected event',
  'a receipt cannot attach to a merely scheduled collection'
);

-- 118
select throws_ok(
  $$
    insert into public.destination_receipts (
      school_id, collection_event_id, receipt_reference, facility_name,
      actual_treatment_method, received_at, status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-5000-4500-8500-000000000001',
      'RECEIPT-BEFORE-PICKUP',
      'Time-travel Facility',
      'unknown',
      timestamptz '2026-09-03 13:29:00+08',
      'submitted',
      'official'
    )
  $$,
  '23514',
  'destination receipt cannot predate collection',
  'received_at cannot predate the parent collected_at timestamp'
);

-- 119
select throws_ok(
  $$
    update public.meal_batches
    set audit_payload = '{"rewritten":true}'::jsonb
    where id = 'eaaaaaaa-4000-4400-8400-000000000001'
  $$,
  '55000',
  'meal batch with final trace is immutable',
  'a final trace freezes its meal-batch audit aggregate'
);

-- 120
select throws_ok(
  $$
    update public.meal_contexts
    set context_value = '{"actual_people":1}'::jsonb
    where meal_batch_id = 'eaaaaaaa-4000-4400-8400-000000000001'
  $$,
  '55000',
  'upstream evidence for a final trace is immutable',
  'a final trace freezes contextual evidence'
);

-- 121
select throws_ok(
  $$
    update public.feedback_events
    set note = note || ' rewritten'
    where meal_batch_id = 'eaaaaaaa-4000-4400-8400-000000000001'
  $$,
  '55000',
  'upstream evidence for a final trace is immutable',
  'a final trace freezes aggregated feedback evidence'
);

-- 122
select throws_ok(
  $$
    update public.waste_measurements
    set note = note || ' rewritten'
    where meal_batch_id = 'eaaaaaaa-4000-4400-8400-000000000001'
  $$,
  '55000',
  'upstream evidence for a final trace is immutable',
  'a final trace freezes waste measurements'
);

-- 123
select throws_ok(
  $$
    update public.human_decisions
    set rationale = rationale || ' rewritten'
    where meal_batch_id = 'eaaaaaaa-4000-4400-8400-000000000001'
  $$,
  '55000',
  'upstream evidence for a final trace is immutable',
  'a final trace freezes recorded human decisions'
);

-- 124
select throws_ok(
  $$
    insert into public.meal_contexts (
      school_id, meal_batch_id, context_type, context_value, observed_at,
      status, provenance
    ) values (
      'eaaaaaaa-0000-4000-8000-000000000001',
      'eaaaaaaa-4000-4400-8400-000000000001',
      'operational',
      '{"late_edit":true}'::jsonb,
      now(),
      'recorded',
      'official'
    )
  $$,
  '55000',
  'upstream evidence for a final trace is immutable',
  'new upstream evidence cannot be appended after trace finalization'
);

reset role;

-- 125
select throws_ok(
  $$
    delete from public.destination_receipts
    where receipt_reference = 'VERIFIED-ACTUAL-ROUTE'
  $$,
  '55000',
  'verified or rejected destination evidence is immutable',
  'the database owner cannot delete a final destination receipt'
);

-- 126
select throws_ok(
  $$
    delete from public.collection_events
    where id = 'eaaaaaaa-5000-4500-8500-000000000001'
  $$,
  '55000',
  'completed or cancelled collection evidence is immutable',
  'the database owner cannot delete a completed collection event'
);

-- 127
select throws_ok(
  $$
    delete from public.meal_batches
    where id = 'eaaaaaaa-4000-4400-8400-000000000001'
  $$,
  '55000',
  'meal batch with final trace is immutable',
  'the database owner cannot accidentally cascade-delete a final trace'
);

-- 128
select results_eq(
  $$
    select
      (select count(*)::integer from public.meal_batches
       where id = 'eaaaaaaa-4000-4400-8400-000000000001'),
      (select count(*)::integer from public.collection_events
       where meal_batch_id = 'eaaaaaaa-4000-4400-8400-000000000001'),
      (select count(*)::integer from public.destination_receipts
       where collection_event_id = 'eaaaaaaa-5000-4500-8500-000000000001')
  $$,
  $$ values (1, 3, 1) $$,
  'failed parent deletion leaves the complete batch, pickup, and receipt chain intact'
);

set local "request.jwt.claim.sub" = 'e1111111-1111-4111-8111-111111111111';
set local role authenticated;

insert into public.collection_events (
  id, school_id, meal_batch_id, status, scheduled_at, collected_at,
  hauler_name, manifest_reference, net_collected_weight_g, weight_state,
  planned_destination_name, planned_treatment_method, waste_sources,
  provenance
) values (
  'eaaaaaaa-5000-4500-8500-000000000095',
  'eaaaaaaa-0000-4000-8000-000000000001',
  'eaaaaaaa-7300-4730-8730-000000000001',
  'collected',
  timestamptz '2026-09-04 12:30:00+08',
  timestamptz '2026-09-04 13:30:00+08',
  'RPC Evidence Hauler',
  'RPC-MANIFEST-A',
  120,
  'standard_drained',
  'RPC Planned Facility',
  'composting',
  array['plate_edible'],
  'official'
);

-- 129
select lives_ok(
  $$
    select public.save_meal_evidence_chain(payload)
    from evidence_chain_rpc_payload
  $$,
  'an exact idempotent RPC retry remains a read-only success after finalization'
);

-- 130
select throws_ok(
  $$
    select public.save_meal_evidence_chain(
      jsonb_set(
        payload,
        '{audit_payload,id}',
        '"attempted-rewrite"'::jsonb
      )
    )
    from evidence_chain_rpc_payload
  $$,
  '55000',
  'meal batch with final trace is immutable',
  'the aggregate save RPC cannot rewrite an already-final trace'
);

reset role;

-- v2 uses the real aggregate shape and canonical projections, not a sparse
-- schemaVersion/id placeholder. All mutations stay in this rollback fixture.
create function pg_temp.feedback_payload(patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$
declare p jsonb; a jsonb; t jsonb; reasons jsonb; f jsonb := '[]'; e record; c text;
begin
  select replace(payload::text, 'eaaaaaaa-7', 'eaaaaaaa-8')::jsonb into p from evidence_chain_rpc_payload;
  a := (p -> 'audit_payload') || patch; t := a -> 'teacherContext'; reasons := a -> 'reasonCounts';
  p := jsonb_set(p, '{audit_payload}', a);
  p := jsonb_set(p, '{menu_version,service_date}', '"2026-09-07"');
  p := jsonb_set(p, '{meal_record,served_on}', '"2026-09-07"');
  p := jsonb_set(p, '{meal_batch,service_date}', '"2026-09-07"');
  p := jsonb_set(p, '{contexts,0,context_value}', jsonb_build_object(
    'feedback_schema_version',a->'feedbackSchemaVersion','reason_collection_status',a->'reasonCollectionStatus',
    'reason_counts',reasons,'delivery_status',t->'deliveryStatus','temperature_status',t->'temperatureStatus',
    'delivery_delay_minutes',t->'deliveryDelayMinutes','temperature_concern',t->'temperatureConcern','note',t->'note'));
  p := jsonb_set(p, '{contexts,0,status}', to_jsonb(case when a->>'reasonCollectionStatus'='collected' and t->>'deliveryStatus'='recorded' and t->>'temperatureStatus'='recorded' then 'confirmed'::text else 'recorded'::text end));
  if a->>'reasonCollectionStatus'='collected' then
    for e in select key,value from jsonb_each(reasons) where value <> 'null'::jsonb and (value::text)::numeric > 0 loop
      c := e.key;
      f := f || jsonb_build_array(jsonb_build_object('id','eaaaaaaa-8500-4750-8750-000000000001','actor_role','student','reason_code',c,'response_count',e.value,'status','reviewed','provenance','measured'));
    end loop;
  end if;
  return jsonb_set(p, '{feedback}', f);
end; $$;
create function pg_temp.reason_values(v integer) returns jsonb language sql as $$
  select jsonb_build_object('portion',v,'taste',v,'texture',v,'temperature',v,'time',v,'other',v);
$$;
create function pg_temp.teacher_values(ds text,d jsonb,ts text,t jsonb) returns jsonb language sql as $$
  select jsonb_build_object('deliveryStatus',ds,'deliveryDelayMinutes',d,'temperatureStatus',ts,'temperatureConcern',t,'note','');
$$;

set local "request.jwt.claim.sub" = 'e1111111-1111-4111-8111-111111111111';
set local role authenticated;
select is(public.foodlens_feedback_contract_version(), 2, 'cloud gate advertises feedback contract v2');
select ok(not has_function_privilege('anon','public.foodlens_feedback_contract_version()','execute'), 'anonymous clients cannot call the readiness gate');
select lives_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('reasonCollectionStatus','not-collected','reasonCounts',pg_temp.reason_values(null),'teacherContext',pg_temp.teacher_values('not-collected','null','not-collected','null'))))$$, 'uncollected feedback and unobserved context save without invented zeros');
select is((select audit_payload #> '{reasonCounts,portion}' from public.meal_batches where id='eaaaaaaa-8300-4730-8730-000000000001'), 'null'::jsonb, 'unknown reason remains JSON null in audit');
select is((select count(*)::integer from public.feedback_events where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'),0,'uncollected feedback produces no vote rows');
select lives_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('reasonCounts',pg_temp.reason_values(0))))$$,'collected zero responses are a valid explicit outcome');
select is((select context_value->>'reason_collection_status' from public.meal_contexts where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'),'collected','zero response collection remains different from uncollected');
select lives_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('teacherContext',pg_temp.teacher_values('recorded','0','recorded','false'))))$$,'explicit observed zero delay and no temperature concern save');
select is((select context_value #> '{delivery_delay_minutes}' from public.meal_contexts where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'),'0'::jsonb,'observed zero is preserved separately from null');
select lives_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('reasonCollectionStatus','legacy-unverified','teacherContext',pg_temp.teacher_values('legacy-unverified','5','legacy-unverified','true'))))$$,'legacy values retain unverified status instead of being promoted');
select is((select count(*)::integer from public.feedback_events where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'),0,'legacy positive counts do not create collected vote rows');
select is((select audit_payload #> '{teacherContext,temperatureConcern}' from public.meal_batches where id='eaaaaaaa-8300-4730-8730-000000000001'),'true'::jsonb,'legacy raw observation survives for later human review');
select throws_ok($$select public.save_meal_evidence_chain(jsonb_set(pg_temp.feedback_payload(),'{audit_payload,feedbackSchemaVersion}','1'))$$,'22023','invalid feedback v2 audit contract','old writers cannot submit new edits to the v2 backend');
select throws_ok($$select public.save_meal_evidence_chain(jsonb_set(pg_temp.feedback_payload(),'{audit_payload,reasonCollectionStatus}','null'))$$,'22023','invalid feedback v2 audit contract','SQL does not infer a missing collection status');
select throws_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('reasonCollectionStatus','not-collected')))$$,'22023','reason collection status contradicts counts','uncollected status cannot retain known counts');
select throws_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('reasonCounts',pg_temp.reason_values(null))))$$,'22023','reason collection status contradicts counts','collected status requires every reason including zero');
select throws_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('reasonCounts',jsonb_set(pg_temp.reason_values(0),'{texture}','-1'))))$$,'22023','invalid anonymous reason count','negative reason counts are rejected');
select throws_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('reasonCounts',jsonb_set(pg_temp.reason_values(0),'{texture}','25'))))$$,'22023','anonymous reason total exceeds actual diners','anonymous count cannot exceed attendance');
select throws_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('teacherContext',pg_temp.teacher_values('recorded','null','recorded','false'))))$$,'22023','teacher observation status contradicts value','recorded delay cannot be unknown');
select throws_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('teacherContext',pg_temp.teacher_values('not-collected','0','recorded','false'))))$$,'22023','teacher observation status contradicts value','unobserved delay cannot be zero');
select throws_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload(jsonb_build_object('teacherContext',pg_temp.teacher_values('recorded','0','recorded','"false"'))))$$,'22023','temperature concern must be boolean or null','string false cannot masquerade as an observation');
select throws_ok($$select public.save_meal_evidence_chain(jsonb_set(pg_temp.feedback_payload(),'{contexts,0,context_value,delivery_delay_minutes}','88'))$$,'22023','operational projection does not match feedback audit','context projection must match the raw audit');
select throws_ok($$select public.save_meal_evidence_chain(jsonb_set(pg_temp.feedback_payload(),'{feedback,0,response_count}','13'))$$,'22023','normalized feedback does not match collection status and audit counts','vote projection must match collected count');
select throws_ok($$select public.save_meal_evidence_chain(jsonb_set(pg_temp.feedback_payload(),'{feedback,0,response_count}','null'))$$,'22023','invalid normalized anonymous feedback row','RPC no longer manufactures one vote from missing count');
select throws_ok($$do $tamper$ begin update public.meal_batches set audit_payload=audit_payload-'feedbackSchemaVersion' where id='eaaaaaaa-8300-4730-8730-000000000001'; set constraints all immediate; end $tamper$;$$,'22023','feedback v2 audit cannot be downgraded','direct table writes cannot remove the v2 evidence boundary');
select throws_ok($$do $tamper$ begin insert into public.feedback_events(school_id,meal_batch_id,actor_role,reason_code,response_count,status,provenance) values('eaaaaaaa-0000-4000-8000-000000000001','eaaaaaaa-8300-4730-8730-000000000001','student','taste',1,'reviewed','measured'); set constraints all immediate; end $tamper$;$$,'22023','normalized feedback does not match collection status and audit counts','direct Data API insertion cannot invent collected votes for legacy data');
select throws_ok($$do $tamper$ begin update public.meal_contexts set context_value=jsonb_set(context_value,'{delivery_delay_minutes}','99') where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'; set constraints all immediate; end $tamper$;$$,'22023','operational projection does not match feedback audit','direct Data API context tampering is rejected at transaction boundary');
select is((select count(*)::integer from public.feedback_events where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'),0,'failed projection tampering rolls back all inserted votes');
select lives_ok($$select public.save_meal_evidence_chain(pg_temp.feedback_payload())$$,'explicit collected values remain writable after rejected edits');
select is(public.save_meal_evidence_chain(pg_temp.feedback_payload()),public.save_meal_evidence_chain(pg_temp.feedback_payload()),'identical v2 retries keep canonical IDs without duplication');
select throws_ok($$do $tamper$ begin update public.feedback_events set response_count=13 where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'; set constraints all immediate; end $tamper$;$$,'22023','normalized feedback does not match collection status and audit counts','direct vote UPDATE cannot diverge from the collected audit');
select throws_ok($$do $tamper$ begin delete from public.feedback_events where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'; set constraints all immediate; end $tamper$;$$,'22023','normalized feedback does not match collection status and audit counts','direct vote DELETE cannot erase collected evidence');
select throws_ok($$do $tamper$ begin delete from public.meal_contexts where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'; set constraints all immediate; end $tamper$;$$,'22023','feedback v2 requires one operational context','direct context DELETE cannot erase observation status');
select throws_ok($$do $tamper$ begin update public.meal_batches set audit_payload=jsonb_set(audit_payload,'{reasonCounts,texture}','13') where id='eaaaaaaa-8300-4730-8730-000000000001'; set constraints all immediate; end $tamper$;$$,'22023','operational projection does not match feedback audit','direct audit UPDATE must remain consistent with normalized projections');
select throws_like($$update public.feedback_events set school_id='ebbbbbbb-0000-4000-8000-000000000002' where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'$$,'%violates row-level security policy%','v2 vote UPDATE cannot reassign evidence to another school');
select throws_like($$update public.meal_contexts set school_id='ebbbbbbb-0000-4000-8000-000000000002' where meal_batch_id='eaaaaaaa-8300-4730-8730-000000000001'$$,'%violates row-level security policy%','v2 context UPDATE cannot reassign evidence to another school');
select throws_like($$insert into public.feedback_events(school_id,meal_batch_id,actor_role,reason_code,response_count,status,provenance) values('eaaaaaaa-0000-4000-8000-000000000001','ebbbbbbb-4000-4400-8400-000000000002','student','taste',1,'reviewed','measured')$$,'%violates foreign key constraint%','feedback school and batch tenant must agree even for direct inserts');
reset role;

set constraints all immediate;
select * from finish();
rollback;
