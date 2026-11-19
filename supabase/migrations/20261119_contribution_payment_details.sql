-- Extra M-Pesa callback details used by the contribution confirmation screen.
-- Safe to run on an existing database; does not delete or rewrite contributions.
alter table public.contributions
  add column if not exists amount_paid numeric(12,2),
  add column if not exists mpesa_phone text;
