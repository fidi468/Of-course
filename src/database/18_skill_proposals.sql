-- =====================================================================
-- Of Course — 18_skill_proposals.sql
-- BACARIQ TƏKLİFİ SİSTEMİ + TƏCRÜBƏ SÜTUNU
--
-- ADDITIVE migration: mövcud cədvəllərə, məlumatlara və cron job-lara
-- TOXUNMUR. Yalnız YENİ obyektlər yaradılır və user_skills-ə yeni
-- sütun əlavə olunur (məlumat silinmir, dəyişdirilmir).
--
-- Komponentlər:
--   1. user_skills.experience sütunu — SkillModals-ın "Təcrübə"
--      seçimini saxlayır (none | 6m | 1y | 2y | 3y | 4y_plus)
--   2. skill_proposals cədvəli — istifadəçilər siyahıda olmayan
--      bacarıqları admin təsdiqinə təklif edir
--   3. RLS: istifadəçi YALNIZ öz təkliflərini görür, yalnız öz
--      adına insert edə bilir; status 'pending' olmağa məcburdur
--      (client statusu dəyişə bilməz — update/delete policy yoxdur,
--       admin əməliyyatları service_role ilə aparılır)
--   4. is_admin = true olan istifadəçi bütün təklifləri görür
--
-- İDEMPOTENT: təkrar icra oluna bilər (if not exists / drop if exists).
-- İşlədilmə: Supabase Dashboard → SQL Editor → bu faylın məzmununu
-- yapışdır və Run. Yaxud Management API /database/query ilə hissə-hissə.
-- =====================================================================

-- 1) user_skills.experience — təcrübə sütunu (mövcud sətirlər 'none' alır)
alter table public.user_skills
  add column if not exists experience text default 'none'
  check (experience in ('none','6m','1y','2y','3y','4y_plus'));

-- STATEMENT --

-- 2) skill_proposals cədvəli
create table if not exists public.skill_proposals (
  id          bigint generated always as identity primary key,
  proposed_by uuid   not null references public.profiles(id) on delete cascade,
  name        text   not null check (length(trim(name)) between 1 and 80),
  category    text   not null check (length(category) between 1 and 60),
  description text,
  status      text   not null default 'pending'
              check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now()
);

-- STATEMENT --

create index if not exists skill_proposals_status_idx
  on public.skill_proposals (status, created_at desc);

create index if not exists skill_proposals_proposer_idx
  on public.skill_proposals (proposed_by, created_at desc);

-- STATEMENT --

-- 3) RLS aktivləşdirilir
alter table public.skill_proposals enable row level security;

-- STATEMENT --

-- Select: istifadəçi yalnız öz təkliflərini, admin hamısını görür
drop policy if exists "skill_proposals_select" on public.skill_proposals;
create policy "skill_proposals_select" on public.skill_proposals
  for select to authenticated
  using (
    proposed_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

-- STATEMENT --

-- Insert: istifadəçi yalnız öz adına, status 'pending' ilə yarada bilir
drop policy if exists "skill_proposals_insert_own" on public.skill_proposals;
create policy "skill_proposals_insert_own" on public.skill_proposals
  for insert to authenticated
  with check (
    proposed_by = auth.uid()
    and status = 'pending'
  );

-- STATEMENT --

-- Update / Delete: client üçün policy YOXDUR — status yalnız
-- service_role (admin backend) ilə dəyişə bilər

-- 4) İcazələr: anon qadağan, authenticated yalnız select + insert
revoke all on public.skill_proposals from anon, authenticated;

grant select, insert on public.skill_proposals to authenticated;

-- STATEMENT --

-- 5) PostgREST sxem keşini yenilə (yeni sütun/cədvəl dərhal görünür)
notify pgrst, 'reload schema';
