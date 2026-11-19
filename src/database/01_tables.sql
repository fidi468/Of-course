drop table if exists public.credit_transactions, public.lesson_requests,
                     public.user_skills, public.skills, public.profiles cascade;
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null default '',
  bio            text,
  avatar_url     text,
  university     text,
  credit_balance integer not null default 0 check (credit_balance >= 0),
  plan           text not null default 'free' check (plan in ('free','go','plus','pro')),
  is_admin       boolean not null default false,
  created_at     timestamptz not null default now()
);
create table public.skills (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  category   text not null,
  created_at timestamptz not null default now()
);
create table public.user_skills (
  id          bigint generated always as identity primary key,
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  skill_id    bigint not null references public.skills(id)   on delete cascade,
  type        text   not null check (type in ('teach','learn')),
  level       text   check (level in ('beginner','intermediate','advanced')),
  description text,
  created_at  timestamptz not null default now(),
  unique (user_id, skill_id, type)
);
create table public.lesson_requests (
  id             bigint generated always as identity primary key,
  requester_id   uuid   not null references public.profiles(id),
  teacher_id     uuid   not null references public.profiles(id),
  skill_id       bigint not null references public.skills(id),
  duration_hours integer not null default 1 check (duration_hours between 1 and 4),
  message        text,
  scheduled_at   timestamptz,
  status         text not null default 'pending'
                 check (status in ('pending','accepted','rejected','completed','cancelled')),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  check (requester_id <> teacher_id)
);
create table public.credit_transactions (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  lesson_request_id bigint references public.lesson_requests(id),
  amount            integer not null check (amount <> 0),
  type              text not null check (type in
                    ('signup_bonus','lesson_earned','lesson_spent','subscription','referral','expired','adjustment')),
  note              text,
  created_at        timestamptz not null default now()
);
create index on public.user_skills (skill_id);
create index on public.lesson_requests (teacher_id, status);
create index on public.lesson_requests (requester_id);
create index on public.credit_transactions (user_id, created_at desc);
insert into public.skills (name, category) values
  ('İngilis dili','Dil'), ('Alman dili','Dil'), ('Rus dili','Dil'),
  ('Qrafik dizayn','Dizayn'), ('UI/UX dizayn','Dizayn'),
  ('Gitara','Musiqi'), ('Piano','Musiqi'),
  ('Python','Proqramlaşdırma'), ('Veb inkişaf','Proqramlaşdırma'),
  ('Riyaziyyat','Elm');
