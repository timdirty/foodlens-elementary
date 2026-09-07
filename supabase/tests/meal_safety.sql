begin;
set local search_path = public, extensions;
select plan(93);

insert into auth.users(id,email,aud,role,email_confirmed_at) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','safety-a@example.test','authenticated','authenticated',now()),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','safety-b@example.test','authenticated','authenticated',now()),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','safety-viewer@example.test','authenticated','authenticated',now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','safety-admin@example.test','authenticated','authenticated',now());
insert into public.schools(id,name) values
('aaaaaaaa-0000-4000-8000-000000000001','safety A'),('bbbbbbbb-0000-4000-8000-000000000002','safety B');
insert into public.memberships(school_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','teacher'),
('bbbbbbbb-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','teacher'),
('aaaaaaaa-0000-4000-8000-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc','viewer'),
('aaaaaaaa-0000-4000-8000-000000000001','dddddddd-dddd-4ddd-8ddd-dddddddddddd','admin');
insert into public.classes(id,school_id,name,grade) values
('aaaaaaaa-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000001','五甲',5),
('aaaaaaaa-1111-4111-8111-111111111112','aaaaaaaa-0000-4000-8000-000000000001','五乙',5),
('bbbbbbbb-2222-4222-8222-222222222222','bbbbbbbb-0000-4000-8000-000000000002','五甲',5);
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.meal_records(id,school_id,class_id,served_on,staple,main_dish,menu_signature,planned_people,actual_people,total_supply_g,leftover_g,measurement_method,source)
values('aaaaaaaa-3000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-1111-4111-8111-111111111111','2026-09-01','rice','tofu','rice|tofu',20,20,10000,2000,'scale','manual'),
('bbbbbbbb-3000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002','bbbbbbbb-2222-4222-8222-222222222222','2026-09-01','rice','tofu','rice|tofu',20,20,10000,2000,'scale','import');

create function pg_temp.safety_payload(rev integer default 1) returns jsonb language sql as $$
select jsonb_build_object(
'schemaVersion',1,'id',concat('aaaaaaaa-1000-4000-8000-',lpad(rev::text,12,'0')),
'mealRecordId','aaaaaaaa-3000-4000-8000-000000000001','revision',rev,
'previousObservationId',case when rev=1 then null else concat('aaaaaaaa-1000-4000-8000-',lpad((rev-1)::text,12,'0')) end,
'provenance','school-record',
'mealSnapshot',jsonb_build_object('classId','aaaaaaaa-1111-4111-8111-111111111111','servedOn','2026-09-01','mealPeriod','lunch','actualPeople',20,'menuSignature','rice|tofu'),
'sourceTitle',case when rev=1 then '' else '匿名單餐原始量測表' end,
'sourceReference',case when rev=1 then '' else '表單 A 20260901' end,
'recordedAt','2026-09-01T04:00:00Z','revisionReason',case when rev=1 then '' else '補記已核對觀察' end,
'shortage',case when rev=1 then '{"status":"not-collected","eventCount":null,"observedDiners":null}'::jsonb else '{"status":"recorded","eventCount":0,"observedDiners":20}'::jsonb end,
'refill',case when rev=1 then '{"status":"not-collected","eventCount":null,"observedDiners":null}'::jsonb else '{"status":"recorded","eventCount":20000,"observedDiners":20}'::jsonb end,
'satisfaction',case when rev=1 then '{"status":"not-collected","invitedDiners":null,"ratings":null}'::jsonb else '{"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,0]}'::jsonb end);
$$;
set local role authenticated;
select ok((select relrowsecurity from pg_class where oid='public.meal_safety_observations'::regclass),'safety observations enable RLS');

select is(has_table_privilege('anon','public.meal_safety_observations','SELECT'),false,'anon SELECT privilege is explicit');

select is(has_table_privilege('anon','public.meal_safety_observations','INSERT'),false,'anon INSERT privilege is explicit');

select is(has_table_privilege('anon','public.meal_safety_observations','UPDATE'),false,'anon UPDATE privilege is explicit');

select is(has_table_privilege('anon','public.meal_safety_observations','DELETE'),false,'anon DELETE privilege is explicit');

select is(has_table_privilege('authenticated','public.meal_safety_observations','SELECT'),true,'authenticated SELECT privilege is explicit');

select is(has_table_privilege('authenticated','public.meal_safety_observations','INSERT'),true,'authenticated INSERT privilege is explicit');

select is(has_table_privilege('authenticated','public.meal_safety_observations','UPDATE'),false,'authenticated UPDATE privilege is explicit');

select is(has_table_privilege('authenticated','public.meal_safety_observations','DELETE'),false,'authenticated DELETE privilege is explicit');

select is(has_table_privilege('service_role','public.meal_safety_observations','SELECT'),true,'service_role SELECT privilege is explicit');

select is(has_table_privilege('service_role','public.meal_safety_observations','INSERT'),true,'service_role INSERT privilege is explicit');

select is(has_table_privilege('service_role','public.meal_safety_observations','UPDATE'),false,'service_role UPDATE privilege is explicit');

select is(has_table_privilege('service_role','public.meal_safety_observations','DELETE'),false,'service_role DELETE privilege is explicit');

select is(public.foodlens_meal_safety_contract_version(),1,'readiness contract is v1');

select ok(not has_function_privilege('anon','public.save_meal_safety_observation(uuid,jsonb)','EXECUTE'),'anon cannot invoke save RPC');

select ok(not has_function_privilege('anon','public.foodlens_meal_safety_contract_version()','EXECUTE'),'anon cannot invoke readiness RPC');

select ok((select bool_and(not prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.save_meal_safety_observation(uuid,jsonb)'::regprocedure,'private.guard_meal_safety_observation()'::regprocedure,'private.guard_meal_safety_parent()'::regprocedure)),'RPC and triggers are invoker with empty search path');

select lives_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload())','all unknown saves with null, not manufactured zero');

select lives_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload())','same id same payload is idempotent');

select is((select count(*)::integer from public.meal_safety_observations),1,'retry creates no duplicate');

select is((select observation#>'{shortage,eventCount}' from public.meal_safety_observations),'null'::jsonb,'unknown event count preserved');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{sourceTitle}'',''"改寫資料"''::jsonb))','23505',null,'same id different payload rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{schemaVersion}'',''2''::jsonb))','22023',null,'unknown schema rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{provenance}'',''"demo"''::jsonb))','22023',null,'demo observation rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage,status}'',''"legacy-unverified"''::jsonb))','22023',null,'legacy status not synthesized rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage,eventCount}'',''0''::jsonb))','22023',null,'not collected cannot contain zero rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{refill,observedDiners}'',''0''::jsonb))','22023',null,'unknown denominator cannot contain zero rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction,ratings}'',''[0,0,0,0,0]''::jsonb))','22023',null,'unknown satisfaction cannot contain zeros rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction,invitedDiners}'',''20''::jsonb))','22023',null,'unknown satisfaction denominator rejected rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{revision}'',''1.5''::jsonb))','22023',null,'fractional revision rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{revision}'',''0''::jsonb))','22023',null,'zero revision rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{previousObservationId}'',''"aaaaaaaa-1000-4000-8000-000000000099"''::jsonb))','22023',null,'first revision predecessor rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{recordedAt}'',''"yesterday"''::jsonb))','22023',null,'non ISO observation time rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{mealSnapshot,actualPeople}'',''null''::jsonb))','22023',null,'missing attendance anchor rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{mealSnapshot,mealPeriod}'',''"dinner"''::jsonb))','22023',null,'unsupported meal period rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{mealSnapshot,menuSignature}'',''""''::jsonb))','22023',null,'empty menu signature rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload() - ''refill'')','22023',null,'missing metric is not downgraded to unknown');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload() || ''{"extra":0}''::jsonb)','22023',null,'unknown top-level field rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage}'',''{"status":"recorded","eventCount":null,"observedDiners":20}''::jsonb))','22023',null,'recorded event validation {"status":"recorded","eventCount":null,"observedDiners":20}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage}'',''{"status":"recorded","eventCount":-1,"observedDiners":20}''::jsonb))','22023',null,'recorded event validation {"status":"recorded","eventCount":-1,"observedDiners":20}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage}'',''{"status":"recorded","eventCount":0.5,"observedDiners":20}''::jsonb))','22023',null,'recorded event validation {"status":"recorded","eventCount":0.5,"observedDiners":20}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage}'',''{"status":"recorded","eventCount":20001,"observedDiners":20}''::jsonb))','22023',null,'recorded event validation {"status":"recorded","eventCount":20001,"observedDiners":20}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage}'',''{"status":"recorded","eventCount":0,"observedDiners":0}''::jsonb))','22023',null,'recorded event validation {"status":"recorded","eventCount":0,"observedDiners":0}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage}'',''{"status":"recorded","eventCount":0,"observedDiners":21}''::jsonb))','22023',null,'recorded event validation {"status":"recorded","eventCount":0,"observedDiners":21}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage}'',''{"status":"recorded","eventCount":0,"observedDiners":null}''::jsonb))','22023',null,'recorded event validation {"status":"recorded","eventCount":0,"observedDiners":null}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction}'',''{"status":"collected","invitedDiners":0,"ratings":[0,0,0,0,0]}''::jsonb))','22023',null,'satisfaction validation {"status":"collected","invitedDiners":0,"ratings":[0,0,0,0,0]}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction}'',''{"status":"collected","invitedDiners":21,"ratings":[0,0,0,0,0]}''::jsonb))','22023',null,'satisfaction validation {"status":"collected","invitedDiners":21,"ratings":[0,0,0,0,0]}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction}'',''{"status":"collected","invitedDiners":20,"ratings":null}''::jsonb))','22023',null,'satisfaction validation {"status":"collected","invitedDiners":20,"ratings":null}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction}'',''{"status":"collected","invitedDiners":20,"ratings":[0,0,0,0]}''::jsonb))','22023',null,'satisfaction validation {"status":"collected","invitedDiners":20,"ratings":[0,0,0,0]}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction}'',''{"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,0,0]}''::jsonb))','22023',null,'satisfaction validation {"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,0,0]}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction}'',''{"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,-1]}''::jsonb))','22023',null,'satisfaction validation {"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,-1]}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction}'',''{"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,0.5]}''::jsonb))','22023',null,'satisfaction validation {"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,0.5]}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{satisfaction}'',''{"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,21]}''::jsonb))','22023',null,'satisfaction validation {"status":"collected","invitedDiners":20,"ratings":[0,0,0,0,21]}');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(),''{shortage}'',''{"status":"recorded","eventCount":0,"observedDiners":20}''::jsonb))','22023',null,'collected data requires source title and reference');

select lives_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload(2))','explicit zero replies and zero events are valid collected observations');

select is((select observation#>'{satisfaction,ratings}' from public.meal_safety_observations where revision=2),'[0,0,0,0,0]'::jsonb,'zero replies persist as explicit five-bin distribution');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(2),''{id}'',''"aaaaaaaa-1000-4000-8000-000000000077"''))','40001',null,'stale revision rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(3),''{previousObservationId}'',''"aaaaaaaa-1000-4000-8000-000000000001"''))','40001',null,'wrong predecessor rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(3),''{recordedAt}'',''"2026-08-31T04:00:00Z"''))','22023',null,'revision time before predecessor rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(3),''{revisionReason}'',''""''))','22023',null,'revision requires reason');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(3),''{mealSnapshot,actualPeople}'',''19''))','22023',null,'stale attendance anchor rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(3),''{mealSnapshot,menuSignature}'',''"different menu"''))','22023',null,'stale menu anchor rejected');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', jsonb_set(pg_temp.safety_payload(3),''{mealRecordId}'',''"bbbbbbbb-3000-4000-8000-000000000001"''))','22023',null,'cross school parent cannot be connected');

select throws_ok('update public.meal_safety_observations set observation=observation','42501',null,'authenticated cannot overwrite observation');

select throws_ok('delete from public.meal_safety_observations','42501',null,'authenticated cannot delete observation');

select throws_ok('update public.meal_records set served_on=''2026-09-02'' where id=''aaaaaaaa-3000-4000-8000-000000000001''','55000',null,'parent date immutable after observation');

select throws_ok('update public.meal_records set class_id=''aaaaaaaa-1111-4111-8111-111111111112'' where id=''aaaaaaaa-3000-4000-8000-000000000001''','55000',null,'parent class immutable after observation');

select lives_ok('update public.meal_records set actual_people=19,menu_signature=''corrected menu'' where id=''aaaaaaaa-3000-4000-8000-000000000001''','attendance and menu corrections retain previous anchors');

select lives_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload())','exact retry still succeeds after parent correction');

select is((select observation#>>'{mealSnapshot,actualPeople}' from public.meal_safety_observations where revision=1),'20','historical denominator is not rewritten');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload(3))','22023',null,'old anchor cannot be appended after parent correction');

select lives_ok('update public.meal_records set actual_people=20,menu_signature=''rice|tofu'' where id=''aaaaaaaa-3000-4000-8000-000000000001''','restore fixture parent via normal correction');
reset role;

insert into public.meal_records(id,school_id,class_id,served_on,staple,main_dish,menu_signature,planned_people,actual_people,total_supply_g,leftover_g,measurement_method,source)
values('aaaaaaaa-3000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-1111-4111-8111-111111111111','2026-09-01','rice','fish','rice|fish',20,20,10000,2000,'scale','import');

set local role authenticated;

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload(3))','23505',null,'ambiguous natural meal key rejected');

reset role;
delete from public.meal_records where id='aaaaaaaa-3000-4000-8000-000000000002';
set local role authenticated;

select throws_ok('insert into public.meal_safety_observations(id,school_id,meal_record_id,revision,previous_observation_id,observation,submitted_by,received_at) values(''aaaaaaaa-1000-4000-8000-000000000003'',''aaaaaaaa-0000-4000-8000-000000000001'',''aaaaaaaa-3000-4000-8000-000000000001'',3,''aaaaaaaa-1000-4000-8000-000000000002'',jsonb_set(pg_temp.safety_payload(3),''{shortage,eventCount}'',''null''),''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'',''2000-01-01'')','22023',null,'direct insert cannot bypass metric validation');

select throws_ok('insert into public.meal_safety_observations(id,school_id,meal_record_id,revision,previous_observation_id,observation,submitted_by,received_at) values(''aaaaaaaa-1000-4000-8000-000000000003'',''aaaaaaaa-0000-4000-8000-000000000001'',''aaaaaaaa-3000-4000-8000-000000000001'',4,''aaaaaaaa-1000-4000-8000-000000000002'',pg_temp.safety_payload(3),''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'',''2000-01-01'')','22023',null,'direct insert projections must match audit');

select lives_ok('insert into public.meal_safety_observations(id,school_id,meal_record_id,revision,previous_observation_id,observation,submitted_by,received_at) values(''aaaaaaaa-1000-4000-8000-000000000003'',''aaaaaaaa-0000-4000-8000-000000000001'',''aaaaaaaa-3000-4000-8000-000000000001'',3,''aaaaaaaa-1000-4000-8000-000000000002'',pg_temp.safety_payload(3),''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'',''2000-01-01'')','direct append obeys same revision validation');

select is((select submitted_by::text from public.meal_safety_observations where revision=3),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','server forces authenticated attribution');

select ok((select received_at > '2026-01-01'::timestamptz from public.meal_safety_observations where revision=3),'server receives independent ingestion time');

reset role;

select throws_ok('update public.meal_safety_observations set observation=observation','55000',null,'owner cannot mutate append-only audit');

select throws_ok('delete from public.meal_safety_observations','55000',null,'owner cannot delete append-only audit');

set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;

select is((select count(*)::integer from public.meal_safety_observations),0,'school B cannot read school A observations');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload())','42501',null,'school B cannot invoke save for school A');

select throws_ok('insert into public.meal_safety_observations(id,school_id,meal_record_id,revision,previous_observation_id,observation,submitted_by,received_at) values(''aaaaaaaa-1000-4000-8000-000000000003'',''aaaaaaaa-0000-4000-8000-000000000001'',''aaaaaaaa-3000-4000-8000-000000000001'',3,''aaaaaaaa-1000-4000-8000-000000000002'',pg_temp.safety_payload(3),''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'',''2000-01-01'')','42501',null,'school B cannot direct insert into school A');

reset role;
set local "request.jwt.claim.sub" = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;

select is((select count(*)::integer from public.meal_safety_observations),0,'viewer cannot read safety observations');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload())','42501',null,'viewer cannot save safety observations');

reset role;
set local "request.jwt.claim.sub" = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
set local role authenticated;

select lives_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload(4))','same-school admin can append next revision');

select is((select count(*)::integer from public.meal_safety_observations),4,'all four versions retained');

select lives_ok($test$
  update public.meal_records set actual_people=19,menu_signature='corrected menu',source='import'
  where id='aaaaaaaa-3000-4000-8000-000000000001'
$test$,'CSV source change and attendance/menu corrections remain allowed');

select lives_ok($test$
  select public.save_meal_safety_observation('aaaaaaaa-0000-4000-8000-000000000001',
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.safety_payload(5),
      '{mealSnapshot,actualPeople}','19'),'{mealSnapshot,menuSignature}','"corrected menu"'),
      '{shortage,observedDiners}','19'),'{refill,observedDiners}','19'),'{satisfaction,invitedDiners}','19'))
$test$,'new revision reaffirms the corrected current anchor');

select is((select observation#>>'{mealSnapshot,actualPeople}' from public.meal_safety_observations where revision=1),
  '20','older denominator remains twenty after a new corrected revision');

select is((select observation#>>'{mealSnapshot,actualPeople}' from public.meal_safety_observations where revision=5),
  '19','latest corrected denominator is separately traceable');

reset role;
set local role anon;

select throws_ok('select * from public.meal_safety_observations','42501',null,'anon cannot read table');

select throws_ok('select public.save_meal_safety_observation(''aaaaaaaa-0000-4000-8000-000000000001'', pg_temp.safety_payload())','42501',null,'anon cannot invoke save');

reset role;
set constraints all immediate;
select * from finish();
rollback;
