-- A confirmed school menu is commonly reused by several classes. Once one
-- class has cited it in a plate scan, later aggregate saves still need to
-- resolve their request-local UUIDs to the same canonical menu and item rows.
-- Permit only material-equivalent conflict upserts; all actual evidence
-- changes remain blocked and must be represented by a later menu version.

create or replace function private.guard_scanned_menu_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.plate_scans as scan
    where scan.school_id = old.school_id
      and scan.menu_context_version_id = old.id
  ) then
    if tg_op = 'UPDATE'
      and (
        to_jsonb(new) - array['updated_at', 'confirmed_by', 'confirmed_at']
      ) is not distinct from (
        to_jsonb(old) - array['updated_at', 'confirmed_by', 'confirmed_at']
      )
    then
      -- Reusing the same canonical menu must not transfer confirmation
      -- ownership or make immutable evidence appear newly edited.
      new.confirmed_by := old.confirmed_by;
      new.confirmed_at := old.confirmed_at;
      new.updated_at := old.updated_at;
      return new;
    end if;

    raise exception 'a menu version referenced by a plate scan is immutable'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.guard_scanned_menu_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.menu_items%rowtype;
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1
      from public.plate_scans as scan
      where scan.school_id = new.school_id
        and scan.menu_context_version_id = new.menu_version_id
    ) then
      select item.*
      into v_existing
      from public.menu_items as item
      where item.school_id = new.school_id
        and item.menu_version_id = new.menu_version_id
        and item.sort_order = new.sort_order;

      if found
        and (
          to_jsonb(new)
            - array['id', 'created_by', 'created_at', 'updated_at']
        ) is not distinct from (
          to_jsonb(v_existing)
            - array['id', 'created_by', 'created_at', 'updated_at']
        )
      then
        -- Let the natural-key ON CONFLICT path return the canonical item id.
        return new;
      end if;

      raise exception 'menu candidates referenced by a plate scan are immutable'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.plate_scans as scan
    where scan.school_id = old.school_id
      and scan.menu_context_version_id = old.menu_version_id
  ) or (
    tg_op = 'UPDATE'
    and exists (
      select 1
      from public.plate_scans as scan
      where scan.school_id = new.school_id
        and scan.menu_context_version_id = new.menu_version_id
    )
  ) then
    if tg_op = 'UPDATE'
      and (
        to_jsonb(new) - 'updated_at'
      ) is not distinct from (
        to_jsonb(old) - 'updated_at'
      )
    then
      new.updated_at := old.updated_at;
      return new;
    end if;

    raise exception 'menu candidates referenced by a plate scan are immutable'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

-- PostgreSQL executes same-event triggers alphabetically. Run the evidence
-- guard after database-owned attribution and timestamp triggers so an allowed
-- no-op can restore the original audit timestamps before the row is written.
alter trigger guard_scanned_menu_version on public.menu_versions
  rename to zz_guard_scanned_menu_version;
alter trigger guard_scanned_menu_item on public.menu_items
  rename to zz_guard_scanned_menu_item;

