-- FoodLens P0 meal evidence chain.
--
-- The existing meal_records table remains the class-level aggregate used by
-- the application. These tables preserve the upstream menu/supply evidence,
-- the measurement basis, the human decision, and the separately verified
-- downstream destination without relabelling estimates as measurements.

-- Evidence-chain summaries may extrapolate a weighed plate sample to the
-- represented diner group. This remains distinct from an AI image estimate.
-- private.confirm_scan(jsonb) retains its explicit scale/manual allowlist, so
-- broadening this table constraint does not let scan confirmation mislabel a
-- photo estimate as a meal-level measurement.
alter table public.meal_records
  drop constraint meal_records_measurement_method_check,
  drop constraint meal_records_measurement_is_meal_level;
alter table public.meal_records
  add constraint meal_records_measurement_is_meal_level check (
    measurement_method in ('scale', 'manual', 'sample-extrapolation')
  );

create table public.menu_versions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  service_date date not null,
  meal_period text not null default 'lunch'
    check (meal_period = 'lunch'),
  version_number integer not null
    check (version_number >= 1),
  title text not null
    check (char_length(btrim(title)) between 1 and 200),
  source_system text not null
    check (char_length(btrim(source_system)) between 1 and 100),
  source_reference text,
  status text not null
    check (status in ('draft', 'confirmed', 'archived')),
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_versions_school_id_id_key unique (school_id, id),
  constraint menu_versions_service_version_key
    unique (school_id, service_date, meal_period, version_number),
  constraint menu_versions_confirmation_check check (
    status <> 'confirmed'
    or (confirmed_by is not null and confirmed_at is not null)
  )
);

comment on table public.menu_versions is
  'Versioned school menu evidence. Provenance describes the evidence source, not model confidence.';

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  menu_version_id uuid not null,
  sort_order smallint not null
    check (sort_order >= 0),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 200),
  normalized_name text not null
    check (char_length(btrim(normalized_name)) between 1 and 200),
  category text not null check (
    category in (
      'rice',
      'noodles',
      'meat',
      'vegetable',
      'egg',
      'fruit',
      'other'
    )
  ),
  preparation_method text,
  standard_portion_g integer
    check (standard_portion_g is null or standard_portion_g > 0),
  weight_basis text check (
    weight_basis is null
    or weight_basis in ('raw', 'cooked', 'ready_to_eat')
  ),
  status text not null
    check (status in ('proposed', 'confirmed', 'archived')),
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_items_school_id_id_key unique (school_id, id),
  constraint menu_items_school_menu_sort_key
    unique (school_id, menu_version_id, sort_order),
  constraint menu_items_school_menu_fkey
    foreign key (school_id, menu_version_id)
    references public.menu_versions (school_id, id)
    on delete cascade,
  constraint menu_items_portion_basis_check check (
    standard_portion_g is null or weight_basis is not null
  )
);

comment on table public.menu_items is
  'Human-confirmable normalized menu items; structured menu data should precede OCR or vision guesses.';

create table public.meal_batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  client_case_id uuid not null default gen_random_uuid(),
  payload_hash text check (
    payload_hash is null or payload_hash ~ '^[0-9a-f]{32}$'
  ),
  audit_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(audit_payload) = 'object'),
  meal_record_id uuid,
  menu_version_id uuid not null,
  class_id uuid not null,
  service_date date not null,
  meal_period text not null default 'lunch'
    check (meal_period = 'lunch'),
  status text not null check (
    status in ('planned', 'prepared', 'delivered', 'closed', 'cancelled')
  ),
  planned_people integer not null
    check (planned_people > 0),
  notified_people integer
    check (notified_people is null or notified_people >= 0),
  actual_people integer
    check (actual_people is null or actual_people >= 0),
  planned_supply_g integer not null
    check (planned_supply_g >= 0),
  produced_weight_g integer
    check (produced_weight_g is null or produced_weight_g >= 0),
  delivered_weight_g integer
    check (delivered_weight_g is null or delivered_weight_g >= 0),
  served_weight_g integer
    check (served_weight_g is null or served_weight_g >= 0),
  weight_basis text not null
    check (weight_basis in ('raw', 'cooked', 'ready_to_eat')),
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meal_batches_school_id_id_key unique (school_id, id),
  constraint meal_batches_school_client_case_key
    unique (school_id, client_case_id),
  constraint meal_batches_school_meal_record_key
    unique (school_id, meal_record_id),
  constraint meal_batches_school_meal_record_fkey
    foreign key (school_id, meal_record_id)
    references public.meal_records (school_id, id)
    on delete cascade,
  constraint meal_batches_school_menu_version_fkey
    foreign key (school_id, menu_version_id)
    references public.menu_versions (school_id, id),
  constraint meal_batches_school_class_fkey
    foreign key (school_id, class_id)
    references public.classes (school_id, id),
  constraint meal_batches_status_evidence_check check (
    (status <> 'prepared' or produced_weight_g is not null)
    and (
      status not in ('delivered', 'closed')
      or (produced_weight_g is not null and delivered_weight_g is not null)
    )
    and (
      status <> 'closed'
      or (actual_people is not null and served_weight_g is not null)
    )
  )
);

comment on table public.meal_batches is
  'Planning-to-service evidence for one school/class meal; meal_record_id is an optional one-to-one extension link.';

comment on column public.meal_batches.client_case_id is
  'School-scoped idempotency key for one complete evidence-chain save request.';

comment on column public.meal_batches.payload_hash is
  'Canonical JSONB hash used to make an identical client retry a no-op; it is an idempotency fingerprint, not a security signature.';

comment on column public.meal_batches.audit_payload is
  'Versioned application aggregate retained for exact audit reconstruction; normalized child rows remain the reporting surface.';

create table public.meal_contexts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  meal_batch_id uuid not null,
  context_type text not null check (
    context_type in ('attendance', 'weather', 'calendar', 'activity', 'operational')
  ),
  context_value jsonb not null
    check (jsonb_typeof(context_value) = 'object'),
  observed_at timestamptz not null,
  status text not null
    check (status in ('recorded', 'confirmed', 'voided')),
  source_reference text,
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meal_contexts_school_id_id_key unique (school_id, id),
  constraint meal_contexts_school_batch_fkey
    foreign key (school_id, meal_batch_id)
    references public.meal_batches (school_id, id)
    on delete cascade
);

comment on table public.meal_contexts is
  'Versionable non-personal context used to explain demand; no student health profile or free-form identity field.';

create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  meal_batch_id uuid not null,
  menu_item_id uuid,
  actor_role text not null check (
    actor_role in (
      'student',
      'teacher',
      'dietitian',
      'school',
      'parent',
      'caterer',
      'waste_partner',
      'authority'
    )
  ),
  reason_code text not null check (
    reason_code in (
      'portion',
      'taste',
      'texture',
      'temperature',
      'time',
      'nutrition',
      'other'
    )
  ),
  rating smallint
    check (rating is null or rating between 1 and 5),
  response_count integer not null default 1
    check (response_count > 0),
  note text not null default '',
  status text not null
    check (status in ('submitted', 'reviewed', 'dismissed')),
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_events_school_id_id_key unique (school_id, id),
  constraint feedback_events_school_batch_fkey
    foreign key (school_id, meal_batch_id)
    references public.meal_batches (school_id, id)
    on delete cascade,
  constraint feedback_events_school_menu_item_fkey
    foreign key (school_id, menu_item_id)
    references public.menu_items (school_id, id)
);

comment on table public.feedback_events is
  'Aggregated role feedback. response_count supports anonymous totals without individual student profiles.';

create table public.waste_measurements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  meal_batch_id uuid not null,
  menu_item_id uuid,
  waste_source text not null check (
    waste_source in (
      'unserved_edible',
      'plate_edible',
      'inedible',
      'preparation',
      'liquid'
    )
  ),
  measurement_method text not null check (
    measurement_method in (
      'scale',
      'calibrated_photo',
      'manual_estimate',
      'vendor_receipt',
      'facility_receipt'
    )
  ),
  weight_state text not null
    check (weight_state in ('wet', 'standard_drained', 'dewatered')),
  net_weight_g integer not null
    check (net_weight_g >= 0),
  tare_weight_g integer
    check (tare_weight_g is null or tare_weight_g >= 0),
  gross_weight_g integer
    check (gross_weight_g is null or gross_weight_g >= 0),
  estimate_low_g integer
    check (estimate_low_g is null or estimate_low_g >= 0),
  estimate_high_g integer
    check (estimate_high_g is null or estimate_high_g >= 0),
  contamination_g integer not null default 0
    check (contamination_g >= 0 and contamination_g <= net_weight_g),
  sample_plate_count integer
    check (sample_plate_count is null or sample_plate_count > 0),
  measured_at timestamptz not null,
  status text not null
    check (status in ('recorded', 'confirmed', 'voided')),
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waste_measurements_school_id_id_key unique (school_id, id),
  constraint waste_measurements_school_batch_fkey
    foreign key (school_id, meal_batch_id)
    references public.meal_batches (school_id, id)
    on delete cascade,
  constraint waste_measurements_school_menu_item_fkey
    foreign key (school_id, menu_item_id)
    references public.menu_items (school_id, id),
  constraint waste_measurements_tare_gross_check check (
    (tare_weight_g is null and gross_weight_g is null)
    or (
      tare_weight_g is not null
      and gross_weight_g is not null
      and gross_weight_g >= tare_weight_g
      and net_weight_g = gross_weight_g - tare_weight_g
    )
  ),
  constraint waste_measurements_estimate_range_check check (
    (estimate_low_g is null and estimate_high_g is null)
    or (
      estimate_low_g is not null
      and estimate_high_g is not null
      and estimate_low_g <= net_weight_g
      and net_weight_g <= estimate_high_g
    )
  ),
  constraint waste_measurements_provenance_method_check check (
    provenance = 'demo'
    or (provenance = 'measured' and measurement_method = 'scale')
    or (
      provenance = 'estimated'
      and measurement_method in ('calibrated_photo', 'manual_estimate')
    )
    or (
      provenance = 'official'
      and measurement_method in ('vendor_receipt', 'facility_receipt')
    )
  ),
  constraint waste_measurements_estimated_bounds_required check (
    provenance <> 'estimated'
    or (estimate_low_g is not null and estimate_high_g is not null)
  )
);

comment on table public.waste_measurements is
  'Five mutually explicit waste origins. Photo estimates, scale measurements, and official receipts never share an unlabeled weight.';

create table public.human_decisions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  recommendation_kind text not null check (
    recommendation_kind in ('supply_prediction', 'responsibility_card')
  ),
  recommendation_key text not null
    check (char_length(btrim(recommendation_key)) between 1 and 200),
  prediction_id text,
  meal_batch_id uuid,
  decision text not null
    check (
      decision in (
        'accepted',
        'adjusted',
        'pilot',
        'collect_more_data',
        'rejected'
      )
    ),
  decided_by_role text check (
    decided_by_role is null
    or decided_by_role in (
      'lunch-secretary',
      'dietitian',
      'caterer',
      'teacher-student-team',
      'school-committee'
    )
  ),
  decided_supply_g integer
    check (decided_supply_g is null or decided_supply_g >= 0),
  safety_margin_g integer not null default 0
    check (safety_margin_g >= 0),
  rationale text not null
    check (char_length(btrim(rationale)) between 1 and 2000),
  status text not null
    check (status in ('active', 'superseded', 'voided')),
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  decided_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint human_decisions_school_id_id_key unique (school_id, id),
  constraint human_decisions_school_prediction_fkey
    foreign key (school_id, prediction_id)
    references public.supply_predictions (school_id, id),
  constraint human_decisions_school_batch_fkey
    foreign key (school_id, meal_batch_id)
    references public.meal_batches (school_id, id),
  constraint human_decisions_recommendation_target_check check (
    (
      recommendation_kind = 'supply_prediction'
      and prediction_id is not null
      and recommendation_key = prediction_id
    )
    or (
      recommendation_kind = 'responsibility_card'
      and prediction_id is null
    )
  ),
  constraint human_decisions_responsibility_owner_check check (
    recommendation_kind <> 'responsibility_card'
    or decided_by_role is not null
  ),
  constraint human_decisions_supply_check check (
    (
      recommendation_kind = 'supply_prediction'
      and decision in ('accepted', 'adjusted')
      and decided_supply_g is not null
    )
    or (
      recommendation_kind = 'supply_prediction'
      and decision = 'pilot'
    )
    or (
      recommendation_kind = 'responsibility_card'
      and decision in ('accepted', 'pilot')
      and decided_supply_g is null
      and safety_margin_g = 0
    )
    or (
      decision in ('collect_more_data', 'rejected')
      and decided_supply_g is null
      and safety_margin_g = 0
    )
  )
);

comment on table public.human_decisions is
  'A nutrition or school decision remains distinct from either a saved supply prediction or a responsibility card. Pilots, requests for more evidence, and rejections remain first-class outcomes.';

create table public.collection_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  meal_batch_id uuid not null,
  status text not null
    check (status in ('scheduled', 'collected', 'cancelled')),
  scheduled_at timestamptz not null,
  collected_at timestamptz,
  hauler_name text,
  manifest_reference text,
  net_collected_weight_g integer
    check (net_collected_weight_g is null or net_collected_weight_g >= 0),
  weight_state text not null
    check (weight_state in ('wet', 'standard_drained', 'dewatered')),
  planned_destination_name text not null
    check (char_length(btrim(planned_destination_name)) between 1 and 300),
  planned_treatment_method text not null check (
    planned_treatment_method in (
      'composting',
      'anaerobic_digestion',
      'black_soldier_fly',
      'circular_feed',
      'incineration',
      'landfill',
      'other',
      'unknown'
    )
  ),
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collection_events_school_id_id_key unique (school_id, id),
  constraint collection_events_school_batch_fkey
    foreign key (school_id, meal_batch_id)
    references public.meal_batches (school_id, id)
    on delete cascade,
  constraint collection_events_collected_evidence_check check (
    status <> 'collected'
    or (
      collected_at is not null
      and net_collected_weight_g is not null
      and char_length(btrim(hauler_name)) > 0
    )
  )
);

comment on table public.collection_events is
  'Collection-side plan and pickup evidence only; the planned destination is never treated as a verified outcome.';

create table public.destination_receipts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  collection_event_id uuid not null,
  receipt_reference text not null
    check (char_length(btrim(receipt_reference)) between 1 and 300),
  facility_name text not null
    check (char_length(btrim(facility_name)) between 1 and 300),
  actual_treatment_method text not null check (
    actual_treatment_method in (
      'composting',
      'anaerobic_digestion',
      'black_soldier_fly',
      'circular_feed',
      'incineration',
      'landfill',
      'other',
      'unknown'
    )
  ),
  accepted_weight_g integer
    check (accepted_weight_g is null or accepted_weight_g >= 0),
  received_at timestamptz not null,
  status text not null
    check (status in ('submitted', 'verified', 'rejected')),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  rejection_reason text,
  document_sha256 text check (
    document_sha256 is null or document_sha256 ~ '^[0-9a-f]{64}$'
  ),
  provenance text not null
    check (provenance in ('demo', 'measured', 'estimated', 'official')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint destination_receipts_school_id_id_key unique (school_id, id),
  constraint destination_receipts_school_reference_key
    unique (school_id, receipt_reference),
  constraint destination_receipts_school_collection_fkey
    foreign key (school_id, collection_event_id)
    references public.collection_events (school_id, id)
    on delete cascade,
  constraint destination_receipts_verification_check check (
    (
      status = 'verified'
      and verified_by is not null
      and verified_at is not null
      and accepted_weight_g is not null
      and accepted_weight_g > 0
      and actual_treatment_method <> 'unknown'
      and provenance in ('demo', 'official')
    )
    or (
      status = 'rejected'
      and rejection_reason is not null
      and char_length(btrim(rejection_reason)) > 0
    )
    or status = 'submitted'
  )
);

comment on table public.destination_receipts is
  'Facility-side outcome evidence. A verified row is required before an actual treatment route can be reported as confirmed.';

-- Every composite tenant relationship and every auth-user relationship has a
-- usable leading-column index. The school-leading indexes also support RLS.
create index menu_versions_school_date_idx
  on public.menu_versions (school_id, service_date desc, status);
create index menu_versions_confirmed_by_idx
  on public.menu_versions (confirmed_by);
create index menu_versions_created_by_idx
  on public.menu_versions (created_by);

create index menu_items_created_by_idx
  on public.menu_items (created_by);
create index menu_items_school_category_idx
  on public.menu_items (school_id, category, normalized_name);

create index meal_batches_school_menu_idx
  on public.meal_batches (school_id, menu_version_id);
create index meal_batches_school_class_date_idx
  on public.meal_batches (school_id, class_id, service_date desc);
create index meal_batches_school_status_date_idx
  on public.meal_batches (school_id, status, service_date desc);
create index meal_batches_created_by_idx
  on public.meal_batches (created_by);

create index meal_contexts_school_batch_observed_idx
  on public.meal_contexts (school_id, meal_batch_id, observed_at desc);
create index meal_contexts_created_by_idx
  on public.meal_contexts (created_by);

create index feedback_events_school_batch_status_idx
  on public.feedback_events (school_id, meal_batch_id, status, created_at desc);
create index feedback_events_school_menu_item_idx
  on public.feedback_events (school_id, menu_item_id);
create index feedback_events_created_by_idx
  on public.feedback_events (created_by);

create index waste_measurements_school_batch_source_idx
  on public.waste_measurements (
    school_id,
    meal_batch_id,
    waste_source,
    measured_at desc
  );
create index waste_measurements_school_menu_item_idx
  on public.waste_measurements (school_id, menu_item_id);
create index waste_measurements_created_by_idx
  on public.waste_measurements (created_by);

create index human_decisions_school_recommendation_idx
  on public.human_decisions (
    school_id,
    recommendation_kind,
    recommendation_key,
    decided_at desc
  );
create index human_decisions_school_prediction_idx
  on public.human_decisions (school_id, prediction_id);
create index human_decisions_school_batch_idx
  on public.human_decisions (school_id, meal_batch_id);
create index human_decisions_created_by_idx
  on public.human_decisions (created_by);

create index collection_events_school_batch_status_idx
  on public.collection_events (school_id, meal_batch_id, status);
create index collection_events_created_by_idx
  on public.collection_events (created_by);

create index destination_receipts_school_collection_status_idx
  on public.destination_receipts (school_id, collection_event_id, status);
create index destination_receipts_verified_by_idx
  on public.destination_receipts (verified_by);
create index destination_receipts_created_by_idx
  on public.destination_receipts (created_by);

-- Database-owned attribution and timestamps cannot be overwritten by a browser
-- client. These trigger functions already live in the non-exposed private
-- schema and have a pinned search_path.
create trigger menu_versions_force_created_by
  before insert or update on public.menu_versions
  for each row execute function private.force_created_by();
create trigger menu_versions_updated_at
  before update on public.menu_versions
  for each row execute function private.set_updated_at();
create trigger menu_items_force_created_by
  before insert or update on public.menu_items
  for each row execute function private.force_created_by();
create trigger menu_items_updated_at
  before update on public.menu_items
  for each row execute function private.set_updated_at();
create trigger meal_batches_force_created_by
  before insert or update on public.meal_batches
  for each row execute function private.force_created_by();
create trigger meal_batches_updated_at
  before update on public.meal_batches
  for each row execute function private.set_updated_at();
create trigger meal_contexts_force_created_by
  before insert or update on public.meal_contexts
  for each row execute function private.force_created_by();
create trigger meal_contexts_updated_at
  before update on public.meal_contexts
  for each row execute function private.set_updated_at();
create trigger feedback_events_force_created_by
  before insert or update on public.feedback_events
  for each row execute function private.force_created_by();
create trigger feedback_events_updated_at
  before update on public.feedback_events
  for each row execute function private.set_updated_at();
create trigger waste_measurements_force_created_by
  before insert or update on public.waste_measurements
  for each row execute function private.force_created_by();
create trigger waste_measurements_updated_at
  before update on public.waste_measurements
  for each row execute function private.set_updated_at();
create trigger human_decisions_force_created_by
  before insert or update on public.human_decisions
  for each row execute function private.force_created_by();
create trigger human_decisions_updated_at
  before update on public.human_decisions
  for each row execute function private.set_updated_at();
create trigger collection_events_force_created_by
  before insert or update on public.collection_events
  for each row execute function private.force_created_by();
create trigger collection_events_updated_at
  before update on public.collection_events
  for each row execute function private.set_updated_at();
create trigger destination_receipts_force_created_by
  before insert or update on public.destination_receipts
  for each row execute function private.force_created_by();
create trigger destination_receipts_updated_at
  before update on public.destination_receipts
  for each row execute function private.set_updated_at();

alter table public.menu_versions enable row level security;
alter table public.menu_items enable row level security;
alter table public.meal_batches enable row level security;
alter table public.meal_contexts enable row level security;
alter table public.feedback_events enable row level security;
alter table public.waste_measurements enable row level security;
alter table public.human_decisions enable row level security;
alter table public.collection_events enable row level security;
alter table public.destination_receipts enable row level security;

create policy menu_versions_read on public.menu_versions
  for select to authenticated
  using (private.is_school_member(school_id));
create policy menu_versions_insert on public.menu_versions
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy menu_versions_update on public.menu_versions
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy menu_versions_delete on public.menu_versions
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

create policy menu_items_read on public.menu_items
  for select to authenticated
  using (private.is_school_member(school_id));
create policy menu_items_insert on public.menu_items
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy menu_items_update on public.menu_items
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy menu_items_delete on public.menu_items
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

create policy meal_batches_read on public.meal_batches
  for select to authenticated
  using (private.is_school_member(school_id));
create policy meal_batches_insert on public.meal_batches
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy meal_batches_update on public.meal_batches
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy meal_batches_delete on public.meal_batches
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

create policy meal_contexts_read on public.meal_contexts
  for select to authenticated
  using (private.is_school_member(school_id));
create policy meal_contexts_insert on public.meal_contexts
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy meal_contexts_update on public.meal_contexts
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy meal_contexts_delete on public.meal_contexts
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

create policy feedback_events_read on public.feedback_events
  for select to authenticated
  using (private.is_school_member(school_id));
create policy feedback_events_insert on public.feedback_events
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy feedback_events_update on public.feedback_events
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy feedback_events_delete on public.feedback_events
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

create policy waste_measurements_read on public.waste_measurements
  for select to authenticated
  using (private.is_school_member(school_id));
create policy waste_measurements_insert on public.waste_measurements
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy waste_measurements_update on public.waste_measurements
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy waste_measurements_delete on public.waste_measurements
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

create policy human_decisions_read on public.human_decisions
  for select to authenticated
  using (private.is_school_member(school_id));
create policy human_decisions_insert on public.human_decisions
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy human_decisions_update on public.human_decisions
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy human_decisions_delete on public.human_decisions
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

create policy collection_events_read on public.collection_events
  for select to authenticated
  using (private.is_school_member(school_id));
create policy collection_events_insert on public.collection_events
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy collection_events_update on public.collection_events
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy collection_events_delete on public.collection_events
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

create policy destination_receipts_read on public.destination_receipts
  for select to authenticated
  using (private.is_school_member(school_id));
create policy destination_receipts_insert on public.destination_receipts
  for insert to authenticated
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy destination_receipts_update on public.destination_receipts
  for update to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']))
  with check (private.is_school_member(school_id, array['teacher', 'admin']));
create policy destination_receipts_delete on public.destination_receipts
  for delete to authenticated
  using (private.is_school_member(school_id, array['teacher', 'admin']));

-- 2026 Data API defaults no longer guarantee automatic exposure of new public
-- tables. Make browser and service access deterministic while keeping anon at
-- zero privileges; RLS remains the row-level authorization boundary.
revoke all on table
  public.menu_versions,
  public.menu_items,
  public.meal_batches,
  public.meal_contexts,
  public.feedback_events,
  public.waste_measurements,
  public.human_decisions,
  public.collection_events,
  public.destination_receipts
from public, anon, authenticated, service_role;

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table
  public.menu_versions,
  public.menu_items,
  public.meal_batches,
  public.meal_contexts,
  public.feedback_events,
  public.waste_measurements,
  public.human_decisions,
  public.collection_events,
  public.destination_receipts
to authenticated, service_role;

-- Save the upstream-to-decision evidence for one class meal as one statement.
-- PostgreSQL functions execute inside the caller transaction, so any invalid
-- child row rolls the complete replacement back. SECURITY INVOKER preserves
-- both table grants and RLS; the explicit membership check gives callers a
-- stable error before any write is attempted.
create function public.save_meal_evidence_chain(payload jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_school_id uuid;
  v_client_case_id uuid;
  v_menu jsonb;
  v_menu_items jsonb;
  v_meal_record jsonb;
  v_batch jsonb;
  v_contexts jsonb;
  v_feedback jsonb;
  v_measurements jsonb;
  v_human_decision jsonb;
  v_item jsonb;
  v_menu_version_id uuid;
  v_natural_menu_version_id uuid;
  v_requested_menu_version_id uuid;
  v_meal_record_id uuid;
  v_requested_meal_record_id uuid;
  v_batch_meal_record_id uuid;
  v_meal_batch_id uuid;
  v_requested_meal_batch_id uuid;
  v_child_id uuid;
  v_requested_menu_item_id uuid;
  v_canonical_menu_item_id uuid;
  v_client_menu_item_id uuid;
  v_menu_item_sort_order smallint;
  v_human_decision_id uuid;
  v_service_date date;
  v_batch_service_date date;
  v_meal_served_on date;
  v_meal_period text;
  v_batch_meal_period text;
  v_record_meal_period text;
  v_batch_class_id uuid;
  v_meal_class_id uuid;
  v_meal_total_supply_g integer;
  v_meal_leftover_g integer;
  v_menu_version_number integer;
  v_menu_status text;
  v_menu_item_id_map jsonb := '{}'::jsonb;
  v_menu_sort_order_map jsonb := '{}'::jsonb;
  v_menu_item_ids jsonb := '[]'::jsonb;
  v_context_ids jsonb := '[]'::jsonb;
  v_feedback_ids jsonb := '[]'::jsonb;
  v_measurement_ids jsonb := '[]'::jsonb;
  v_existing_batch boolean := false;
  v_payload_hash text;
  v_existing_payload_hash text;
begin
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'payload must be a JSON object';
  end if;

  begin
    v_school_id := nullif(payload ->> 'school_id', '')::uuid;
    v_client_case_id := nullif(payload ->> 'client_case_id', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '22023',
        message = 'school_id and client_case_id must be UUID values';
  end;

  if v_school_id is null or v_client_case_id is null then
    raise exception using
      errcode = '22023',
      message = 'school_id and client_case_id are required';
  end if;

  if auth.uid() is null
    or not private.is_school_member(
      v_school_id,
      array['teacher', 'admin']
    )
  then
    raise exception using
      errcode = '42501',
      message = 'not authorized for this school';
  end if;

  v_menu := payload -> 'menu_version';
  v_menu_items := payload -> 'menu_items';
  v_meal_record := payload -> 'meal_record';
  v_batch := payload -> 'meal_batch';
  v_contexts := payload -> 'contexts';
  v_feedback := payload -> 'feedback';
  v_measurements := payload -> 'measurements';
  v_human_decision := payload -> 'human_decision';

  if v_menu is null or pg_catalog.jsonb_typeof(v_menu) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'menu_version must be a JSON object';
  end if;
  if v_menu_items is null
    or pg_catalog.jsonb_typeof(v_menu_items) <> 'array'
    or pg_catalog.jsonb_array_length(v_menu_items) = 0
  then
    raise exception using
      errcode = '22023',
      message = 'menu_items must be a non-empty JSON array';
  end if;
  if v_meal_record is null
    or pg_catalog.jsonb_typeof(v_meal_record) <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record must be a JSON object';
  end if;
  if v_batch is null or pg_catalog.jsonb_typeof(v_batch) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'meal_batch must be a JSON object';
  end if;
  if pg_catalog.jsonb_typeof(v_meal_record -> 'side_dishes') <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'meal_record.side_dishes must be a JSON array';
  end if;

  if v_contexts is null or v_contexts = 'null'::jsonb then
    v_contexts := '[]'::jsonb;
  end if;
  if v_feedback is null or v_feedback = 'null'::jsonb then
    v_feedback := '[]'::jsonb;
  end if;
  if v_measurements is null or v_measurements = 'null'::jsonb then
    v_measurements := '[]'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(v_contexts) <> 'array'
    or pg_catalog.jsonb_typeof(v_feedback) <> 'array'
    or pg_catalog.jsonb_typeof(v_measurements) <> 'array'
  then
    raise exception using
      errcode = '22023',
      message = 'contexts, feedback, and measurements must be JSON arrays';
  end if;
  if v_human_decision is not null
    and v_human_decision <> 'null'::jsonb
    and pg_catalog.jsonb_typeof(v_human_decision) <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'human_decision must be a JSON object or null';
  end if;

  begin
    v_requested_menu_version_id :=
      nullif(v_menu ->> 'id', '')::uuid;
    v_requested_meal_record_id :=
      nullif(v_meal_record ->> 'id', '')::uuid;
    v_batch_meal_record_id :=
      nullif(v_batch ->> 'meal_record_id', '')::uuid;
    v_requested_meal_batch_id :=
      nullif(v_batch ->> 'id', '')::uuid;
    v_meal_class_id := nullif(v_meal_record ->> 'class_id', '')::uuid;
    v_batch_class_id := nullif(v_batch ->> 'class_id', '')::uuid;
    v_service_date := nullif(v_menu ->> 'service_date', '')::date;
    v_meal_served_on := nullif(v_meal_record ->> 'served_on', '')::date;
    v_menu_version_number :=
      nullif(v_menu ->> 'version_number', '')::integer;
    v_meal_total_supply_g :=
      nullif(v_meal_record ->> 'total_supply_g', '')::integer;
    v_meal_leftover_g :=
      nullif(v_meal_record ->> 'leftover_g', '')::integer;
    v_batch_service_date := coalesce(
      nullif(v_batch ->> 'service_date', '')::date,
      v_service_date
    );
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'menu, meal record, batch, or service values are invalid';
  end;

  if v_service_date is null then
    raise exception using
      errcode = '22023',
      message = 'menu_version.service_date is required';
  end if;
  if v_menu_version_number is null then
    raise exception using
      errcode = '22023',
      message = 'menu_version.version_number is required';
  end if;

  v_meal_period := coalesce(
    nullif(v_menu ->> 'meal_period', ''),
    'lunch'
  );
  v_batch_meal_period := coalesce(
    nullif(v_batch ->> 'meal_period', ''),
    v_meal_period
  );
  v_record_meal_period := coalesce(
    nullif(v_meal_record ->> 'meal_period', ''),
    v_meal_period
  );
  if v_batch_service_date <> v_service_date
    or v_batch_meal_period <> v_meal_period
  then
    raise exception using
      errcode = '22023',
      message = 'menu_version and meal_batch must describe the same date and meal period';
  end if;
  if v_requested_meal_record_id is null
    or v_batch_meal_record_id is null
    or v_requested_meal_record_id <> v_batch_meal_record_id
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record.id must equal meal_batch.meal_record_id';
  end if;
  if v_meal_class_id is null
    or v_batch_class_id is null
    or v_meal_class_id <> v_batch_class_id
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record and meal_batch must reference the same class';
  end if;
  if v_meal_served_on is null
    or v_meal_served_on <> v_batch_service_date
    or v_record_meal_period <> v_batch_meal_period
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record and meal_batch must describe the same date and meal period';
  end if;
  if v_meal_period <> 'lunch'
    or v_batch_meal_period <> 'lunch'
    or v_record_meal_period <> 'lunch'
  then
    raise exception using
      errcode = '22023',
      message = 'FoodLens currently supports lunch meal periods only';
  end if;
  if v_meal_total_supply_g is null
    or v_meal_total_supply_g < 0
    or v_meal_leftover_g is null
    or v_meal_leftover_g < 0
    or v_meal_leftover_g > v_meal_total_supply_g
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record leftover weight must be between zero and total supply';
  end if;
  if coalesce(v_meal_record ->> 'measurement_method', '')
    not in ('scale', 'manual', 'sample-extrapolation')
  then
    raise exception using
      errcode = '22023',
      message = 'meal_record measurement_method is not supported';
  end if;
  if coalesce(v_meal_record ->> 'source', '') not in ('manual', 'import') then
    raise exception using
      errcode = '22023',
      message = 'meal_record source is not supported';
  end if;

  perform 1
  from public.classes as class
  where class.school_id = v_school_id
    and class.id = v_meal_class_id;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'meal_record class does not belong to the current school';
  end if;

  -- Serialize concurrent retries of the same school-scoped client key. The
  -- unique constraint remains the final database invariant.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_school_id::text || ':' || v_client_case_id::text,
      0
    )
  );

  -- Different class cases can share one school/date/period/version menu. Lock
  -- that natural key as well as the client case so concurrent writers cannot
  -- race to create different UUIDs for the same canonical menu.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meal-menu:' || v_school_id::text || ':' || v_service_date::text || ':'
        || v_meal_period || ':' || v_menu_version_number::text,
      0
    )
  );

  select menu.id
  into v_natural_menu_version_id
  from public.menu_versions as menu
  where menu.school_id = v_school_id
    and menu.service_date = v_service_date
    and menu.meal_period = v_meal_period
    and menu.version_number = v_menu_version_number
  for update;

  v_payload_hash := pg_catalog.md5(payload::text);

  select
    batch.id,
    batch.menu_version_id,
    batch.meal_record_id,
    batch.payload_hash
  into
    v_meal_batch_id,
    v_menu_version_id,
    v_meal_record_id,
    v_existing_payload_hash
  from public.meal_batches as batch
  where batch.school_id = v_school_id
    and batch.client_case_id = v_client_case_id
  for update;
  v_existing_batch := found;

  if v_existing_batch then
    if v_requested_meal_batch_id is not null
      and v_requested_meal_batch_id <> v_meal_batch_id
    then
      raise exception using
        errcode = '23505',
        message = 'client_case_id already belongs to a different meal_batch id';
    end if;
    if v_meal_record_id is null
      or v_requested_meal_record_id <> v_meal_record_id
    then
      raise exception using
        errcode = '23505',
        message = 'client_case_id already belongs to a different meal_record id';
    end if;
    -- A payload UUID is only a client alias. The persisted batch must keep the
    -- canonical menu selected by the school/date/period/version natural key.
    if v_natural_menu_version_id is null
      or v_natural_menu_version_id <> v_menu_version_id
    then
      raise exception using
        errcode = '23505',
        message = 'client_case_id already belongs to a different canonical menu';
    end if;

    -- An exact network retry must not rewrite created_at or evidence timestamps.
    -- A changed payload with the same case and stable aggregate IDs is treated
    -- as an intentional replacement and continues through the transaction.
    if v_existing_payload_hash = v_payload_hash then
      select coalesce(
        pg_catalog.jsonb_agg(
          coalesce(
            canonical_item.id,
            (entry.value ->> 'id')::uuid
          )
          order by entry.ordinality
        ),
        '[]'::jsonb
      )
      into v_menu_item_ids
      from pg_catalog.jsonb_array_elements(v_menu_items)
        with ordinality as entry(value, ordinality)
      join public.menu_items as canonical_item
        on canonical_item.school_id = v_school_id
       and canonical_item.menu_version_id = v_menu_version_id
       and canonical_item.sort_order =
         (entry.value ->> 'sort_order')::smallint;

      if pg_catalog.jsonb_array_length(v_menu_item_ids)
        <> pg_catalog.jsonb_array_length(v_menu_items)
      then
        raise exception using
          errcode = '23514',
          message = 'stored canonical menu items do not match retry payload';
      end if;

      select coalesce(
        pg_catalog.jsonb_agg(
          (entry.value ->> 'id')::uuid
          order by entry.ordinality
        ),
        '[]'::jsonb
      )
      into v_context_ids
      from pg_catalog.jsonb_array_elements(v_contexts)
        with ordinality as entry(value, ordinality);

      select coalesce(
        pg_catalog.jsonb_agg(
          (entry.value ->> 'id')::uuid
          order by entry.ordinality
        ),
        '[]'::jsonb
      )
      into v_feedback_ids
      from pg_catalog.jsonb_array_elements(v_feedback)
        with ordinality as entry(value, ordinality);

      select coalesce(
        pg_catalog.jsonb_agg(
          (entry.value ->> 'id')::uuid
          order by entry.ordinality
        ),
        '[]'::jsonb
      )
      into v_measurement_ids
      from pg_catalog.jsonb_array_elements(v_measurements)
        with ordinality as entry(value, ordinality);

      if v_human_decision is not null
        and v_human_decision <> 'null'::jsonb
      then
        v_human_decision_id :=
          nullif(v_human_decision ->> 'id', '')::uuid;
      end if;

      return pg_catalog.jsonb_build_object(
        'school_id', v_school_id,
        'client_case_id', v_client_case_id,
        'menu_version_id', v_menu_version_id,
        'meal_record_id', v_meal_record_id,
        'meal_batch_id', v_meal_batch_id,
        'menu_item_ids', v_menu_item_ids,
        'context_ids', v_context_ids,
        'feedback_ids', v_feedback_ids,
        'measurement_ids', v_measurement_ids,
        'human_decision_id', v_human_decision_id
      );
    end if;
  else
    v_meal_record_id := v_requested_meal_record_id;
    v_meal_batch_id := coalesce(
      v_requested_meal_batch_id,
      pg_catalog.gen_random_uuid()
    );
    v_menu_version_id := v_natural_menu_version_id;

    if v_menu_version_id is null
      and v_requested_menu_version_id is not null
      and exists (
        select 1
        from public.menu_versions as requested_menu
        where requested_menu.school_id = v_school_id
          and requested_menu.id = v_requested_menu_version_id
      )
    then
      raise exception using
        errcode = '23505',
        message = 'requested menu_version id already belongs to another natural key';
    end if;

    v_menu_version_id := coalesce(
      v_menu_version_id,
      v_requested_menu_version_id,
      pg_catalog.gen_random_uuid()
    );
  end if;

  v_menu_status := coalesce(nullif(v_menu ->> 'status', ''), 'draft');

  insert into public.menu_versions (
    id,
    school_id,
    service_date,
    meal_period,
    version_number,
    title,
    source_system,
    source_reference,
    status,
    provenance,
    confirmed_by,
    confirmed_at
  ) values (
    v_menu_version_id,
    v_school_id,
    v_service_date,
    v_meal_period,
    v_menu_version_number,
    v_menu ->> 'title',
    v_menu ->> 'source_system',
    nullif(v_menu ->> 'source_reference', ''),
    v_menu_status,
    v_menu ->> 'provenance',
    case when v_menu_status = 'confirmed' then auth.uid() end,
    case
      when v_menu_status = 'confirmed' then coalesce(
        nullif(v_menu ->> 'confirmed_at', '')::timestamptz,
        pg_catalog.now()
      )
    end
  )
  on conflict on constraint menu_versions_service_version_key do update set
    title = excluded.title,
    source_system = excluded.source_system,
    source_reference = excluded.source_reference,
    status = excluded.status,
    provenance = excluded.provenance,
    confirmed_by = excluded.confirmed_by,
    confirmed_at = excluded.confirmed_at
  returning id into v_menu_version_id;

  for v_item in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_menu_items) as entry(value)
  loop
    begin
      v_requested_menu_item_id := nullif(v_item ->> 'id', '')::uuid;
      v_menu_item_sort_order :=
        nullif(v_item ->> 'sort_order', '')::smallint;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = 'every menu_items entry requires a UUID id and integer sort_order';
    end;
    if v_requested_menu_item_id is null then
      raise exception using
        errcode = '22023',
        message = 'every menu_items entry requires id';
    end if;
    if v_menu_item_id_map ? v_requested_menu_item_id::text then
      raise exception using
        errcode = '22023',
        message = 'menu_items ids must be unique within a payload';
    end if;
    if v_menu_item_sort_order is null then
      raise exception using
        errcode = '22023',
        message = 'every menu_items entry requires sort_order';
    end if;
    if v_menu_sort_order_map ? v_menu_item_sort_order::text then
      raise exception using
        errcode = '22023',
        message = 'menu_items sort_order values must be unique within a payload';
    end if;
    v_menu_sort_order_map := v_menu_sort_order_map
      || pg_catalog.jsonb_build_object(v_menu_item_sort_order::text, true);

    -- sort_order is the stable item identity inside a canonical menu version.
    -- A client-generated UUID is retained as an alias so child references can
    -- be translated without weakening the composite tenant foreign keys.
    select menu_item.id
    into v_canonical_menu_item_id
    from public.menu_items as menu_item
    where menu_item.school_id = v_school_id
      and menu_item.menu_version_id = v_menu_version_id
      and menu_item.sort_order = v_menu_item_sort_order
    for update;

    if v_canonical_menu_item_id is null then
      if exists (
        select 1
        from public.menu_items as requested_item
        where requested_item.school_id = v_school_id
          and requested_item.id = v_requested_menu_item_id
      ) then
        raise exception using
          errcode = '23505',
          message = 'requested menu_items.id already belongs to another menu or sort order';
      end if;
      v_canonical_menu_item_id := v_requested_menu_item_id;
    end if;

    insert into public.menu_items (
      id,
      school_id,
      menu_version_id,
      sort_order,
      display_name,
      normalized_name,
      category,
      preparation_method,
      standard_portion_g,
      weight_basis,
      status,
      provenance
    ) values (
      v_canonical_menu_item_id,
      v_school_id,
      v_menu_version_id,
      v_menu_item_sort_order,
      v_item ->> 'display_name',
      v_item ->> 'normalized_name',
      v_item ->> 'category',
      nullif(v_item ->> 'preparation_method', ''),
      nullif(v_item ->> 'standard_portion_g', '')::integer,
      nullif(v_item ->> 'weight_basis', ''),
      coalesce(nullif(v_item ->> 'status', ''), 'proposed'),
      v_item ->> 'provenance'
    )
    on conflict on constraint menu_items_school_menu_sort_key do update set
      display_name = excluded.display_name,
      normalized_name = excluded.normalized_name,
      category = excluded.category,
      preparation_method = excluded.preparation_method,
      standard_portion_g = excluded.standard_portion_g,
      weight_basis = excluded.weight_basis,
      status = excluded.status,
      provenance = excluded.provenance
    returning id into v_canonical_menu_item_id;

    v_menu_item_id_map := v_menu_item_id_map
      || pg_catalog.jsonb_build_object(
        v_requested_menu_item_id::text,
        v_canonical_menu_item_id::text
      );

    v_menu_item_ids := v_menu_item_ids
      || pg_catalog.jsonb_build_array(v_canonical_menu_item_id);
  end loop;

  -- Persist the operational summary before the optional one-to-one batch link.
  -- Any later batch or child failure still rolls this upsert back because the
  -- complete function call is one PostgreSQL transaction statement.
  insert into public.meal_records (
    id,
    school_id,
    class_id,
    served_on,
    meal_period,
    staple,
    main_dish,
    side_dishes,
    menu_signature,
    planned_people,
    actual_people,
    total_supply_g,
    leftover_g,
    measurement_method,
    notes,
    source,
    created_by,
    created_at,
    updated_at
  ) values (
    v_meal_record_id,
    v_school_id,
    v_meal_class_id,
    v_meal_served_on,
    v_record_meal_period,
    v_meal_record ->> 'staple',
    v_meal_record ->> 'main_dish',
    array(
      select pg_catalog.jsonb_array_elements_text(
        v_meal_record -> 'side_dishes'
      )
    ),
    v_meal_record ->> 'menu_signature',
    (v_meal_record ->> 'planned_people')::integer,
    (v_meal_record ->> 'actual_people')::integer,
    v_meal_total_supply_g,
    v_meal_leftover_g,
    v_meal_record ->> 'measurement_method',
    coalesce(v_meal_record ->> 'notes', ''),
    v_meal_record ->> 'source',
    auth.uid(),
    coalesce(
      nullif(v_meal_record ->> 'created_at', '')::timestamptz,
      pg_catalog.now()
    ),
    coalesce(
      nullif(v_meal_record ->> 'updated_at', '')::timestamptz,
      pg_catalog.now()
    )
  )
  on conflict (school_id, id) do update set
    class_id = excluded.class_id,
    served_on = excluded.served_on,
    meal_period = excluded.meal_period,
    staple = excluded.staple,
    main_dish = excluded.main_dish,
    side_dishes = excluded.side_dishes,
    menu_signature = excluded.menu_signature,
    planned_people = excluded.planned_people,
    actual_people = excluded.actual_people,
    total_supply_g = excluded.total_supply_g,
    leftover_g = excluded.leftover_g,
    measurement_method = excluded.measurement_method,
    notes = excluded.notes,
    source = excluded.source,
    updated_at = excluded.updated_at
  returning id into v_meal_record_id;

  insert into public.meal_batches (
    id,
    school_id,
    client_case_id,
    payload_hash,
    audit_payload,
    meal_record_id,
    menu_version_id,
    class_id,
    service_date,
    meal_period,
    status,
    planned_people,
    notified_people,
    actual_people,
    planned_supply_g,
    produced_weight_g,
    delivered_weight_g,
    served_weight_g,
    weight_basis,
    provenance
  ) values (
    v_meal_batch_id,
    v_school_id,
    v_client_case_id,
    v_payload_hash,
    coalesce(payload -> 'audit_payload', '{}'::jsonb),
    v_meal_record_id,
    v_menu_version_id,
    nullif(v_batch ->> 'class_id', '')::uuid,
    v_batch_service_date,
    v_batch_meal_period,
    coalesce(nullif(v_batch ->> 'status', ''), 'planned'),
    (v_batch ->> 'planned_people')::integer,
    nullif(v_batch ->> 'notified_people', '')::integer,
    nullif(v_batch ->> 'actual_people', '')::integer,
    (v_batch ->> 'planned_supply_g')::integer,
    nullif(v_batch ->> 'produced_weight_g', '')::integer,
    nullif(v_batch ->> 'delivered_weight_g', '')::integer,
    nullif(v_batch ->> 'served_weight_g', '')::integer,
    v_batch ->> 'weight_basis',
    v_batch ->> 'provenance'
  )
  on conflict (school_id, client_case_id) do update set
    payload_hash = excluded.payload_hash,
    audit_payload = excluded.audit_payload,
    meal_record_id = excluded.meal_record_id,
    menu_version_id = excluded.menu_version_id,
    class_id = excluded.class_id,
    service_date = excluded.service_date,
    meal_period = excluded.meal_period,
    status = excluded.status,
    planned_people = excluded.planned_people,
    notified_people = excluded.notified_people,
    actual_people = excluded.actual_people,
    planned_supply_g = excluded.planned_supply_g,
    produced_weight_g = excluded.produced_weight_g,
    delivered_weight_g = excluded.delivered_weight_g,
    served_weight_g = excluded.served_weight_g,
    weight_basis = excluded.weight_basis,
    provenance = excluded.provenance
  returning id into v_meal_batch_id;

  -- Only batch-owned children are replaced. Menu items remain version-owned
  -- and are upserted by stable IDs so another class can reuse the same menu.
  delete from public.human_decisions
  where school_id = v_school_id
    and meal_batch_id = v_meal_batch_id;
  delete from public.feedback_events
  where school_id = v_school_id
    and meal_batch_id = v_meal_batch_id;
  delete from public.waste_measurements
  where school_id = v_school_id
    and meal_batch_id = v_meal_batch_id;
  delete from public.meal_contexts
  where school_id = v_school_id
    and meal_batch_id = v_meal_batch_id;

  for v_item in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_contexts) as entry(value)
  loop
    v_child_id := nullif(v_item ->> 'id', '')::uuid;
    if v_child_id is null then
      raise exception using
        errcode = '22023',
        message = 'every contexts entry requires a UUID id';
    end if;

    insert into public.meal_contexts (
      id,
      school_id,
      meal_batch_id,
      context_type,
      context_value,
      observed_at,
      status,
      source_reference,
      provenance
    ) values (
      v_child_id,
      v_school_id,
      v_meal_batch_id,
      v_item ->> 'context_type',
      v_item -> 'context_value',
      coalesce(
        nullif(v_item ->> 'observed_at', '')::timestamptz,
        pg_catalog.now()
      ),
      coalesce(nullif(v_item ->> 'status', ''), 'recorded'),
      nullif(v_item ->> 'source_reference', ''),
      v_item ->> 'provenance'
    );

    v_context_ids := v_context_ids
      || pg_catalog.jsonb_build_array(v_child_id);
  end loop;

  for v_item in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_feedback) as entry(value)
  loop
    v_child_id := nullif(v_item ->> 'id', '')::uuid;
    if v_child_id is null then
      raise exception using
        errcode = '22023',
        message = 'every feedback entry requires a UUID id';
    end if;
    v_client_menu_item_id := nullif(v_item ->> 'menu_item_id', '')::uuid;
    if v_client_menu_item_id is null then
      v_canonical_menu_item_id := null;
    elsif not (v_menu_item_id_map ? v_client_menu_item_id::text) then
      raise exception using
        errcode = '22023',
        message = 'feedback.menu_item_id must reference a menu item in the payload';
    else
      v_canonical_menu_item_id :=
        (v_menu_item_id_map ->> v_client_menu_item_id::text)::uuid;
    end if;

    insert into public.feedback_events (
      id,
      school_id,
      meal_batch_id,
      menu_item_id,
      actor_role,
      reason_code,
      rating,
      response_count,
      note,
      status,
      provenance
    ) values (
      v_child_id,
      v_school_id,
      v_meal_batch_id,
      v_canonical_menu_item_id,
      v_item ->> 'actor_role',
      v_item ->> 'reason_code',
      nullif(v_item ->> 'rating', '')::smallint,
      coalesce(nullif(v_item ->> 'response_count', '')::integer, 1),
      coalesce(v_item ->> 'note', ''),
      coalesce(nullif(v_item ->> 'status', ''), 'submitted'),
      v_item ->> 'provenance'
    );

    v_feedback_ids := v_feedback_ids
      || pg_catalog.jsonb_build_array(v_child_id);
  end loop;

  for v_item in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_measurements) as entry(value)
  loop
    v_child_id := nullif(v_item ->> 'id', '')::uuid;
    if v_child_id is null then
      raise exception using
        errcode = '22023',
        message = 'every measurements entry requires a UUID id';
    end if;
    v_client_menu_item_id := nullif(v_item ->> 'menu_item_id', '')::uuid;
    if v_client_menu_item_id is null then
      v_canonical_menu_item_id := null;
    elsif not (v_menu_item_id_map ? v_client_menu_item_id::text) then
      raise exception using
        errcode = '22023',
        message = 'measurements.menu_item_id must reference a menu item in the payload';
    else
      v_canonical_menu_item_id :=
        (v_menu_item_id_map ->> v_client_menu_item_id::text)::uuid;
    end if;

    insert into public.waste_measurements (
      id,
      school_id,
      meal_batch_id,
      menu_item_id,
      waste_source,
      measurement_method,
      weight_state,
      net_weight_g,
      tare_weight_g,
      gross_weight_g,
      estimate_low_g,
      estimate_high_g,
      contamination_g,
      sample_plate_count,
      measured_at,
      status,
      provenance,
      note
    ) values (
      v_child_id,
      v_school_id,
      v_meal_batch_id,
      v_canonical_menu_item_id,
      v_item ->> 'waste_source',
      v_item ->> 'measurement_method',
      v_item ->> 'weight_state',
      (v_item ->> 'net_weight_g')::integer,
      nullif(v_item ->> 'tare_weight_g', '')::integer,
      nullif(v_item ->> 'gross_weight_g', '')::integer,
      nullif(v_item ->> 'estimate_low_g', '')::integer,
      nullif(v_item ->> 'estimate_high_g', '')::integer,
      coalesce(nullif(v_item ->> 'contamination_g', '')::integer, 0),
      nullif(v_item ->> 'sample_plate_count', '')::integer,
      coalesce(
        nullif(v_item ->> 'measured_at', '')::timestamptz,
        pg_catalog.now()
      ),
      coalesce(nullif(v_item ->> 'status', ''), 'recorded'),
      v_item ->> 'provenance',
      coalesce(v_item ->> 'note', '')
    );

    v_measurement_ids := v_measurement_ids
      || pg_catalog.jsonb_build_array(v_child_id);
  end loop;

  if v_human_decision is not null
    and v_human_decision <> 'null'::jsonb
  then
    v_human_decision_id :=
      nullif(v_human_decision ->> 'id', '')::uuid;
    if v_human_decision_id is null then
      raise exception using
        errcode = '22023',
        message = 'human_decision.id must be a UUID';
    end if;

    insert into public.human_decisions (
      id,
      school_id,
      recommendation_kind,
      recommendation_key,
      prediction_id,
      meal_batch_id,
      decision,
      decided_by_role,
      decided_supply_g,
      safety_margin_g,
      rationale,
      status,
      provenance,
      decided_at
    ) values (
      v_human_decision_id,
      v_school_id,
      v_human_decision ->> 'recommendation_kind',
      v_human_decision ->> 'recommendation_key',
      nullif(v_human_decision ->> 'prediction_id', ''),
      v_meal_batch_id,
      v_human_decision ->> 'decision',
      nullif(v_human_decision ->> 'decided_by_role', ''),
      nullif(v_human_decision ->> 'decided_supply_g', '')::integer,
      coalesce(
        nullif(v_human_decision ->> 'safety_margin_g', '')::integer,
        0
      ),
      v_human_decision ->> 'rationale',
      coalesce(nullif(v_human_decision ->> 'status', ''), 'active'),
      v_human_decision ->> 'provenance',
      coalesce(
        nullif(v_human_decision ->> 'decided_at', '')::timestamptz,
        pg_catalog.now()
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'school_id', v_school_id,
    'client_case_id', v_client_case_id,
    'menu_version_id', v_menu_version_id,
    'meal_record_id', v_meal_record_id,
    'meal_batch_id', v_meal_batch_id,
    'menu_item_ids', v_menu_item_ids,
    'context_ids', v_context_ids,
    'feedback_ids', v_feedback_ids,
    'measurement_ids', v_measurement_ids,
    'human_decision_id', v_human_decision_id
  );
end;
$function$;

comment on function public.save_meal_evidence_chain(jsonb) is
  'Atomically replaces one school meal batch evidence aggregate. Stable client_case_id and child UUIDs make network retries duplicate-safe.';

revoke all on function public.save_meal_evidence_chain(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_meal_evidence_chain(jsonb)
to authenticated;
