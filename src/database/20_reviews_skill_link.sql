-- =====================================================================
-- Of Course — 20_reviews_skill_link.sql
-- Reviews ↔ Skills əlaqəsi.
--
-- Problem:
--   Profile.tsx "Son rəylər" bölməsi reviews sorğusunda `skill:skills(...)`
--   embed edir. reviews cədvəlində skill_id sütunu olmadığından PostgREST
--   "Could not find a relationship between 'reviews' and 'skills'" (PGRST200)
--   xətası verir → profil səhifəsində "reviews cədvəli yoxdur" mesajı çıxır.
--
-- Həll:
--   1. reviews cədvəlinə skill_id sütunu əlavə et (skills → FK)
--   2. lesson_requests.skill_id əsasında mövcud rəyləri backfill et
--   3. Axtarış üçün indeks
--
-- İşlədilmə: Supabase Dashboard → SQL Editor → yapışdır və Run.
-- Təkrar işlətmək təhlükəsizdir (IF NOT EXISTS / idempotent).
-- =====================================================================

alter table public.reviews
  add column if not exists skill_id bigint references public.skills(id) on delete set null;

update public.reviews r
   set skill_id = lr.skill_id
  from public.lesson_requests lr
 where lr.id = r.lesson_request_id
   and r.skill_id is null;

create index if not exists reviews_skill_idx on public.reviews (skill_id);
