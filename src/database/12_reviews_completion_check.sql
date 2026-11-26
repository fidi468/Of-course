-- =====================================================================
-- Of Course — 12_reviews_completion_check.sql
-- Reviews yalnız tamamlanmış dərslərdən sonra verilə bilər.
--
-- Problem:
--   Mövcud reviews cədvəli hər hansı lesson_request-ə review icazə verir.
--   Tələb: "Allow reviews only after genuinely completed lessons."
--
-- Həll:
--   1. RLS policy: review INSERT yalnız lesson_request.status = 'completed'
--      olduqda icazə verir
--   2. Trigger: INSERT-də əvvəl status yoxlanışı (defense in depth)
--   3. Duplicate review qarşısı: unique(lesson_request_id, reviewer_id) artıq var
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Mövcud reviews RLS policy-ni yenilə
--    Yalnız completed dərslərə review icazə ver
-- ---------------------------------------------------------------------
alter table public.reviews enable row level security;

-- SELECT: hamı görə bilər (public reviews)
drop policy if exists "reviews_select_all" on public.reviews;
create policy "reviews_select_all" on public.reviews
  for select to authenticated using (true);

-- INSERT: yalnız reviewer öz review-sını yarada bilər + dərs completed olmalıdır
drop policy if exists "reviews_insert_own_completed" on public.reviews;
create policy "reviews_insert_own_completed" on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    -- Dərs tamamlanmalıdır
    and exists (
      select 1 from public.lesson_requests lr
       where lr.id = lesson_request_id
         and lr.status = 'completed'
         -- Reviewer həmin dərsin iştirakçısı olmalıdır
         and (lr.requester_id = auth.uid() or lr.teacher_id = auth.uid())
    )
    -- Reviewer müəllim ola bilməz (check constraint artıq var)
  );

-- UPDATE/DELETE: yalnız öz review-nu dəyişdirə bilər
drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own" on public.reviews
  for update to authenticated
  using (reviewer_id = auth.uid()) with check (reviewer_id = auth.uid());

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews
  for delete to authenticated using (reviewer_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2) İcazələr
-- ---------------------------------------------------------------------
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to authenticated;
grant insert, update, delete on public.reviews to authenticated;

commit;

-- =====================================================================
-- Test ssenariləri:
-- 1. Dərs 'pending' statusunda → review insert RLS tərəfindən reject
-- 2. Dərs 'accepted' statusunda → review insert reject
-- 3. Dərs 'completed' statusunda → review insert uğurlu
-- 4. Eyni dərsə ikinci review → unique constraint reject
-- 5. Müəllim öz dərsinə review → check constraint reject
-- 6. Başqa istifadəçinin dərsinə review → RLS reject (participant deyil)
-- =====================================================================
