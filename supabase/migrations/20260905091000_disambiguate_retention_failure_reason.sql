-- Keep the published function signature stable while separating the input
-- parameter from data_retention_runs.failure_reason for PL/pgSQL resolution.
create or replace function private.finalize_data_retention(
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
  v_failure_reason text := $3;
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
        coalesce(
          nullif(v_failure_reason, ''),
          '圖片儲存清理未完成，資料未刪除'
        ),
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

comment on function private.finalize_data_retention(uuid, boolean, text) is
  'Finalizes one bounded retention manifest; the failure input is explicitly separated from the audit column.';
