# Diary · Garden · Shop V2 — physical iPhone installation

Status: **INSTALLED / LAUNCHED / VISUAL SMOKE PASS**
Date: 2026-09-02 KST
Worktree: `/private/tmp/gomsinlog-diary-garden-shop-20260901`
Branch: `codex/diary-garden-shop-v2`
Draft PR: https://github.com/yesung23/gomsin-log/pull/92
Installed application commit: `f5fc1a0717ca989e6917ea658f7b8ed724de7fbe`
Live `origin/master`: `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`

## Outcome

The exact reviewed Diary · Garden · Shop V2 branch was rebuilt with Xcode 27.0 beta 6 and the iOS 27 SDK, signed with the matching `app.gomsinlog` development profile, installed over the existing developer build on the connected iPhone, and launched successfully. The existing app bundle was not uninstalled first.

The initial signing failure was not a code failure. `844X94VBRZ` was the identifier displayed in the certificate name, while the certificate organization unit and downloaded development profile both identify the actual development team as `CB3WLY278W`. Applying the matching team only to this device build produced a successful signed package; no project file was edited.

## Verification

- Configured web build and Capacitor iOS sync — **PASS**.
- Xcode 27.0 beta 6 physical-device build with iOS 27 SDK — **PASS, BUILD SUCCEEDED**.
- Deep code-signature verification — **PASS**.
- Package identity — **PASS**, `app.gomsinlog`, version `0.1.0` (1).
- Xcode 27 Beta CoreDevice install — **PASS**.
- CoreDevice launch — **PASS**.
- Installed-app inventory — **PASS**, `곰신로그` is present as `app.gomsinlog` version `0.1.0` (1).
- Physical screenshot — **PASS**, the live `우리 정원` screen and Shop entry point are visibly rendered.

The screenshot was kept only as a temporary local verification artifact and was not committed because it can contain private relationship context.

## Boundaries

- Application/source behavior, DB/schema/migration/RLS/auth/crypto — **UNCHANGED**.
- Supabase, production master, Vercel production, TestFlight, and App Store — **NOT APPLIED**.
- Physical iPhone — **APPLIED** as a signed development build.
- Full touch flow, long-press dragging, Shop persistence transitions, VoiceOver, and Switch Control — **MANUAL / UNVERIFIED in this install-only pass**.
- External character-rights judgment — **UNVERIFIED**.

## Next safe action

Use the installed app on the iPhone to exercise Shop acquisition/application/reload and long-press garden movement. Keep Draft PR #92 unmerged until the responsible owner accepts the remaining manual interaction/accessibility and external-rights gates.
