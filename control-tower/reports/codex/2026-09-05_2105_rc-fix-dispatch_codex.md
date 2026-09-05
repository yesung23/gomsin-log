# RC continuation — returned test evidence and Apple lifecycle fix

## Current State

Live session-start: codex/rc-v5-final-fixes / 1c7503e620b9958adf3dad0b30f037bfea6b46c0,
existing mixed WIP preserved. Last user-facing turn supplied the requested release plan; this turn
advances the active RC goal. No master/Production completion claim.

## Returned evidence

Both prior handles authoritatively completed; they were closed only after receipt, not due to timeout.
Aquinas reports shared ESM matcher repair: representative4files/90tests PASS; full Vitest362filesPASS,
1fileFAIL,6108testsPASS/1FAIL/2skip. Remaining cors.test.ts:325 fixture lacks the new mandatory
prepareAppleCredentialDeletion dependency; fixture correction joins the server integration scope.
Parent inspected actual setup diff and CORS caller; full results are worker evidence, not parent reruns.
Fresh independent identity/setup reviewer Anscombe SolMax is running; no approval yet.

Franklin returned read-only Architect design addressing the recorded HIGH3/MEDIUM3/LOW1. No remote
or source writes in that Architect followup. Parent accepted one coherent local fix rather than
independent patches that could lose token generations or permit false revocation success.

## Decisions and delegated changes

Ruling: Separate verified identity authority from encrypted token custody. Capture obtained tokens before
remote verification, quarantine unverified tokens without ownership, retain all known generations until
confirmed revoke/manual operator resolution, preserve sticky uncertainty independent of journal pruning.
Cost: more private state and bounded retry invocations. Existing user-content encryption is unchanged.

Ruling: New server credential endpoint is native-only app.gomsinlog; remove unused Services-ID option.
Cost: future Apple web code exchange needs its own fixed-redirect design. Existing Google/web auth paths
are not removed, and this endpoint has no shipped caller yet.

Ruling: Advanced deletion retries replay exact-attempt terminal evidence; old advanced rows without proof
need explicit operator resolution. Never rewind E2EE phases or infer revoked from missing evidence.
Missing key is retryable until independently evidenced irrecoverable; operator cannot forge revoked.

Archimedes SolHigh sole writer: 01a07174-f6ea-7843-a94b-ceee07f0f542.
Requirements: .superpowers/sdd/rc-closure-plan-2026-09-05/task-1-apple-server-fix-brief.md.
Original server paths plus narrowly scoped cors fixture and apple-auth-credential-recovery runbook.
No native/client/canonical/source overlap. Independent final server review must use a fresh reviewer.
Anscombe SolMax readonly: 01a07175-78a9-7fd3-bbd5-b8f112a29071, identity/setup two-path diff only.
Parent remains planner/verifier/integrator; no direct source/test implementation.

## Native read-only preflight

Executed xcode-select -p; xcodebuild -version; xcrun devicectl list devices;
security find-identity -v -p codesigning; df -h /Applications.
Selected toolchain is Xcode26.6. Physical iPhone16Pro is currently available/paired again.
Two valid Apple Development signing identities are present. This disproves a missing-local-certificate
assumption, but does NOT establish the selected team, updated provisioning profile or signed app success.
No private key exported. Account email/certificate hashes/device identifiers omitted from this report.
Available disk13GiB; Xcode27beta archive+expansion+component requirement still UNVERIFIED.
An rg query included two nonexistent guessed Config.Debug/Release paths and exited2; actual Config.xcconfig
exists and optionally includes LocalSigning.xcconfig. Do not report the failed query as a successful build.
No profile regeneration/download, installation, signing build or credential creation performed.

Additional metadata-only local inspection decoded provisioning profiles in memory (no file output).
Initial whole-plist JSON conversion failed4times because the conversion was unsuitable; corrected to
extract only Entitlements/TeamIdentifier/ExpirationDate. Exactly two app.gomsinlog profiles matched:
one development and one distribution, both valid until August2027, both Complete Protection, neither
contains com.apple.developer.applesignin. Both profiles and both development certificate OU values identify
the same team. Local team value can be configured from this actual evidence, not inferred from certificate
display-name suffix. Profile regeneration after capability patch is still necessary. No decoded content,
certificate PEM, profile device list or credential material was persisted/logged in this report.
The earlier component search hit a zsh unmatched-glob error; corrected to rg with file filters.

Book owner wait snapshot confirms its specific task active; backup-dependency response not yet returned.
No duplicate prompt or shared-DB action was sent.

## Verification / release limits

Current reviewed boundary is WIP on1c7503e; identity DELTA pending, server HIGH findings remain OPEN
until fixed and reviewed. New PostgreSQL permissions tests must cover every new RPC/table, not the old
5RPC/2table count. Real Apple, hosted Supabase, full ondevice AI and signed customer app remain UNVERIFIED.
Production NOT APPLIED; no commit/stage/push/merge. Rollback is named local patch reversal only after
ownership review; never discard mixed WIP. Existing backup retention issue still needs safe resolution.

Next: consume identity review, complete server fix/regressions/fresh review, then native entitlement and
actual client handoff/deletion guidance. Keep provider/feature flags/sales OFF until their specific gates.
