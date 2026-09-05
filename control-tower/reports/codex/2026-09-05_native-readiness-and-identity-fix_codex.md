# Native readiness HOLD and identity-test fix dispatched

Base `codex/rc-v5-final-fixes` / `1c7503e620b9958adf3dad0b30f037bfea6b46c0` plus WIP.

## Verified boundary

Maxwell returned a read-only report and was closed. Unsigned arm64 Release compiled; signed build failed
because the development team is not configured. Parent inspected the corresponding build logs under
`/tmp/gomsinlog-native-readiness.AFnRGa`. No signed installation or actual Apple/FoundationModels execution
has occurred. Existing Apple entitlement is comment-only and current payload has both feature gates OFF.
Standard Applications locations contained only Xcode26.6, not requested Xcode27beta (verifier report).
The physical iPhone was paired but disconnected at the verifier's latest observation.

Verifier also reports 196 focused tests passing/2 skipped, while storyDailySummary has 25 passing/26 failing
on unregistered Chai DOM matchers. These counts are verifier-reported, not parent rerun.
Parent directly ran `npx vitest run src/lib/storeAuthIdentity.test.tsx`: **7 failed**, exit1,
`Invalid Chai property: toHaveTextContent`. Global setup imports jest-dom; cause is not yet established.
Neither matcher failure proves a production login/summary defect nor permits a PASS claim.

## Action

Aquinas `01a07153-3e27-7290-a9fa-fabc4ab20cc0`, SolHigh, is the sole test writer. Allowed paths:
`src/lib/storeAuthIdentity.test.tsx` and its existing ignored paired report. Corrected real SIGNED_IN
continuity/isolation/types plus matcher diagnosis are in the queued brief, now explicitly dispatched.
Shared setup/config/runtime edits require a separately bounded scope after root-cause evidence.
Franklin remains independent SolMax server reviewer. No overlapping source writes.

Next native implementation: actual Apple entitlement/capability and nativeConfig test, then reviewed
credential endpoint caller and deletion guidance consumers. Local team/signing and actual release payload
follow configuration verification. User handles private account login/2FA at the relevant screen.

The verifier's proposed zero-timeout sample is a test target, not proof or a new universal SLA. Measure
cold/warm latency and failures honestly; preserve the approved deterministic fallback for unsupported,
slow or unavailable devices. Do not remove fallback merely to claim model success.

Production NOT APPLIED; no new credentials, flags, install, commit, stage, push or merge. RC HOLD.

## Parent official download preflight

Authenticated Apple Developer Downloads browser on2026-09-05 lists Xcode27beta6 (August24,2026).
Source: https://developer.apple.com/download/all/?q=Xcode . Initial login redirect resolved through
the existing browser session; no password/2FA entry was needed. This confirms official availability,
not local installation. No download began. `df -h /Applications` reported14GiB available; actual archive,
expanded toolchain and component space requirements remain to check before installation. Do not delete
the existing Xcode or user files to make room without a scoped safe decision.

## Identity worker returned and shared matcher followup authorized

Aquinas returned8 identity tests and30 combined identity/session-guard tests PASS, scoped ESLint and
test-inclusive TS PASS. Parent read actual test diff and report; independent DELTA remains pending.
The separate authExpiry suite still failed9 tests because its shared DOM matchers were not registered.
Worker identified CJS adapter versus test ESM expect-instance registration mismatch in the installed
Node26/mixed Vitest environment, without claiming which installer caused it.

Parent explicitly authorized the same worker to modify only `src/test/setup.ts` to bind matchers to the
imported Vitest expect and remove the now-redundant local matcher wiring from storeAuthIdentity.test.tsx.
No behavioral assertion removal, storage polyfill changes, dependency reinstalls, manifests, runtime or
server edits. Representative suites must pass before one full Vitest regression. This followup is running,
not yet verified. Franklin server review remains independent. No new source work by parent.
