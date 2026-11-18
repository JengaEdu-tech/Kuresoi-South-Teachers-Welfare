-- Kuresoi South Teachers Welfare Group: open school directory.
-- Run if the original starter schema is already installed.
-- New schools are immediately approved; removal is a soft delete to preserve history.
grant select, insert on public.schools to authenticated;
grant update(status) on public.schools to authenticated;
drop policy if exists "Signed-in users can propose schools" on public.schools;
drop policy if exists "Any signed-in user can add a school" on public.schools;
drop policy if exists "Any signed-in user can remove a school from directory" on public.schools;
create policy "Any signed-in user can add a school" on public.schools for insert to authenticated
with check (status='approved' and created_by=auth.uid());
create policy "Any signed-in user can remove a school from directory" on public.schools for update to authenticated
using (status='approved') with check (status='suspended');
drop policy if exists "Public can see approved schools" on public.schools;
create policy "Public can see approved schools" on public.schools for select to anon, authenticated using (status='approved');
