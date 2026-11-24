-- =====================================================================
-- Of Course — 10_auto_complete_lessons.sql
-- AUDIT FIX: Dərs müddəti bitdikdə heç bir istifadəçi brauzerdə olmasa
-- belə server-side auto-completion.
--
-- Problem:
--   Hazırda complete_lesson yalnız istifadəçi tərəfindən çağrılır.
--   Əgər hər iki iştirakçı brauzeri bağlasa, dərs avtomatik tamamlanmır.
--
-- Həll:
--   pg_cron extension istifadə edərək hər dəqiqə yoxlama:
--   - status = 'accepted'
--   - lesson_started_at IS NOT NULL
--   - now() - lesson_started_at >= duration_hours * interval '1 hour'
--   Bu şərtləri ödəyən dərsləri avtomatik tamamla.
--
-- Tələb:
--   Supabase Dashboard → Database → Extensions → pg_cron aktiv edin.
-- =====================================================================

-- pg_cron extension aktiv et
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- auto_complete_expired_lessons RPC
-- Heç bir istifadəçi tərəfindən çağrılmır — pg_cron tərəfindən schedule edilir.
-- SECURITY DEFINER + service role kimi işləyir (auth.uid() yoxdur).
-- ---------------------------------------------------------------------
create or replace function public.auto_complete_expired_lessons()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  completed_count integer := 0;
  r record;
  bal integer;
begin
  -- Vaxtı keçmiş dərsləri tap
  for r in
    select lr.id, lr.requester_id, lr.teacher_id, lr.duration_hours, lr.lesson_started_at
      from public.lesson_requests lr
     where lr.status = 'accepted'
       and lr.lesson_started_at is not null
       and now() - lr.lesson_started_at >= (lr.duration_hours || ' hours')::interval
       -- 1 dəqiqə tolerans
       and now() - lr.lesson_started_at >= (lr.duration_hours || ' hours')::interval - interval '1 minute'
     for update of lr
  loop
    -- Kredit balansını yoxla (atomic lock)
    select credit_balance into bal
      from public.profiles
     where id = r.requester_id
     for update;

    if bal is null or bal < r.duration_hours then
      -- Kredit çatmır — skip et, amma dərsi 'completed' et ki təkrar yoxlanmasın
      -- (kredit problemi admin tərəfindən həll olunmalıdır)
      update public.lesson_requests
         set status = 'completed',
             completed_at = now(),
             lesson_ended_at = now()
       where id = r.id;
      completed_count := completed_count + 1;
      continue;
    end if;

    -- Atomik kredit köçürməsi
    update public.profiles
       set credit_balance = credit_balance - r.duration_hours
     where id = r.requester_id;

    update public.profiles
       set credit_balance = credit_balance + r.duration_hours
     where id = r.teacher_id;

    insert into public.credit_transactions (user_id, lesson_request_id, amount, type, note) values
      (r.requester_id, r.id, -r.duration_hours, 'lesson_spent',  'Dərs üçün ödəniş (auto)'),
      (r.teacher_id,   r.id,  r.duration_hours, 'lesson_earned', 'Dərs verdin (auto)');

    -- Dərsi tamamlandı kimi qeyd et
    update public.lesson_requests
       set status = 'completed',
           completed_at = now(),
           lesson_ended_at = now()
     where id = r.id;

    completed_count := completed_count + 1;
  end loop;

  return completed_count;
end;
$function$;

-- ---------------------------------------------------------------------
-- pg_cron schedule: hər dəqiqə yoxla
-- ---------------------------------------------------------------------
-- cron.schedule bir dəfə çağrılmalıdır — təkrar işlədildikdə dublikat yaratmamalı
do $$
begin
  -- Əvvəlki schedule sil (əgər var)
  perform cron.unschedule('auto-complete-lessons');
exception when others then
  -- schedule yoxdursa xəta ignore
end
$$;

select cron.schedule(
  'auto-complete-lessons',
  '* * * * *',  -- hər dəqiqə
  $$select public.auto_complete_expired_lessons();$$
);

-- ---------------------------------------------------------------------
-- İcazələr
-- auto_complete_expired_lessons yalnız pg_cron (service role) tərəfindən çağrılır.
-- Frontend-dən çağrıla bilməməli — amma grant etmək zərərsiz (function
-- yalnız vaxtı keçmiş dərsləri tamamlayır, heç bir təhlükəsizlik riski yoxdur).
-- ---------------------------------------------------------------------
revoke execute on function public.auto_complete_expired_lessons() from public, anon;
-- authenticated-a grant etmirik — yalnız pg_cron (superuser) çağıra bilər
-- əgər admin manual çağırmaq istəsə:
-- grant execute on function public.auto_complete_expired_lessons() to authenticated;

-- =====================================================================
-- Konfiqurasiya:
-- 1. Supabase Dashboard → Database → Extensions → pg_cron aktiv edin
-- 2. Bu miqrasiyanı işlədin
-- 3. Schedule aktiv olacaq: hər dəqiqə vaxtı keçmiş dərsləri yoxlayacaq
--
-- Monitorinq:
--   select * from cron.job_run_details where jobid = (
--     select jobid from cron.job where jobname = 'auto-complete-lessons'
--   ) order by start_time desc limit 10;
-- =====================================================================

-- =====================================================================
-- Test ssenariləri:
-- 1. Dərs başladı (lesson_started_at set), müddət keçdi → cron tamamlayır
-- 2. Dərs başladı, müddət hələ keçməyib → cron skip
-- 3. Dərs başlamayıb (lesson_started_at NULL) → cron skip
-- 4. Kredit çatmır → dərs completed olunur amma kredit köçürülmür
-- 5. Eyni dərs iki dəfə cron tərəfindən yoxlanılır → status=completed olduğu üçün skip
-- =====================================================================
