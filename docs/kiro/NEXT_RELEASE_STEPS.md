# Next Release Steps (Credentialed / Human-Only)

Every task below requires either Supabase dashboard access, cloud provider
credentials, or human judgment that cannot be automated in CI. Complete them in
the listed order.

---

## 1. Supabase Project Access

- [ ] Confirm you can sign in to the Supabase Dashboard for the staging project
- [ ] Confirm you can sign in to the Supabase Dashboard for the production project
- [ ] Verify your account has the Owner or Admin role on both projects

---

## 2. Run Migrations on Staging

Execute in order in the SQL Editor:

| # | Migration File | Verification Query |
|---|---------------|-------------------|
| 1 | `013_invitation_hardening.sql` | `SELECT proname FROM pg_proc WHERE proname = 'redeem_invitation';` (1 row) |
| 2 | `014_feature_privacy_and_collaboration.sql` | `SELECT policyname FROM pg_policies WHERE tablename = 'schedules';` (policies exist) |
| 3 | `015_security_followup.sql` | `SELECT proname FROM pg_proc WHERE proname IN ('redeem_invitation','regenerate_invitation');` (2 rows) |

After each migration, verify with the query before proceeding to the next.

---

## 3. Reload Schema Cache (Staging)

- [ ] Dashboard > Settings > API > "Reload schema cache"
- [ ] Wait 15 seconds, then verify: `SELECT proname FROM pg_proc WHERE proname = 'redeem_invitation';` returns results via the API (not just SQL Editor)

Without this step, PostgREST returns `PGRST202` for the new RPC functions.

---

## 4. Create/Verify Storage Bucket

- [ ] Dashboard > Storage > Verify `couple-media` bucket exists
- [ ] If missing: Create bucket named `couple-media`
- [ ] Ensure **Public** is UNCHECKED (bucket must be private)
- [ ] Verify storage policies exist:
  ```sql
  SELECT policyname FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects';
  ```
  If empty, run `007_storage_policies.sql`.

---

## 5. Deploy Edge Function

**MUST** come after migration 015 is applied and schema cache is reloaded.

```bash
supabase functions deploy delete-account
```

- [ ] Confirm deployment succeeded (Dashboard > Edge Functions > delete-account shows "Active")

---

## 6. Set ALLOWED_ORIGINS Secret

```bash
supabase secrets set ALLOWED_ORIGINS="https://gomsinlog.app,https://www.gomsinlog.app"
```

- [ ] Verify in Dashboard > Edge Functions > delete-account > Secrets
- [ ] Test: `OPTIONS` request to the function URL should return CORS headers for the allowed origin

---

## 7. Verify SUPABASE_SERVICE_ROLE_KEY Injection

The `delete-account` function requires the service role key for admin operations
(deleting auth users and storage objects).

- [ ] Dashboard > Edge Functions > delete-account > Settings
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is listed as an available environment variable (Supabase injects this automatically for deployed functions)
- [ ] If missing, set it manually:
  ```bash
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"
  ```

---

## 8. Configure Google OAuth Provider

- [ ] Dashboard > Authentication > Providers > Google: Enabled
- [ ] Set Client ID and Client Secret from Google Cloud Console
- [ ] Google Cloud Console > APIs & Services > Credentials:
  - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
- [ ] Test: Sign in with Google on staging app succeeds

---

## 9. Set Redirect URLs

- [ ] Dashboard > Authentication > URL Configuration > Redirect URLs:
  ```
  https://gomsinlog.app/auth/callback
  https://www.gomsinlog.app/auth/callback
  gomsinlog://auth/callback
  ```
- [ ] The `gomsinlog://` scheme is required for the Android Capacitor app deep-link flow

---

## 10. Set Vercel/Netlify Environment Variables

On the hosting platform for the staging deployment:

- [ ] `VITE_SUPABASE_URL` = `https://<staging-project-ref>.supabase.co`
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` = the `anon` (public) key from Dashboard > Settings > API

**Never** set the service role key on the frontend hosting platform.

---

## 11. Run Full Manual Two-Account Test

Follow `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` completely:

- [ ] Sections 1-7 pass (login, invitation, records, privacy, trips, cycles, sync)
- [ ] Section 8 passes (account deletion with partner data preserved)
- [ ] Section 5-5 passes (migration 015 specific verifications)
- [ ] Zero failures recorded

---

## 12. Promote to Production

Repeat steps 2-10 on the **production** Supabase project:

- [ ] Run migrations 013, 014, 015 in order (with verification queries)
- [ ] Reload schema cache
- [ ] Verify/create `couple-media` bucket (private)
- [ ] Deploy Edge Function: `supabase functions deploy delete-account --project-ref <prod-ref>`
- [ ] Set ALLOWED_ORIGINS secret
- [ ] Verify service role key injection
- [ ] Configure Google OAuth (if not already set for production)
- [ ] Set redirect URLs for production domain
- [ ] Update Vercel/Netlify env vars to point to production Supabase

---

## 13. Post-Production Verification

- [ ] Sign in with Google on production
- [ ] Create a couple invitation and redeem it from a second account
- [ ] Create a record, verify real-time sync to partner
- [ ] Test account deletion with a disposable account
- [ ] Verify partner data is preserved after deletion

---

## 14. Android (Future - Out of Scope for This PR)

These are recorded for completeness but are NOT part of the current release:

- [ ] Play Store submission and review
- [ ] Deep-link verification (`gomsinlog://auth/callback`)
- [ ] Capacitor build with production keys
- [ ] APK/AAB signing with release keystore

---

## Related Documents

- `docs/kiro/STAGING_HANDOFF.md` - Detailed staging deployment with rollback
- `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` - Full 2-account test procedure
- `docs/kiro/ROLLBACK_GUIDE.md` - Recovery procedures per scenario
- `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` - General checklist
