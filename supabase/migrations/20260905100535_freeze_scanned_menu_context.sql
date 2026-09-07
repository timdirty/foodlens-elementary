-- Once a confirmed menu has been cited by a plate scan, its exact candidate
-- rows are audit evidence. Corrections must create a later menu version instead
-- of rewriting or extending what the student and model saw at scan time.
create function private.guard_scanned_menu_version()
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
    raise exception 'a menu version referenced by a plate scan is immutable'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function private.guard_scanned_menu_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    tg_op <> 'INSERT'
    and exists (
      select 1
      from public.plate_scans as scan
      where scan.school_id = old.school_id
        and scan.menu_context_version_id = old.menu_version_id
    )
  ) or (
    tg_op <> 'DELETE'
    and exists (
      select 1
      from public.plate_scans as scan
      where scan.school_id = new.school_id
        and scan.menu_context_version_id = new.menu_version_id
    )
  ) then
    raise exception 'menu candidates referenced by a plate scan are immutable'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_scanned_menu_version()
from public, anon, authenticated, service_role;
revoke all on function private.guard_scanned_menu_item()
from public, anon, authenticated, service_role;

create trigger guard_scanned_menu_version
before update or delete on public.menu_versions
for each row execute function private.guard_scanned_menu_version();

create trigger guard_scanned_menu_item
before insert or update or delete on public.menu_items
for each row execute function private.guard_scanned_menu_item();
