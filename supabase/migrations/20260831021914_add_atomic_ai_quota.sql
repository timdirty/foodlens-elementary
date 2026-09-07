-- Keep paid real-AI request accounting outside the exposed API schema.
-- One row per user is sufficient because the quota is global per user, even
-- when that user belongs to more than one school.
create table private.ai_quota_windows (
  user_id uuid primary key references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  window_started_at timestamptz not null,
  request_count smallint not null check (request_count between 1 and 10),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);

comment on table private.ai_quota_windows is
  'Internal fixed-window accounting for paid real-AI requests; never exposed through the Data API.';

create index ai_quota_windows_school_id_idx
  on private.ai_quota_windows (school_id);
create index ai_quota_windows_window_started_at_idx
  on private.ai_quota_windows (window_started_at);

alter table private.ai_quota_windows enable row level security;

revoke all on table private.ai_quota_windows
from public, anon, authenticated, service_role;

-- SECURITY DEFINER is required only for this non-exposed implementation so
-- authenticated callers never receive direct access to the quota table.
create function private.consume_ai_quota(target_school uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_window_started_at timestamptz := pg_catalog.date_bin(
    interval '60 seconds',
    pg_catalog.statement_timestamp(),
    timestamptz '1970-01-01 00:00:00+00'
  );
  v_affected integer := 0;
begin
  if v_user is null or target_school is null then
    return false;
  end if;

  -- The privileged implementation re-checks authorization itself. Never rely
  -- on the wrapper's EXECUTE grant as proof that the caller belongs to a school.
  if not exists (
    select 1
    from public.memberships as membership
    where membership.school_id = target_school
      and membership.user_id = v_user
      and membership.role = any (array['teacher', 'admin']::text[])
  ) then
    return false;
  end if;

  -- A single UPSERT serializes concurrent requests for the same user. The
  -- conditional UPDATE leaves ROW_COUNT at zero once the current window has
  -- reached ten requests, so no read-then-write race can overspend the quota.
  insert into private.ai_quota_windows as quota (
    user_id,
    school_id,
    window_started_at,
    request_count,
    updated_at
  ) values (
    v_user,
    target_school,
    v_window_started_at,
    1,
    pg_catalog.statement_timestamp()
  )
  on conflict (user_id) do update
  set
    school_id = excluded.school_id,
    window_started_at = excluded.window_started_at,
    request_count = case
      when quota.window_started_at = excluded.window_started_at
        then quota.request_count + 1
      else 1
    end,
    updated_at = excluded.updated_at
  where
    quota.window_started_at < excluded.window_started_at
    or (
      quota.window_started_at = excluded.window_started_at
      and quota.request_count < 10
    );

  get diagnostics v_affected = row_count;

  -- Opportunistic cleanup keeps one active fixed window per recently active
  -- user and removes state that can no longer influence a future decision.
  delete from private.ai_quota_windows
  where window_started_at < v_window_started_at;

  return v_affected = 1;
end;
$$;

revoke all on function private.consume_ai_quota(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.consume_ai_quota(uuid) to authenticated;

-- The exposed function is deliberately an invoker-only wrapper. Authorization,
-- accounting, and cleanup stay in the pinned private implementation above.
create function public.consume_ai_quota(target_school uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.consume_ai_quota(target_school);
$$;

revoke all on function public.consume_ai_quota(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.consume_ai_quota(uuid) to authenticated;
