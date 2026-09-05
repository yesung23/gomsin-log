# Small-screen functional browser evidence

## Scope and exact source

Parent verification only; no application/test assertion implementation. HEAD88d8f53 on
codex/rc-v5-final-fixes; Archimedes server writer and Popper readonly client Architect continue separately.
Product V5/free core unchanged, EngineeringRC Task5 and latest WorkLog/CURRENT_STATE checked;
Business NOT APPLICABLE, direction conflict NO. Existing tests and fixture unchanged versus88d8f53.

## Environment recovery — failures not hidden

Default Playwright4173 listener belongs to Book Studio (PID/cwd/command directly inspected). It was not
stopped/reconfigured. User's4174 app listener was also preserved. Dedicated4175 was initially unoccupied.
Temporary runner config /private/tmp/gomsinlog-ui-gate.tB26T8/playwright.config.ts changes only target,
artifact location and the two selected existing specs; it is not a source/test behavior patch.

First attempt: custom Vite --outDir failed before tests with Service worker build markers are missing.
Code inspection proves closeBundle hooks hardcode process.cwd()/dist instead of resolvedoutDir. The CSP
hook targets rootdist/_headers even with customoutDir, so do not claim every ignored root artifact was
untouched (no pre-run hash). No tracked source changed and no Book artifact was written.
Recovery: git archive88d8f53 into temp/source, symlink existingnode_modules, use standard dist build there.
This standard snapshot build succeeded; source/test originals were not edited. No new checkout/branch
or dependency install. The source snapshot contains no ignored .env or credential export.

Second attempt: npx playwright failed collection with test() not expected, no assertions executed.
Actual .bin/playwright points to .deno/@playwright+test@1.56.1; test imports resolve a separate root
node_modules/@playwright/test instance. Used the matching root CLI directly instead of reinstalling or
rewriting shared tool shims. Worker informed; no claim about which installer caused the mixed tree.

## Executed successful command

PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
node node_modules/@playwright/test/cli.js test
--config /private/tmp/gomsinlog-ui-gate.tB26T8/playwright.config.ts

Result: **2PASS,9.5s**. Existing tests with synthetic fully intercepted example.supabase.co backend:

- scheduleFailureState.spec.ts:320x844; task-list500 is an error rather than empty-day state; retry
  visible, unavailable write field withheld, no horizontal overflow.
- settingsDialogAccessibility.spec.ts:320x568; profile modal within viewport, internally scrollable,
  nickname initially focused, reverse-tab loops to Save, Escape closes and returns focus to opener,
  no horizontal overflow.

Warnings: Node module.register deprecation, NO_COLOR/FORCE_COLOR conflict, build chunk>500kB.
Output is not pristine; these warnings did not fail the two assertions. Full suite not rerun.
Temp server was runner-owned and stopped after execution; no4175listener in final lsof (exit1 means none).
Temp source/dist/runner evidence retained, not deleted. Git diff of selected specs/fixture/config vs88d8f53
empty; index empty. Current server WIP is outside this UI evidence and still not released.

## Limits and next

This is Chromium real-layout/focus/error-state evidence on two views, not all-screen accessibility,
VoiceOver, a signed physical iPhone, actual Supabase, full ondevice model quality or wholeRC approval.
No user data/server tokens used. Production NOT APPLIED; no commit/push/mastermerge.
No source rollback necessary. The temporary verification files are isolated; preserve other owners' WIP.
Next: continue current server/client critical path, remaining screen/device and nativeAI gates. Use a
clean dependency environment or matching CLI for final release verification, not mixed npx resolution.
