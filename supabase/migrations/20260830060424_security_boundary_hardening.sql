-- Keep privileged implementations out of the Data API's exposed schema.
-- The public confirm_scan function remains the only authenticated write RPC,
-- but is now an invoker wrapper around a tightly granted private function.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

alter function public.set_updated_at() set schema private;
alter function public.force_created_by() set schema private;
alter function public.force_updated_by() set schema private;
alter function public.block_detection_mutation() set schema private;
alter function public.is_school_member(uuid, text[]) set schema private;
alter function public.confirm_scan(jsonb) set schema private;

alter function private.set_updated_at() set search_path = '';
alter function private.force_created_by() set search_path = '';
alter function private.force_updated_by() set search_path = '';
alter function private.block_detection_mutation() set search_path = '';
alter function private.is_school_member(uuid, text[]) set search_path = '';
alter function private.confirm_scan(jsonb) set search_path = '';

revoke all on all functions in schema private
from public, anon, authenticated, service_role;
grant execute on function private.is_school_member(uuid, text[])
to authenticated;
grant execute on function private.confirm_scan(jsonb)
to authenticated;

-- private.confirm_scan() still calls the schema-qualified historical helper.
-- Keep that name as an invoker-only compatibility shim, but do not expose it
-- to any Data API role.
create function public.is_school_member(
  target_school uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_school_member(target_school, allowed_roles);
$$;

create function public.confirm_scan(payload jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.confirm_scan(payload);
$$;

revoke all on all functions in schema public
from public, anon, authenticated, service_role;
grant execute on function public.confirm_scan(jsonb) to authenticated;

-- Supabase projects can carry explicit role-level default grants in addition
-- to PostgreSQL's PUBLIC function grant. Make future public objects opt-in for
-- browser roles instead of relying on every later migration to remember this.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

revoke usage on schema public from public, anon;
grant usage on schema public to authenticated, service_role;
revoke all on all tables in schema public from public, anon;
revoke all on all sequences in schema public from public, anon, authenticated;

-- FOR ALL also creates a SELECT policy, duplicating each table's read policy.
-- Split writes by operation so authorization stays explicit and the RLS
-- planner evaluates only the policy needed for the requested operation.
drop policy classes_write on public.classes;
create policy classes_insert on public.classes
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy classes_update on public.classes
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy classes_delete on public.classes
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

drop policy meals_write on public.meal_records;
create policy meals_insert on public.meal_records
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy meals_update on public.meal_records
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy meals_delete on public.meal_records
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

drop policy predictions_write on public.supply_predictions;
create policy predictions_insert on public.supply_predictions
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy predictions_update on public.supply_predictions
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy predictions_delete on public.supply_predictions
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

drop policy experiments_write on public.experiments;
create policy experiments_insert on public.experiments
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy experiments_update on public.experiments
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy experiments_delete on public.experiments
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

drop policy research_write on public.research_sections;
create policy research_insert on public.research_sections
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy research_update on public.research_sections
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy research_delete on public.research_sections
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

drop policy impact_write on public.impact_settings;
create policy impact_insert on public.impact_settings
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy impact_update on public.impact_settings
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy impact_delete on public.impact_settings
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

drop policy profile_write on public.project_profiles;
create policy profile_insert on public.project_profiles
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy profile_update on public.project_profiles
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy profile_delete on public.project_profiles
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

-- Every referencing key gets a usable leading-column index. This keeps parent
-- updates/deletes from taking table-wide locks or scans as school history grows.
create index if not exists meal_records_school_class_idx
  on public.meal_records (school_id, class_id);
create index if not exists plate_scans_school_meal_idx
  on public.plate_scans (school_id, meal_record_id);
create index if not exists scan_detections_school_scan_idx
  on public.scan_detections (school_id, scan_id);
create index if not exists scan_corrections_school_detection_idx
  on public.scan_corrections (school_id, detection_id);
create index if not exists scan_corrections_corrected_by_idx
  on public.scan_corrections (corrected_by);
create index if not exists supply_predictions_created_by_idx
  on public.supply_predictions (created_by);
create index if not exists experiments_class_id_idx
  on public.experiments (class_id);
create index if not exists experiments_created_by_idx
  on public.experiments (created_by);
create index if not exists research_sections_updated_by_idx
  on public.research_sections (updated_by);
create index if not exists impact_settings_updated_by_idx
  on public.impact_settings (updated_by);
create index if not exists project_profiles_updated_by_idx
  on public.project_profiles (updated_by);

update storage.buckets
set public = false
where id = 'plate-images';
