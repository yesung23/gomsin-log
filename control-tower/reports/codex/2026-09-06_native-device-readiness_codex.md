# Physical iPhone / dependency readiness

## Scope and direction

Base `5e22d1c633b7ab96684239666061e3913d24bb2e`, branch `codex/notebook-home-v1`, worktree `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`. Goal remains notebook Home plus verified beta readiness; previous turn progressed by committing/pushing Home and showing the actual authenticated local preview. Product latest user-approved scrapbook scope; Engineering/Current/Work Log and release-validation consulted. Business NOT APPLICABLE. Parent writes no app source. Remote deployment/DB changes NOT APPLIED.

## Newly verified

- `xcrun devicectl list devices`: previously unavailable physical iPhone16Pro is now available/paired. No install, uninstall, launch or record mutation performed yet.
- Xcode26.6 /17F113 installed, not Xcode27 beta. Two valid local development signing identities exist; private keys were not exported.
- Certificate subject's Team ID matches existing GomsinLog profiles. Only profile metadata was extracted in memory. One unexpired GomsinLog profile includes the connected device and Complete Protection, but lacks Sign in with Apple; actual tracked App.entitlements requests both. Do not remove entitlement to force signing.
- Native release guide is stale: it says Apple entitlement absent/web OAuth only, whereas current code requests native Apple entitlement. Code is authoritative; provider activation is still separately held off.
- Disk free was11GiB at check; avoid installing VM runtimes or blanket cache deletion while building.

## Native sync / discovered local drift

`node node_modules/@capacitor/cli/bin/capacitor sync ios` succeeded,8plugins,4.13s. Copied index hash matches the real-public-config artifact `6e5be8bfd6d39bbe3abab60f42def7c2e4c7d86cf2fb8580080291dbf2c39105`. However sync changed tracked Podfile/lock: installed Capacitor7.6.9 under `.deno` paths versus npm lock7.6.8. Both tracked files were clean before this parent command; their entire diff is parent-generated, not user work. This is an environment reproducibility failure, not an approved version upgrade.

Gibbs TerraHigh assigned sole bounded restoration: npm lock installation, exact restoration of those two generated diffs with apply_patch, then clean cap sync. No app/native capability changes, commit, external state or unrelated cleanup. Preserve Now and immutable preview artifact. Installation and signed build remain UNVERIFIED pending this repair.

## Next / safety

Verify clean locked sync; rebuild with verified public configuration under restored dependencies; verify signed device build without removing capabilities, then install only if signing/provisioning succeeds. No existing app or data is to be deleted. Apple provider/native sign-in, real on-device model performance, DB recovery/migration compatibility and TestFlight remain distinct unfinished gates. No claim that current local preview equals a releasable native build. REVIEW IMPACT: environment/native packaging DELTA required if tracked source must change.

## Verified follow-up: source merge and signed development install

- Gibbs completed npm ci and exact scoped generated-diff restoration via apply_patch. Parent independently confirmed installed/locked Capacitor7.6.8 and clean Podfile/lock. No tracked app/native source change remains from this environment repair.
- Parent rebuilt real-public-config release bundle under restored npm dependencies:2589modules,3.74s, build PASS; cap sync ios PASS,8plugins,3.62s. Held Apple/IAP/E2EE-device/PartnerBriefing flags remain false. New index hash `6858e1e10396888b0c5fccadf7f768c3f1001e30849022e5ac2b6baaf8738c6c` matches dist and iOS public. Prior4193 immutable web preview remains a separately identified artifact.
- First signed Debug build without provisioning updates failed exit65 because existing profile lacked Apple sign-in. No entitlement was removed.
- Retried same build with Xcode `-allowProvisioningUpdates`, current developer team and connected device. Exit0; `codesign --verify --deep --strict` PASS. Signed entitlements include Apple Default, Complete Protection, expected app identifier; `get-task-allow=true` identifies a DEVELOPMENT build, not App Store/TestFlight release.
- Xcode provisioning operation APPLIED for this development signing flow; old-profile error no longer blocks signing. This does not enable Supabase Apple provider. No key export, profile deletion, certificate revocation or public submission was performed.
- Both exact5e22d1c CI runs `34009396423` and `34009396430` completed SUCCESS. READY TO MERGE declared with scope, reviewed head,16files/3commits and rollback; merged PR94 using `--match-head-commit`. GitHub confirms merge `4c8afcf5eb62d6fb0515104938c879c180bf4a99`,2026-09-06T03:45:57Z. Remote master reread/fetch matches, and HEAD→origin/master file diff is empty. Parent's pending operational report/Work Log and script-managed Now were not part of that merge.
- `devicectl device info apps --search app.gomsinlog` confirmed existing installation. `devicectl device install app` completed successfully for the signed App.app from `/private/tmp/gomsinlog-device-5e22d1c.N2rgtT/Build/Products/Debug-iphoneos/App.app`. Installed over same bundle without uninstall or data-container deletion. Actual retained session/content still needs runtime verification; do not infer data preservation solely from install success.
- Physical launch verification in progress. Public Vercel deployment, DB migrations, Supabase provider change, TestFlight upload: NOT APPLIED. Full beta objective still open.

`devicectl device process launch` subsequently succeeded for app.gomsinlog. This proves OS launch, not rendered UI or account flow. User was asked asynchronously to confirm the phone screen and complete Google authentication personally if required; no password/OTP requested. Continuation branch `codex/beta-device-gates` created from verified origin/master4c8afcf, preserving pending docs and Now. Device interaction, lower-device AI performance, hosted compatibility and public beta release remain open.
