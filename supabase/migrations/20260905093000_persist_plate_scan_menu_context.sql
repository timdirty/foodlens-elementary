-- Persist the exact confirmed menu version that the client analysis flow says
-- it supplied as candidates. The client assertion is only a comparison value:
-- the canonical version id, signature, and count are re-derived from the
-- meal/evidence links inside this transaction.
alter table public.plate_scans
  add column menu_context_version_id uuid,
  add column menu_context_signature text,
  add column menu_context_candidate_count smallint,
  add constraint plate_scans_menu_context_complete check (
    (
      menu_context_version_id is null
      and menu_context_signature is null
      and menu_context_candidate_count is null
    )
    or (
      menu_context_version_id is not null
      and menu_context_signature is not null
      and char_length(btrim(menu_context_signature)) between 1 and 160
      and menu_context_candidate_count is not null
      and menu_context_candidate_count between 1 and 30
      and analysis_kind in ('mock-ai', 'real-ai')
    )
  ),
  add constraint plate_scans_school_menu_context_fkey
    foreign key (school_id, menu_context_version_id)
    references public.menu_versions (school_id, id);

comment on column public.plate_scans.menu_context_version_id is
  'Server-derived confirmed menu version whose candidates the client analysis flow declared it supplied.';
comment on column public.plate_scans.menu_context_signature is
  'Server-derived menu signature captured with the scan; this detects stale client context but is not a model-attention claim.';
comment on column public.plate_scans.menu_context_candidate_count is
  'Server-derived count of confirmed normalized menu items. It does not prove that a model followed any candidate.';

create index plate_scans_school_menu_context_idx
  on public.plate_scans (school_id, menu_context_version_id);

-- Keep the already-hardened scan implementation intact and wrap it with the
-- menu-context assertion/derivation. Passing the full payload to the core also
-- keeps this assertion inside the existing idempotency fingerprint.
alter function private.confirm_scan(jsonb)
  rename to confirm_scan_core_v2;

revoke all on function private.confirm_scan_core_v2(jsonb)
from public, anon, authenticated, service_role;

create function private.confirm_scan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_school uuid;
  v_scan uuid;
  v_meal uuid;
  v_assertion jsonb;
  v_asserted_signature text;
  v_asserted_count integer;
  v_menu_version uuid;
  v_menu_signature text;
  v_candidate_count integer;
begin
  if payload ? 'menu_context'
    or payload ? 'menu_context_version_id'
    or payload ? 'menu_context_signature'
    or payload ? 'menu_context_candidate_count' then
    raise exception 'menu context identity is server-derived and must not be supplied'
      using errcode = '22023';
  end if;

  if payload ? 'menu_context_assertion' then
    v_assertion := payload -> 'menu_context_assertion';
    if jsonb_typeof(v_assertion) is distinct from 'object' then
      raise exception 'menu context assertion must be an object'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_object_keys(v_assertion) as assertion_key(key)
      where assertion_key.key not in (
        'menu_version_signature',
        'candidate_count'
      )
    ) then
      raise exception 'menu context assertion contains unsupported fields'
        using errcode = '22023';
    end if;

    v_asserted_signature := v_assertion ->> 'menu_version_signature';
    if v_asserted_signature is null
      or v_asserted_signature <> btrim(v_asserted_signature)
      or char_length(v_asserted_signature) not between 1 and 160 then
      raise exception 'menu context signature must contain 1 to 160 characters'
        using errcode = '22023';
    end if;
    if jsonb_typeof(v_assertion -> 'candidate_count') is distinct from 'number'
      or (v_assertion ->> 'candidate_count') !~ '^[0-9]+$' then
      raise exception 'menu context candidate count must be an integer'
        using errcode = '22023';
    end if;
    begin
      v_asserted_count := (v_assertion ->> 'candidate_count')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'menu context candidate count must be an integer'
          using errcode = '22023';
    end;
    if v_asserted_count not between 1 and 30 then
      raise exception 'menu context candidate count must be between 1 and 30'
        using errcode = '22023';
    end if;
  end if;

  -- The core performs membership checks, payload validation, idempotency,
  -- meal creation/attachment, source derivation, and child-row inserts.
  v_result := private.confirm_scan_core_v2(payload);

  if v_assertion is null then
    return v_result;
  end if;

  begin
    v_school := nullif(payload ->> 'school_id', '')::uuid;
    v_scan := nullif(v_result ->> 'scan_id', '')::uuid;
    v_meal := nullif(v_result ->> 'meal_id', '')::uuid;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'scan result cannot be linked to a confirmed menu context'
        using errcode = '22023';
  end;

  -- This verifies an exact school-scoped evidence link and stable signature.
  -- It intentionally does not claim to validate the candidate content observed
  -- inside an external model; the application preserves that as a workflow
  -- assertion, while the database controls which canonical menu can be stored.
  select
    batch.menu_version_id,
    meal.menu_signature,
    count(item.id)::integer
  into
    v_menu_version,
    v_menu_signature,
    v_candidate_count
  from public.meal_batches as batch
  join public.meal_records as meal
    on meal.school_id = batch.school_id
   and meal.id = batch.meal_record_id
  join public.menu_versions as menu
    on menu.school_id = batch.school_id
   and menu.id = batch.menu_version_id
   and menu.status = 'confirmed'
  join public.menu_items as item
    on item.school_id = menu.school_id
   and item.menu_version_id = menu.id
   and item.status = 'confirmed'
  where batch.school_id = v_school
    and batch.meal_record_id = v_meal
    and meal.menu_signature = batch.audit_payload #>> '{menuVersion,signature}'
  group by batch.menu_version_id, meal.menu_signature;

  if v_menu_version is null or v_candidate_count not between 1 and 30 then
    raise exception 'meal has no exact confirmed menu candidate context'
      using errcode = '23503';
  end if;
  if v_asserted_signature <> v_menu_signature
    or v_asserted_count <> v_candidate_count then
    raise exception 'confirmed menu context changed; analyze the plate again'
      using errcode = '40001';
  end if;

  update public.plate_scans as scan
  set
    menu_context_version_id = v_menu_version,
    menu_context_signature = v_menu_signature,
    menu_context_candidate_count = v_candidate_count
  where scan.school_id = v_school
    and scan.id = v_scan
    and scan.meal_record_id = v_meal
    and scan.analysis_kind in ('mock-ai', 'real-ai');

  if not found then
    raise exception 'only AI scans can store a confirmed menu context'
      using errcode = '22023';
  end if;

  return v_result;
end;
$$;

revoke all on function private.confirm_scan(jsonb)
from public, anon, authenticated, service_role;
grant execute on function private.confirm_scan(jsonb) to authenticated;
