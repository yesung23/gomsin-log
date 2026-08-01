# Staging Handoff Guide

Complete deployment instructions for the staging environment. Follow this
document exactly, in order, before promoting any change to production.

---

## Migration Execution Order

Migrations must be applied in strict sequence. Each migration is idempotent
within a transaction, but applying them out of order will cause foreign key or
function dependency failures.

```
013_invitation_hardening.sql     (staging first, then production)
014_feature_privacy_and_collaboration.sql  (staging first, then production)
015_security_followup.sql        (staging first, then production)
```

Apply each migration in the Supabase Dashboard SQL Editor (or via CLI) and
verify it before proceeding to the next.

### WARNING: Duplicate Migration Prefix

The `supabase/migrations/` directory contains two files with the `002` prefix:

- `002_fix_rls_and_rpc.sql`
- `002_fix_rls_recursion.sql`

These are both **legacy** migrations that were applied long ago. They do not
affect the current deployment. Only migrations 013, 014, and 015 are new and
need to be applied for this release.

---

## Edge Function Deployment

The `delete-account` Edge Function **MUST** be deployed AFTER migration 015 is
applied. Migration 015 creates the storage policies and RPC functions that the
Edge Function depends on.

```bash
supabase functions deploy delete-account
```

If you deploy before 015 is applied, account deletion will fail with a
permissions error (`42501`) on the Storage cleanup step.

---

## ALLOWED_ORIGINS Configuration

The Edge Function requires the `ALLOWED_ORIGINS` secret to be set. Without it,
the function fails closed with HTTP 500 on every request (this is intentional
security behavior).

### Exact Format

```
ALLOWED_ORIGINS=https://gomsinlog.app,https://www.gomsinlog.app
```

Set via the Supabase Dashboard (Edge Functions > delete-account > Secrets) or
CLI:

```bash
supabase secrets set ALLOWED_ORIGINS="https://gomsinlog.app,https://www.gomsinlog.app"
```

**Rules:**
- Comma-separated, no spaces between origins
- No trailing slash on any origin
- Must include both bare domain and www variant
- Missing or empty value = 500 fail closed (no CORS headers reflected)

---

## Schema Cache Reload

After applying migration 015, you **must** reload the schema cache. Without
this step, PostgREST will not recognize the new `redeem_invitation` and
`regenerate_invitation` functions, causing invitation code operations to fail
with `PGRST202`.

**Steps:**
1. Supabase Dashboard > Settings > API
2. Click "Reload schema cache"
3. Wait 10-15 seconds for propagation

**Verification:**
```sql
SELECT proname FROM pg_proc
WHERE proname IN ('redeem_invitation', 'regenerate_invitation');
-- Must return 2 rows
```

---

## Two-Account Deletion-Recovery Test Procedure

This is a condensed version of Section 8 from `MANUAL_TWO_ACCOUNT_TEST.md`.
Must be performed with two browser sessions (or devices) logged into different
accounts.

### Setup
- Account A and Account B are connected as a couple
- B has created at least 2 records and 1 shared schedule

### Steps

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | A: Settings > Delete Account > Type confirmation > Execute | Success message, then sign-out |
| 2 | A: Sign in again with same credentials | Fresh onboarding (new account state) |
| 3 | B: Sign in | Normal home screen |
| 4 | B: Check records | All 2 records intact |
| 5 | B: Save a new record | Succeeds |
| 6 | B: Check shared schedule | Still visible |
| 7 | B: Settings screen | Shows disconnected state, can issue new invitation |
| 8 | Dashboard: Storage > couple-media | A's folder is gone |
| 9 | Dashboard: `SELECT * FROM account_deletion_requests;` | 0 rows |

If steps 4, 5, or 6 fail, partner data has been damaged. Stop testing and do
not proceed to production.

---

## Cross-Device Online/Offline Cases

Test these scenarios with the app open on multiple devices/browsers
simultaneously:

### Airplane Mode Test
1. Put Device B into airplane mode
2. On Device A, create a record and modify a shared trip
3. Bring Device B back online
4. Verify B sees the updates within a few seconds (membership re-verification
   triggers a fresh fetch)

### Multiple Browser Test
1. Open the app in Chrome and Firefox, both signed into Account A
2. Create a record in Chrome
3. Verify it appears in Firefox without manual refresh

### Tab Switching Test
1. Open the app, switch to another tab for 30+ seconds
2. Switch back
3. Verify the timeline does not flash blank (no empty-state flicker)
4. If the realtime connection was lost, a "reconnect" banner should appear

### Disconnection During Offline
1. B is offline (airplane mode)
2. A disconnects the couple
3. B comes back online
4. B's shared records, trips, and support signals must disappear immediately

---

## Rollback Steps

Each migration has rollback instructions. Reference `docs/kiro/ROLLBACK_GUIDE.md`
for detailed procedures per situation.

### Per-Migration Rollback Summary

| Migration | Rollback Action |
|-----------|-----------------|
| 015 | Run the `-- ROLLBACK` block at the bottom of `015_security_followup.sql`. Then re-deploy the previous Edge Function version (or remove it). |
| 014 | Run the `-- ROLLBACK` block at the bottom of `014_feature_privacy_and_collaboration.sql`. Verify RLS policies revert to 013 state. |
| 013 | Run the `-- ROLLBACK` block at the bottom of `013_invitation_hardening.sql`. Then re-run the invitation consumption section from `009_remote_core_security_hotfix.sql` to restore `consume_invitation`. |

### App Rollback (No DB Changes)

If the issue is in the frontend only:
1. Vercel/Netlify Dashboard > Deployments
2. Find the last known-good deployment
3. Promote to Production (Vercel) or Publish deploy (Netlify)

This does not affect the database.

---

## Evidence Capture

For each staging verification step, capture the following:

### Screenshots Required
- Each migration execution result (success message in SQL Editor)
- Schema cache reload confirmation
- Edge Function deployment success
- Storage bucket configuration (private, no public access)
- Two-account test results (key steps: deletion success, partner data intact)

### SQL Verification Queries

After migration 013:
```sql
SELECT proname FROM pg_proc WHERE proname = 'redeem_invitation';
-- Must return 1 row
```

After migration 014:
```sql
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('schedules', 'trips', 'trip_items');
-- Verify privacy policies exist
```

After migration 015:
```sql
SELECT proname FROM pg_proc
WHERE proname IN ('redeem_invitation', 'regenerate_invitation');
-- Must return 2 rows

SELECT indexname FROM pg_indexes
WHERE indexname = 'idx_invitation_codes_one_unused_hash';
-- Must return 1 row
```

### Edge Function Logs

After deploying `delete-account`:
1. Dashboard > Edge Functions > delete-account > Logs
2. Trigger a test deletion (with a disposable account)
3. Verify log shows:
   - Successful auth token verification
   - Data deletion steps completing
   - Storage cleanup (if media existed)
   - No `42501` permission errors

Save the log output as evidence.

---

## Related Documents

- `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` - Full 2-account test procedure
- `docs/kiro/ROLLBACK_GUIDE.md` - Detailed rollback instructions per scenario
- `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` - General deployment checklist
- `docs/kiro/NEXT_RELEASE_STEPS.md` - Credentialed tasks remaining
