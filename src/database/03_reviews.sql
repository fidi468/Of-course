-- =====================================================================
-- Of Course - 03_reviews.sql (IXTİYARİ / OPTIONAL)
-- Profil səhifəsindəki "Son rəylər" bölməsi üçün rəy cədvəli.
--
-- Bu fayl İXTİYARİDİR: işlətməsən, profil səhifəsi normal işləyir,
-- sadəcə rəylər bölməsi boş vəziyyət göstərir.
--
-- İşlədilmə: Supabase Dashboard → SQL Editor → bu faylın məzmununu
-- yapışdır və Run. Təkrar işlətmək təhlükəsizdir (IF NOT EXISTS).
-- =====================================================================

create table if not exists public.reviews (
  id                bigint generated always as identity primary key,
  lesson_request_id bigint not null references public.lesson_requests(id) on delete cascade,
  reviewer_id       uuid   not null references public.profiles(id) on delete cascade,
  teacher_id        uuid   not null references public.profiles(id) on delete cascade,
  rating            integer not null check (rating between 1 and 5),
  comment           text,
  created_at        timestamptz not null default now(),
  unique (lesson_request_id, reviewer_id),
  check (reviewer_id <> teacher_id)
);

create index if not exists reviews_teacher_idx on public.reviews (teacher_id, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists "reviews_select" on public.reviews;
create policy "reviews_select" on public.reviews
  for select to authenticated using (true);

drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and teacher_id <> reviewer_id
  );

drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own" on public.reviews
  for update to authenticated
  using (reviewer_id = auth.uid()) with check (reviewer_id = auth.uid());

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews
  for delete to authenticated using (reviewer_id = auth.uid());

revoke all on public.reviews from anon, authenticated;

grant select, insert, update, delete on public.reviews to authenticated;
