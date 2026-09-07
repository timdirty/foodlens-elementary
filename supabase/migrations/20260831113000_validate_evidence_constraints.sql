-- Promote the two evidence-integrity checks from new-row protection to fully
-- validated constraints. Existing cloud projects stop here instead of silently
-- relabelling historical evidence if legacy rows still need a teacher review.
do $$
begin
  if exists (
    select 1
    from public.meal_records
    where measurement_method not in ('scale', 'manual')
  ) then
    raise exception using
      message = 'FoodLens evidence validation: legacy meal_records still use ai-estimate',
      hint = 'Review those rows and record a truthful meal-level scale or manual measurement before rerunning this migration.';
  end if;

  if exists (
    select 1
    from public.experiments
    where baseline_end >= intervention_start
  ) then
    raise exception using
      message = 'FoodLens evidence validation: an experiment baseline overlaps its intervention',
      hint = 'Correct the experiment dates before rerunning this migration.';
  end if;
end;
$$;

alter table public.meal_records
  validate constraint meal_records_measurement_is_meal_level;

alter table public.experiments
  validate constraint experiments_periods_do_not_overlap;
