-- Make the saved retention policy executable without weakening the immutable
-- AI-evidence boundary. Raw plate evidence is removed only through the
-- authenticated two-phase workflow below; class-level meal measurements stay
-- available for longitudinal research.

create table public.data_retention_runs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools on delete cascade,
  cutoff_date date not null,
  retention_days integer not null check (retention_days between 1 and 3650),
  status text not null check (status in ('prepared', 'completed', 'failed')),
  candidate_scan_count integer not null default 0 check (candidate_scan_count >= 0),
  candidate_image_count integer not null default 0 check (candidate_image_count >= 0),
  affected_meal_count integer not null default 0 check (affected_meal_count >= 0),
  deleted_scan_count integer not null default 0 check (deleted_scan_count >= 0),
  deleted_image_count integer not null default 0 check (deleted_image_count >= 0),
  started_by uuid not null default auth.uid() references auth.users,
  completed_by uuid references auth.users,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_reason text check (
    failure_reason is null or char_length(failure_reason) between 1 and 1000
  ),
  check (
    (status = 'prepared' and completed_at is null)
    or (status in ('completed', 'failed') and completed_at is not null)
  )
);

create index data_retention_runs_school_started_idx
  on public.data_retention_runs (school_id, started_at desc);
create index data_retention_runs_started_by_idx
  on public.data_retention_runs (started_by);
create index data_retention_runs_completed_by_idx
  on public.data_retention_runs (completed_by);
create unique index data_retention_runs_one_prepared_per_school
  on public.data_retention_runs (school_id)
  where status = 'prepared';

create table private.data_retention_run_items (
  run_id uuid not null references public.data_retention_runs on delete cascade,
  school_id uuid not null,
  scan_id uuid not null,
  image_path text,
  primary key (run_id, scan_id)
);

alter table public.data_retention_runs enable row level security;
alter table private.data_retention_run_items enable row level security;

create policy data_retention_runs_read on public.data_retention_runs
  for select to authenticated
  using (private.is_school_member(school_id));

revoke all on table public.data_retention_runs
from public, anon, authenticated;
grant select on table public.data_retention_runs to authenticated;

revoke all on table private.data_retention_run_items
from public, anon, authenticated, service_role;

-- Teachers should never delete meal rows through the Data API. This both
-- preserves the aggregate research series and prevents an indirect cascade
-- around the retention workflow.
drop policy if exists meals_delete on public.meal_records;
revoke delete on table public.meal_records from authenticated;

-- Browser sessions may clean up only their own upload when confirm_scan fails
-- before the object becomes evidence. Referenced evidence is removed by the
-- server-side retention route through the Storage API, never by arbitrary
-- same-school DELETE calls.
drop policy if exists plate_images_delete on storage.objects;
create policy plate_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'plate-images'
    and owner_id = (select auth.uid()::text)
    and private.is_school_member(
      ((storage.foldername(name))[1])::uuid,
      array['teacher', 'admin']
    )
    and not exists (
      select 1
      from public.plate_scans as scan
      where scan.school_id = ((storage.foldername(name))[1])::uuid
        and scan.image_path = name
    )
  );

-- Original detections remain immutable to updates. Deletion is permitted only
-- as a cascade from plate_scans, which browser roles cannot delete directly.
drop trigger if exists scan_detections_immutable on public.scan_detections;
create trigger scan_detections_immutable
  before update on public.scan_detections
  for each row execute function private.block_detection_mutation();

create function private.preview_data_retention(
  target_school uuid,
  retention_days integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutoff date;
  v_scan_count integer;
  v_image_count integer;
  v_meal_count integer;
  v_total_meals integer;
  v_oldest date;
  v_newest date;
begin
  if not private.is_school_member(
    target_school,
    array['teacher', 'admin']
  ) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if retention_days is null or retention_days not between 1 and 3650 then
    raise exception using errcode = '22023', message = 'retention days must be between 1 and 3650';
  end if;

  v_cutoff := (
    pg_catalog.timezone('Asia/Taipei', pg_catalog.statement_timestamp())::date
    - retention_days
  );

  select
    pg_catalog.count(scan.id)::integer,
    pg_catalog.count(nullif(scan.image_path, ''))::integer,
    pg_catalog.count(distinct meal.id)::integer,
    pg_catalog.min(meal.served_on),
    pg_catalog.max(meal.served_on)
  into v_scan_count, v_image_count, v_meal_count, v_oldest, v_newest
  from public.plate_scans as scan
  join public.meal_records as meal
    on meal.school_id = scan.school_id
   and meal.id = scan.meal_record_id
  where scan.school_id = target_school
    and meal.served_on < v_cutoff
    and pg_catalog.timezone('Asia/Taipei', scan.created_at)::date < v_cutoff
    and pg_catalog.timezone('Asia/Taipei', scan.reviewed_at)::date < v_cutoff
    and not exists (
      select 1
      from public.scan_detections as detection
      join public.scan_corrections as correction
        on correction.school_id = detection.school_id
       and correction.detection_id = detection.id
      where detection.school_id = scan.school_id
        and detection.scan_id = scan.id
        and pg_catalog.timezone(
          'Asia/Taipei',
          correction.corrected_at
        )::date >= v_cutoff
    );

  select pg_catalog.count(*)::integer
  into v_total_meals
  from public.meal_records
  where school_id = target_school;

  return pg_catalog.jsonb_build_object(
    'cutoff_date', v_cutoff,
    'retention_days', retention_days,
    'eligible_scan_count', v_scan_count,
    'eligible_image_count', v_image_count,
    'affected_meal_count', v_meal_count,
    'preserved_meal_count', v_total_meals,
    'oldest_eligible_date', v_oldest,
    'newest_eligible_date', v_newest,
    'generated_at', pg_catalog.statement_timestamp(),
    'batch_limit', 500
  );
end;
$$;

create function private.prepare_data_retention(
  target_school uuid,
  expected_retention_days integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_policy_days integer;
  v_cutoff date;
  v_run uuid;
  v_scan_count integer;
  v_image_count integer;
  v_meal_count integer;
  v_oldest date;
  v_newest date;
  v_paths jsonb;
begin
  if not private.is_school_member(
    target_school,
    array['admin']
  ) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select profile.data_retention_days
  into v_policy_days
  from public.project_profiles as profile
  where profile.school_id = target_school;

  if v_policy_days is null then
    raise exception using errcode = '22023', message = 'retention policy is not configured';
  end if;
  if expected_retention_days is distinct from v_policy_days then
    raise exception using errcode = '40001', message = 'retention policy changed; preview again';
  end if;

  -- A browser can recover from a lost response by calling prepare again. Stale
  -- preparations expire, while a recent one is returned idempotently.
  update public.data_retention_runs
  set
      status = 'failed',
      completed_at = pg_catalog.statement_timestamp(),
      completed_by = auth.uid(),
      failure_reason = '準備作業逾時，未刪除資料'
  where school_id = target_school
    and status = 'prepared'
    and started_at < pg_catalog.statement_timestamp() - interval '30 minutes';

  select run.id
  into v_run
  from public.data_retention_runs as run
  where run.school_id = target_school
    and run.status = 'prepared'
  order by run.started_at desc
  limit 1;

  if v_run is null then
    v_cutoff := (
      pg_catalog.timezone('Asia/Taipei', pg_catalog.statement_timestamp())::date
      - v_policy_days
    );
    insert into public.data_retention_runs (
      school_id,
      cutoff_date,
      retention_days,
      status,
      started_by
    ) values (
      target_school,
      v_cutoff,
      v_policy_days,
      'prepared',
      auth.uid()
    ) returning id into v_run;

    insert into private.data_retention_run_items (
      run_id,
      school_id,
      scan_id,
      image_path
    )
    select
      v_run,
      scan.school_id,
      scan.id,
      nullif(scan.image_path, '')
    from public.plate_scans as scan
    join public.meal_records as meal
      on meal.school_id = scan.school_id
     and meal.id = scan.meal_record_id
    where scan.school_id = target_school
      and meal.served_on < v_cutoff
      and pg_catalog.timezone('Asia/Taipei', scan.created_at)::date < v_cutoff
      and pg_catalog.timezone('Asia/Taipei', scan.reviewed_at)::date < v_cutoff
      and not exists (
        select 1
        from public.scan_detections as detection
        join public.scan_corrections as correction
          on correction.school_id = detection.school_id
         and correction.detection_id = detection.id
        where detection.school_id = scan.school_id
          and detection.scan_id = scan.id
          and pg_catalog.timezone(
            'Asia/Taipei',
            correction.corrected_at
          )::date >= v_cutoff
      )
    order by meal.served_on, scan.created_at, scan.id
    limit 500;

    select
      pg_catalog.count(item.scan_id)::integer,
      pg_catalog.count(item.image_path)::integer,
      pg_catalog.count(distinct scan.meal_record_id)::integer
    into v_scan_count, v_image_count, v_meal_count
    from private.data_retention_run_items as item
    join public.plate_scans as scan
      on scan.school_id = item.school_id
     and scan.id = item.scan_id
    where item.run_id = v_run;

    update public.data_retention_runs
    set
      candidate_scan_count = v_scan_count,
      candidate_image_count = v_image_count,
      affected_meal_count = v_meal_count
    where id = v_run;
  end if;

  select
    run.cutoff_date,
    run.candidate_scan_count,
    run.candidate_image_count,
    run.affected_meal_count
  into v_cutoff, v_scan_count, v_image_count, v_meal_count
  from public.data_retention_runs as run
  where run.id = v_run;

  select
    coalesce(
      pg_catalog.jsonb_agg(item.image_path order by item.image_path)
        filter (where item.image_path is not null),
      '[]'::jsonb
    ),
    pg_catalog.min(meal.served_on),
    pg_catalog.max(meal.served_on)
  into v_paths, v_oldest, v_newest
  from private.data_retention_run_items as item
  join public.plate_scans as scan
    on scan.school_id = item.school_id
   and scan.id = item.scan_id
  join public.meal_records as meal
    on meal.school_id = scan.school_id
   and meal.id = scan.meal_record_id
  where item.run_id = v_run;

  return pg_catalog.jsonb_build_object(
    'run_id', v_run,
    'cutoff_date', v_cutoff,
    'retention_days', v_policy_days,
    'eligible_scan_count', v_scan_count,
    'eligible_image_count', v_image_count,
    'affected_meal_count', v_meal_count,
    'oldest_eligible_date', v_oldest,
    'newest_eligible_date', v_newest,
    'batch_limit', 500,
    'image_paths', v_paths
  );
end;
$$;

create function private.finalize_data_retention(
  target_run uuid,
  storage_succeeded boolean,
  failure_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run public.data_retention_runs%rowtype;
  v_deleted integer := 0;
begin
  select * into v_run
  from public.data_retention_runs
  where id = target_run
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'retention run not found';
  end if;
  if not private.is_school_member(
    v_run.school_id,
    array['admin']
  ) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_run.status = 'completed' then
    return pg_catalog.to_jsonb(v_run);
  end if;
  if v_run.status = 'failed' then
    raise exception using errcode = '55000', message = 'retention run already failed';
  end if;

  if not storage_succeeded then
    update public.data_retention_runs
    set
      status = 'failed',
      completed_at = pg_catalog.statement_timestamp(),
      completed_by = auth.uid(),
      failure_reason = pg_catalog.left(
        coalesce(nullif(failure_reason, ''), '圖片儲存清理未完成，資料未刪除'),
        1000
      )
    where id = target_run
    returning * into v_run;
    delete from private.data_retention_run_items where run_id = target_run;
    return pg_catalog.to_jsonb(v_run);
  end if;

  if exists (
    select 1
    from private.data_retention_run_items as item
    join storage.objects as object
      on object.bucket_id = 'plate-images'
     and object.name = item.image_path
    where item.run_id = target_run
      and item.image_path is not null
  ) then
    raise exception using
      errcode = '55000',
      message = 'storage objects remain; database evidence was not deleted';
  end if;

  delete from public.plate_scans as scan
  using private.data_retention_run_items as item
  where item.run_id = target_run
    and item.school_id = v_run.school_id
    and scan.school_id = item.school_id
    and scan.id = item.scan_id;
  get diagnostics v_deleted = row_count;

  update public.data_retention_runs
  set
    status = 'completed',
    deleted_scan_count = v_deleted,
    deleted_image_count = candidate_image_count,
    completed_at = pg_catalog.statement_timestamp(),
    completed_by = auth.uid(),
    failure_reason = null
  where id = target_run
  returning * into v_run;

  delete from private.data_retention_run_items where run_id = target_run;
  return pg_catalog.to_jsonb(v_run);
end;
$$;

create function public.preview_data_retention(
  target_school uuid,
  retention_days integer
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.preview_data_retention(target_school, retention_days);
$$;

create function public.prepare_data_retention(
  target_school uuid,
  expected_retention_days integer
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.prepare_data_retention(target_school, expected_retention_days);
$$;

create function public.finalize_data_retention(
  target_run uuid,
  storage_succeeded boolean,
  failure_reason text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.finalize_data_retention(
    target_run,
    storage_succeeded,
    failure_reason
  );
$$;

revoke all on function private.preview_data_retention(uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function private.prepare_data_retention(uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function private.finalize_data_retention(uuid, boolean, text)
from public, anon, authenticated, service_role;
grant execute on function private.preview_data_retention(uuid, integer)
to authenticated;
grant execute on function private.prepare_data_retention(uuid, integer)
to authenticated;
grant execute on function private.finalize_data_retention(uuid, boolean, text)
to authenticated;

revoke all on function public.preview_data_retention(uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function public.prepare_data_retention(uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function public.finalize_data_retention(uuid, boolean, text)
from public, anon, authenticated, service_role;
grant execute on function public.preview_data_retention(uuid, integer)
to authenticated;
grant execute on function public.prepare_data_retention(uuid, integer)
to authenticated;
grant execute on function public.finalize_data_retention(uuid, boolean, text)
to authenticated;
