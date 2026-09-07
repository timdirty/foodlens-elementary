-- Preserve the student's per-detection correction note in cloud mode. Direct
-- table writes remain unavailable to browser roles; the RPC validates and
-- stores only an index-aligned, bounded array. Because the existing scan core
-- fingerprints the complete payload, correction_notes also participates in
-- atomic idempotency without weakening the established scan transaction.
alter table public.scan_corrections
  add constraint scan_corrections_note_length_check
  check (char_length(note) <= 300) not valid;

alter table public.scan_corrections
  validate constraint scan_corrections_note_length_check;

alter function private.confirm_scan_core_v2(jsonb)
  rename to confirm_scan_core_v2_without_notes;

revoke all on function private.confirm_scan_core_v2_without_notes(jsonb)
from public, anon, authenticated, service_role;

create function private.confirm_scan_core_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_school uuid;
  v_scan uuid;
  v_notes jsonb;
  v_note jsonb;
  v_detection_count integer;
  v_correction_count integer;
begin
  if payload ? 'correctionNotes' then
    raise exception 'correction notes must use the correction_notes field'
      using errcode = '22023';
  end if;

  if payload ? 'correction_notes' then
    v_notes := payload -> 'correction_notes';
    if jsonb_typeof(v_notes) is distinct from 'array' then
      raise exception 'correction notes must be an array'
        using errcode = '22023';
    end if;

    if jsonb_typeof(payload #> '{analysis,detections}') is distinct from 'array'
      or jsonb_typeof(payload -> 'corrections') is distinct from 'array' then
      raise exception 'detections and corrections must be arrays'
        using errcode = '22023';
    end if;

    v_detection_count := jsonb_array_length(payload #> '{analysis,detections}');
    v_correction_count := jsonb_array_length(payload -> 'corrections');
    if jsonb_array_length(v_notes) <> v_detection_count
      or v_correction_count <> v_detection_count then
      raise exception 'correction notes must match detections and corrections by index'
        using errcode = '22023';
    end if;

    if v_detection_count > 0 then
      for v_index in 0..(v_detection_count - 1) loop
        v_note := v_notes -> v_index;
        if jsonb_typeof(v_note) not in ('string', 'null') then
          raise exception 'each correction note must be text or null'
            using errcode = '22023';
        end if;
        if jsonb_typeof(v_note) = 'string'
          and char_length(v_notes ->> v_index) > 300 then
          raise exception 'each correction note must contain at most 300 characters'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;

  -- The prior core still performs authorization, all scan validation, the
  -- advisory lock, the full-payload fingerprint, and every insert atomically.
  v_result := private.confirm_scan_core_v2_without_notes(payload);

  if v_notes is null then
    return v_result;
  end if;

  begin
    v_school := nullif(payload ->> 'school_id', '')::uuid;
    v_scan := nullif(v_result ->> 'scan_id', '')::uuid;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'scan result cannot be linked to correction notes'
        using errcode = '22023';
  end;

  update public.scan_corrections as correction
  set note = v_notes ->> detection.sort_order
  from public.scan_detections as detection
  where correction.school_id = v_school
    and correction.detection_id = detection.id
    and detection.school_id = v_school
    and detection.scan_id = v_scan
    and jsonb_typeof(v_notes -> detection.sort_order) = 'string';

  return v_result;
end;
$$;

revoke all on function private.confirm_scan_core_v2(jsonb)
from public, anon, authenticated, service_role;
