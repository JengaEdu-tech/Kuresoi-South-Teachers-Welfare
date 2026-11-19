-- Apply this ONLY if you already ran the original starter schema.
-- Adds the shared teacher directory and lets any active school member manage it.

create table if not exists public.school_teachers (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 full_name text not null check(length(trim(full_name)) between 2 and 140),
 phone text,
 position_title text not null default 'Teacher',
 institution_section text not null check(institution_section in ('ECDE','Primary','Junior School','Secondary')),
 linked_user_id uuid references public.profiles(id) on delete set null,
 added_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists school_teachers_school_name_idx on public.school_teachers(school_id, full_name);

alter table public.school_teachers enable row level security;
revoke all on public.school_teachers from anon, authenticated;
grant select, insert, update, delete on public.school_teachers to authenticated;

drop policy if exists "School members read teacher directory" on public.school_teachers;
drop policy if exists "Any school member adds teachers" on public.school_teachers;
drop policy if exists "Any school member edits teachers" on public.school_teachers;
drop policy if exists "Any school member removes teachers" on public.school_teachers;
create policy "School members read teacher directory" on public.school_teachers for select to authenticated
using(public.is_school_member(school_id) or public.has_role(array['super_admin','welfare_admin','county_admin']::public.member_role[]));
create policy "Any school member adds teachers" on public.school_teachers for insert to authenticated
with check(public.is_school_member(school_id) and added_by=auth.uid());
create policy "Any school member edits teachers" on public.school_teachers for update to authenticated
using(public.is_school_member(school_id)) with check(public.is_school_member(school_id));
create policy "Any school member removes teachers" on public.school_teachers for delete to authenticated
using(public.is_school_member(school_id));

-- Allow any teacher to join an approved school without waiting for a school admin.
drop policy if exists "Teachers request school membership" on public.school_memberships;
drop policy if exists "Teachers join approved schools" on public.school_memberships;
create policy "Teachers join approved schools" on public.school_memberships for insert to authenticated
with check(user_id=auth.uid() and membership_status='active' and exists(
 select 1 from public.schools s where s.id=school_id and s.status='approved'
));
