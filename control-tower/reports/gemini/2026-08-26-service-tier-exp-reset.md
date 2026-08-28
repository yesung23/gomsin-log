# 2026-08-26 Service Tier EXP Reset Verification Report

## Verdict

**Local implementation and documentation gate PASS.**

Visible service EXP readout in `SearchPage` resets cleanly to `0 / {tierTotalSec} EXP` (0.0000%) upon entering each of the seven service tier boundaries (`0%`, `10%`, `25%`, `40%`, `55%`, `70%`, `85%`, and terminal `100%`). The cumulative service percentage (`totalPercent`, e.g. `복무율 20.0000%`) remains independently displayed in the summary area. 1 sec = 1 EXP incrementation holds. Real enlistment and discharge dates determine all calculations; no artificial relationship score or intimacy metric is computed or rendered.

## Repository Context & Worktree Preservation

- Repository: `/Users/han-yejun/Desktop/곰신로그`
- Branch: `codex/profile-post-composer`
- Committed HEAD: `fbbd35496fcd1c848f2f7437bb6a85ffb2399f21`
- State: Dirty mixed worktree
- Preserved changes: All dirty working-tree files (post composer, E2EE ceremony, store, mockBackend, records, etc.) preserved untouched
- Operations: Non-destructive local documentation and verification recording only; no code changes, no commit, no push

## Verified Product Behavior

1. **Overall Service Percent Remains Separate**:
   - `SearchPage` summary readout (`data-testid="service-progress-summary"`) continues to report cumulative service progress (`복무율 {totalPercent}%` to 4 decimal places) and remaining service days.
2. **Visible EXP Readout Resets 0 → 100 Within Each Seven Tier Boundaries**:
   - The seven slang service tier boundaries are `0%` (신병, Lv.1), `10%` (일초, Lv.2), `25%` (일꺾, Lv.3), `40%` (일말, Lv.4), `55%` (상초, Lv.5), `70%` (상꺾, Lv.6), and `85%` (왕고, Lv.7).
   - In `InlineServiceInfo` (`data-testid="service-exp-readout"`), the visible text display renders `{formatExpNumber(expState.tierElapsedSec)} / {formatExpNumber(expState.tierTotalSec)} EXP` and `{formatExpPercent(expState.tierExpPercent, 4)}`.
   - The progress gauge bar and accessibility label reflect `tierExpPercent` (resetting to 0% at each tier threshold) with `aria-valuetext="LV {level} {label} 경험치 {percent}"`.
3. **1 sec = 1 EXP**:
   - Every elapsed second of active service translates directly to +1 EXP (`elapsedSec` and `tierElapsedSec`).
4. **Real Enlistment / Discharge Dates & No Relationship Score Preserved**:
   - Dates originate exclusively from verified user military info (`enlistmentDate`, `expectedDischargeDate` or `dischargeDate`).
   - No score, rank, intimacy grading, or gamified couple metric is added. Conforms strictly to `docs/BUSINESS_MEMORY_ROADMAP_V1.md` §7.

## Verification Evidence

- `npx vitest run src/lib/serviceLevel.test.ts src/features/search/searchPage.test.tsx`:
  - **PASS** (2 files, 39 tests passed)
  - Validates tier reset behavior, boundary math, ticker interval, DOM readout, and summary independence.
- `npm run typecheck` (`tsc -b --force`):
  - **PASS**
  - Confirms complete TypeScript type correctness across `ServiceExpResult` (`tierElapsedSec`, `tierTotalSec`).
- Targeted ESLint (`npx eslint src/lib/serviceLevel.ts src/lib/serviceLevel.test.ts src/features/search/SearchPage.tsx src/features/search/searchPage.test.tsx`):
  - **PASS** (0 errors, 0 warnings)
- All-branch & all-boundary simulation:
  - **PASS**
  - Validates all military branches (army, marine, navy, airforce, social_service, reserve) and all 7 tier transition points.
- `git diff --check`:
  - **PASS**
  - No whitespace or conflict marker issues in repository diff.

## Explicit Boundaries & Non-Claims

- **No screenshot claimed**: Visual rendering verified via test DOM assertion; no headless browser screenshot taken in this turn.
- **No full repository verify claimed**: Full suite (`npm run verify`) not run in this turn; focused verification executed.
- **No Production / remote Supabase claimed**: No remote migrations applied, no remote PostgREST queries mutated.
- **No physical device claimed**: No iOS or Android native hardware execution claimed.
- **No commit or push**: Branch working tree remains uncommitted and unpushed.
