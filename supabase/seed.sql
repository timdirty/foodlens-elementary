-- 本檔只建立本機 Supabase 的學校與班級骨架；登入會員請在 Auth 建立後手動加入 memberships。
insert into public.schools(id,name,timezone,currency) values
('11500000-0000-4000-8000-000000000001','FoodLens 本機測試學校','Asia/Taipei','TWD')
on conflict(id) do nothing;

insert into public.classes(id,school_id,name,grade,active) values
('11500000-0000-4000-8000-000000000101','11500000-0000-4000-8000-000000000001','五年一班',5,true),
('11500000-0000-4000-8000-000000000102','11500000-0000-4000-8000-000000000001','五年二班',5,true),
('11500000-0000-4000-8000-000000000103','11500000-0000-4000-8000-000000000001','六年一班',6,true),
('11500000-0000-4000-8000-000000000104','11500000-0000-4000-8000-000000000001','六年二班',6,true)
on conflict(id) do nothing;

insert into public.impact_settings(school_id,cost_twd_per_kg,school_daily_baseline_g,school_days_per_week,weeks_per_semester,semesters_per_year,disclaimer)
values('11500000-0000-4000-8000-000000000001',80,38600,5,20,2,'本值為本機示範係數，不代表正式研究量測。')
on conflict(school_id) do nothing;
