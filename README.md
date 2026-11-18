# Kuresoi South Teachers Welfare Group — starter

This is the first implementation scaffold for a multi-school teacher welfare and fundraiser platform.

## Included
- Mobile-first public landing page and fundraiser/school directory.
- Supabase email/password authentication.
- Teacher profile creation.
- School registration with pending approval.
- Fundraiser listing and contribution form.
- Database schema with role model and Row Level Security.
- Supabase Edge Function starter for Daraja STK Push and callback processing.

## Not yet production-ready
This is a starter, not a deployed or live payment system. Before collecting real money:
1. Review and test all SQL/RLS policies with separate anonymous, teacher, school-admin and welfare-admin accounts.
2. Complete the public, consent-aware school contribution report (paid and pending names should only be shown according to a clear privacy notice and consent).
3. Add administrator screens for school approval, roles, fundraiser creation, school targets and reports.
4. Add fraud controls, rate limits, callback reconciliation, duplicate callback handling, payment reversal/refund workflow and monitoring.
5. Complete Safaricom Daraja production onboarding and test with sandbox credentials.
6. Obtain appropriate privacy, data protection and financial/legal review.

## Setup
1. Create a NEW Supabase project for this welfare platform. Do not mix it with academic school records.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Create an account through the site, then find its UUID in Authentication > Users. Promote only the trusted platform owner using the one-time SQL statement at the bottom of `schema.sql`.
4. In Project Settings / API, copy the Project URL and publishable key (or legacy anon key) into `app.js`. These are browser values; never use a secret/service-role key in the browser.
5. Deploy the two Edge Functions using the Supabase CLI.
6. Add Edge Function secrets in Supabase:
   - `SUPABASE_URL` (normally injected by Supabase)
   - `SUPABASE_ANON_KEY` (if required by the function runtime; use the publishable/anon key)
   - `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
   - `DARAJA_CONSUMER_KEY`
   - `DARAJA_CONSUMER_SECRET`
   - `DARAJA_SHORTCODE`
   - `DARAJA_PASSKEY`
   - `DARAJA_CALLBACK_URL`
   - `DARAJA_ENV` = `sandbox` or `production`
   - `DARAJA_TRANSACTION_TYPE` = `CustomerPayBillOnline` or the transaction type approved for your shortcode
7. Set the Daraja callback URL to the deployed `mpesa-callback` function URL.
8. Host the static frontend on GitHub Pages or another HTTPS host.

## Important
- Never commit `.env`, M-Pesa keys, Supabase secret keys or service-role keys to GitHub.
- Payment status is set to paid only by the server callback, not by a browser action.
- STK Push requires a valid Daraja app, shortcode, passkey and approved callback URL.
- The sample UI uses the Supabase JS CDN. Pin a tested library version before production.
- For nationwide deployment, add backup/export, monitoring, admin MFA, audit-log write paths and a support process.


## Open school directory
- No central school-registration approval queue.
- Any signed-in user can add a school; it appears immediately.
- Any signed-in user can remove a school from the public directory.
- Removal is a soft delete (`status = suspended`) so fundraiser and contribution history is preserved.
- Public visitors can browse approved schools; sign-in is required to add or remove a school.
- Existing database: run `supabase/migrations/20261118_open_school_directory.sql`.
- New database: run the updated `supabase/schema.sql`.


## Supabase connection
This project is preconfigured to use the Kuresoi South Teachers Welfare Group Supabase project.
The browser app uses the project's publishable key in `app.js`. Never put a Supabase secret/service-role key in browser code or GitHub.

## Updating an existing database
Do not rerun `supabase/schema.sql` on a database that already has its tables and enum types. For an existing database, use the safe update SQL prepared for this project and review/back up the database before applying schema changes. Apply the two migration files only if they have not already been applied.
