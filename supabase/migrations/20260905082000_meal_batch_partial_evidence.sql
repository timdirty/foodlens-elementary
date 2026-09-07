-- A closed classroom meal does not prove that every upstream supply-chain
-- stage was measured. Keep unknown planning, production, and delivery values
-- null instead of copying the classroom supply weight into all three fields.

alter table public.meal_batches
  alter column planned_supply_g drop not null;

alter table public.meal_batches
  drop constraint meal_batches_status_evidence_check;

alter table public.meal_batches
  add constraint meal_batches_status_evidence_check check (
    (status <> 'prepared' or produced_weight_g is not null)
    and (status <> 'delivered' or delivered_weight_g is not null)
    and (
      status <> 'closed'
      or (actual_people is not null and served_weight_g is not null)
    )
  );

comment on column public.meal_batches.planned_supply_g is
  'The recorded pre-service plan, when available. Null means the plan was not observed; it must never be inferred from delivered or served weight.';
comment on column public.meal_batches.produced_weight_g is
  'Caterer production evidence when actually reported; null is an explicit unknown.';
comment on column public.meal_batches.delivered_weight_g is
  'Delivery-stage evidence when actually reported; null is an explicit unknown.';
