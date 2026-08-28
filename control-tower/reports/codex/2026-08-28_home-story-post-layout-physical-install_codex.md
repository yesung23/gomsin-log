# Home photo-post layout and physical install — 2026-08-28

## Verdict

CONDITIONAL PASS. Source, focused tests, 390px Chromium render, strict release build, iOS sync,
signed physical build, install and launch pass. The physical screenshot captured the newly installed
app on Search because that was the active tab; the exact Home photo post remains user-confirmed rather
than falsely marked PASS.

## Exact scope

- Branch: `codex/profile-post-composer`
- Base: `958d02ff8ac4eff132931caad534c07ae3e840b0`
- Feature commit: `d40d7ee0a9e47f92fe6610d62ee302014b673451`
- Changed behavior: Home photo posts no longer repeat the visible author row or caption name. They read
  photo, caption, then a 44px action row containing minute-only relative time, exact-original action,
  and bookmark.
- Unchanged: record content, record ID, bookmark mutation, privacy filtering, DB, RLS, crypto and Production.

## Evidence

- Focused Vitest: PASS, 3 files / 43 tests.
- Target ESLint: PASS.
- Typecheck: PASS.
- Playwright: PASS, 1/1 at 390px; 44px controls and zero horizontal overflow.
- Browser screenshot: `ui-audit-results/after/home-post-clean-390.png`.
- Strict build/sync: PASS, 2,166 modules / 5 Capacitor plugins.
- `dist/index.html`, iOS public and signed App bundle index SHA-256: `6123fa92...`.
- Xcode 27 beta signed physical build: PASS. CocoaPods/Capacitor deprecation and always-run script
  warnings were non-blocking.
- iPhone install and launch: PASS, installed at bundle URL ending
  `678C858C-3C32-4FB0-8185-B420564BFF7B/App.app/`.
- Physical screenshot: `ui-audit-results/physical/home-post-clean-iphone.png`; Search tab only, so Home
  visual result is UNVERIFIED on physical hardware.

## Rollback

Revert feature commit `d40d7ee`; rebuild, sync and reinstall. No database or remote rollback is needed.

## Production

- APPLIED: local signed development app install only.
- NOT APPLIED: Supabase, Vercel Production, OAuth providers, TestFlight, App Store, master merge.
