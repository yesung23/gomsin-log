# Post/Story readability, alert placement and TestFlight preflight — 2026-08-28

## Verdict

CONDITIONAL PASS. The local product delta, production web bundle, Capacitor iOS sync, signed Release
Archive and App Store Connect IPA export pass. TestFlight upload, processing, remote installation and
two-account physical-device smoke were not executed.

## Exact scope

- Branch: `codex/profile-post-composer`
- Base: `a64ecadd4b6833c9c5a8db255c8a3c5a2fd39a57`
- Readability/alert commit: `f12e83e`
- Startup optimization commit: `5b15685`
- User-owned changes preserved: `.DS_Store`, `src/lib/store.test.tsx`,
  `src/pages/authCallbackPkceRace.test.tsx`

## User behavior

- Settings → 보기 offers account-scoped, device-local Small 15px / Default 17px / Large 20px.
- Home posts, Story cover/moments, My photo-post detail and the legacy feed share the setting.
- Time, buttons, legal copy and record identity/navigation do not change.
- In-app notification cards and Sonner status/error messages start below the iOS safe area and fixed
  56px header.
- Before React executes, the WebView shows a cream progress surface instead of an empty black frame.

## Performance evidence

- Production entry raw: 657.02KB → 437.01KB (-33.5%).
- Production entry gzip: 197.58KB → 133.18KB (-32.6%).
- The >500KB Rollup warning is gone.
- Fresh local onboarding FCP sample: 516ms → 492ms. This is a local Chromium sample, not physical
  iPhone telemetry.
- Authenticated production-bundle smoke: PASS in 558ms.

## Verification

- Focused readability tests: PASS, 6 files / 59 tests.
- Type-scale and handwriting scope: PASS, 2 files / 34 tests.
- Notification/toast tests: PASS, 3 files / 12 tests.
- Startup/media/CSP tests: PASS, 4 files / 45 tests.
- Full Vitest: PASS, 264 files / 3,761 tests in 175.69s; the prior device-key timeout did not recur.
- Full ESLint, typecheck and `git diff --check`: PASS.
- Playwright media + Story/settings: PASS, 9/9 at 320/390px; 17px→20px, reload persistence,
  Home propagation and 44px controls verified.
- Production bundle smoke: PASS, 1/1.
- Release build and Capacitor iOS sync: PASS, 2,168 modules / 5 plugins. Tracked iOS diff: none.
- `dist/index.html` and `ios/App/App/public/index.html` SHA-256: exact match.
- Xcode 27 beta signed Release Archive: PASS, `app.gomsinlog`, `0.1.0 (2026082801)`, 30MB.
- App Store Connect export: PASS, 10MB IPA, SHA-256 recorded locally.

## Boundaries and rollback

- Supabase was read only to obtain the current publishable key; no SQL/Auth/provider mutation occurred.
- Vercel Production, Apple provider, TestFlight and App Store were NOT APPLIED.
- Revert `5b15685` to undo startup splitting/boot surface and `f12e83e` to undo text size/alert position;
  rebuild and sync. No database rollback is required.

## Remaining release gate

Upload the validated build to TestFlight only after the user resumes that action. Then wait for Apple
processing, install remotely, and run Google/Apple OAuth, session restore, two-account connection,
record/photo/Story exact-original, privacy boundaries and on-device Foundation Models checks. None of
those physical TestFlight behaviors are claimed here.
