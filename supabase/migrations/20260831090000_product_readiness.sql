-- Optional governance details are intentionally nullable so existing schools
-- can upgrade before a teacher completes the formal readiness checklist.
alter table public.project_profiles
  add column if not exists privacy_contact text,
  add column if not exists data_retention_days integer,
  add column if not exists governance_reviewed_at timestamptz;

alter table public.project_profiles
  drop constraint if exists project_profiles_data_retention_days_check;

alter table public.project_profiles
  add constraint project_profiles_data_retention_days_check
  check (
    data_retention_days is null
    or data_retention_days between 1 and 3650
  );

alter table public.project_profiles
  drop constraint if exists project_profiles_privacy_contact_length_check;

alter table public.project_profiles
  add constraint project_profiles_privacy_contact_length_check
  check (
    privacy_contact is null
    or char_length(btrim(privacy_contact)) between 1 and 500
  );
