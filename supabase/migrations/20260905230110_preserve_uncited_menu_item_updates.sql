-- Before a plate scan cites a menu, teacher corrections and canonical-key
-- aggregate upserts must persist NEW values. Returning OLD from a BEFORE
-- UPDATE trigger reports success but silently discards those corrections.
-- Keep the existing cited-evidence protection and material-equivalent reuse.

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

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
