# Kuresoi South Teachers Welfare Group

Mobile-first welfare contribution website for teachers and schools.

## Easier contribution flow
1. Create an account or sign in.
2. Find your school in **Find your school** and tap **Join**.
3. Open a fundraiser and tap **Contribute**.
4. Your joined school is selected automatically; check your M-Pesa phone number.
5. Tap a suggested amount or enter a different amount.
6. Tap **Pay with M-Pesa** and enter your PIN when the STK prompt arrives.
7. Use **Check payment status** to see whether Safaricom has confirmed the payment.

The website does not mark a contribution as paid. Only the server-side M-Pesa callback does that.

## Supabase Free plan / Edge Functions
This project uses Supabase Edge Functions and does not require a paid third-party function host. The Supabase Free plan has usage limits; check the current Supabase pricing/usage page for your project's limits. Safaricom Daraja production payments may have separate onboarding or transaction costs.

### Database setup
- For a new database, run `supabase/schema-sql` in the Supabase SQL Editor. The new schema already includes the payment detail columns.
- For an existing database, do not rerun the full schema. Run `supabase/migration/20261119_contribution_payment_details.sql` once (and any other unapplied migrations you need).
- Back up your database before applying SQL.

### Browser configuration
`app.js` contains the Supabase project URL and publishable/anon key. These are browser-safe values. Never place a service-role key or Daraja credentials in `app.js` or GitHub.

### Deploy Edge Functions
The deployable function folders are:
- `supabase/functions/start-stk-push`
- `supabase/functions/mpesa-callback`

Using Supabase CLI from the project folder:
```bash
supabase login
supabase link --project-ref saubnyqwfwysldoenfmx
supabase functions deploy start-stk-push
supabase functions deploy mpesa-callback --no-verify-jwt
```

The callback is public because Safaricom calls it without a user login. The STK Push function requires a signed-in user.

### Edge Function secrets
Set these in Supabase Dashboard → Edge Functions → Secrets (or with the CLI):
- `DARAJA_CONSUMER_KEY`
- `DARAJA_CONSUMER_SECRET`
- `DARAJA_SHORTCODE`
- `DARAJA_PASSKEY`
- `DARAJA_CALLBACK_URL` = `https://saubnyqwfwysldoenfmx.supabase.co/functions/v1/mpesa-callback`
- `DARAJA_ENV` = `sandbox` while testing, then `production` after approval
- `DARAJA_TRANSACTION_TYPE` = the transaction type approved for your shortcode (the code defaults to `CustomerPayBillOnline`)

Supabase normally injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into Edge Functions. If the project runtime does not expose `SUPABASE_ANON_KEY`, add the project's publishable/anon key as an Edge Function secret named `SUPABASE_ANON_KEY`. Never expose the service-role key.

### Important before collecting real money
- Test with Daraja sandbox first.
- Confirm the callback URL is exactly the deployed `mpesa-callback` URL.
- Confirm the shortcode, passkey and transaction type match your Daraja product.
- Review database Row Level Security and admin access.
- Use production only after Safaricom has approved the Daraja application.

## Hosting
Deploy the static site to GitHub Pages or another HTTPS host. Keep all secret keys out of the repository.
