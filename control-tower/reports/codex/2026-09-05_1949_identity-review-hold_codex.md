# Identity continuity independent review — HOLD

## Evidence / scope

- Worktree `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`.
- HEAD `1c7503e620b9958adf3dad0b30f037bfea6b46c0` + existing `src/lib/storeAuthIdentity.test.tsx` WIP.
- Reviewer Lovelace, SolMax, agent01a07123-33f0-73f3-aa6b-f9fa28acf5fd, strictread-only.
- Reviewer diffSHA256 `bed08568824cbc2141badb0357daaff7797d3ad589f686d42fde98ef436cead4`.
- Verdict SpecFAIL/TaskQualityFAIL, C0/H1/M3/L1. Previous7VitestPASS does not imply effectivecoverage.

## Findings returned

1. HIGH: sameUID providerchanges at test191/218 emit USER_UPDATED, whereas actual Apple signInWithIdToken
   emits SIGNED_IN (installedSDK GoTrueClient2181; client supabase902). Googlecallback90 also waits
   SIGNED_IN. Thus a no-hydration pass via USER_UPDATED does not verify realproviderlogin.
2. MEDIUM: E2EEsetup is no-op(test45) and RPC lacks spy(test31). Hydrationcounts209/236 cannot prove
   absence of setup/database writes claimed in workerreport21.
3. MEDIUM: test354–360 checks records/name during deferredswitch but not exposed setupComplete/coupleId.
4. MEDIUM: target-only no-emit TypeScript reports7diagnostics at113,128,132,133,273,283,296.
   Fixtures violate DailyRecord/profile enums; deferredmock is Promise<unknown>. Parent confirmed
   tsconfig26 excludes testfiles, so globaltypecheckPASS never proved thisfiletypecorrect.
5. LOW: workerreport63 'Caught Mutations' is unsupported;69 acknowledges fixturesonly, no executedmutant.

Reviewer ran identity/diffcheck/runtimeunchanged/diffpackagecomparison/targetTS/hashstabilitychecks.
Vitest/lint/fullsuite/hosted/native were notrerun; knownlocalpasses are historical, not newreviewevidence.

## Parent evaluation / ruling

Parent read actualStore1660–1825, taskbrief andtsconfig. ExistingSIGNED_IN deliberately calls
verifyDeletionStatus before authoritativefetch. UserV5§11 requires sameUID data/profile/setup continuity
and no account/ownershiprewrites; it does not require skipping all serverreads. The original parentbrief's
no-hydration clause is overconstrained. **Keep securityrevalidation; test realSIGNED_IN and actualwrites.**
Cost of this ruling: legitimateextra reads may remain until separatelymeasured; skipping freshdeletionstate
would be worse. The reviewer was asked for any evidence of harmfulreset/writes distinct from fetchcount.
That followup was pending at reportcreation; no observedruntimefailure is silently waived.

### Followup returned / closed

Reviewer subsequently confirmed same-UID SIGNED_IN rehydration is not a demonstrated product/security
bug and the zero-hydration clause was overconstrained. ActualsameUID retains existingstate while pending,
then merges authoritative data with sameUID base (store1871); inspected hydration performs read queries.
Do not expand fastpath. Legitimate E2EE capability reinstall, recoverymarker or write-floor activation
must not be counted as forbidden productownership writes. Hydrationfailure's fail-closed hiding is not
server deletion or new onboarding. No runtimechange is currently warranted by this review; actual-event
tests and TS/spy/isolation/report fixes remain required. Updated queuedbrief; reviewerhandle closed.

## Next implementation / current workers

Queued exacttestonlyfix brief `.superpowers/sdd/rc-closure-plan-2026-09-05/task-1-identity-fix-brief.md`:
actualbidirectionalSIGNED_IN, separateUSER_UPDATED, write/setupspies, fullinterimisolation, validtypes,
honestmutationevidence. If realcontinuity fails, reportRED and request separate runtimescope.
Parent changes plans/reports only. Fixwriter starts after Herschel's disjointserverimplementation returns;
singlewriter/nooverlap and separateSolMaxrereview remain. No appsourcefixbyparent.

## Device / remaining gates

New `xcrun devicectl list devices` returned physical iPhone16Pro available(paired), not justsimulator.
Apple native entitlement is still absent: its filemention is an oldcomment, targetcapabilitiesIAPonly.
Queuednativefollowupnotes specify profile+entitlement+clientcall+signeddevice proof. No appinstall,
profilegeneration, actualApplelogin or modelinference occurred. Servernewtests are appearing inWIP,
but writer completion/security has not been reported or accepted.

## Status

Reviewimpact DELTA/testHOLD. No sourceimplementation/typefix/commit/push/merge/remotechanges byparent.
The only prior externalchange is explicitlyapprovedAppleportalcapability. Supabase/provider/keys/DDL/
appflags remain NOT APPLIED by this work. OverallRC remains unproven and active, not complete/blocked.
