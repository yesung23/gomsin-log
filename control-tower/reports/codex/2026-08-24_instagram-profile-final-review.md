# 2026-08-24 · Instagram-like profile/service final local review

## Scope

This report records the current uncommitted checkout on
`codex/service-rank-profile-settings-impl` at HEAD
`7f4886bcbe32034bfabb454c85378532b14cb261`. It does not describe
the full remote Supabase catalog, or Production.

The bounded independent reviewer was `google-antigravity/gemini-3.7-flash`.
The primary agent integrated the implementation and independently reran the local
verification gates.

## Feature-by-feature review

| Surface | Current result | Evidence / boundary |
|---|---|---|
| Find / service | PASS locally | `/search` renders actual enlistment/discharge inputs, D-day, service percentage, and `이등병 → 일병 → 상병 → 병장`; actual discharge date wins when present. No relationship score. |
| Find / live progress | PASS locally, device sync UNVERIFIED | Page refreshes on local midnight/focus; realtime across two devices was not run. |
| Single My profile | PASS locally | `/us` renders one shared couple profile surface with English username, separate nickname/caption, stats, highlights, and tabs. |
| Profile photo | PARTIAL | Camera UI was removed and file selection is discoverable from profile edit, but the existing implementation is device-local. Cross-device avatar sync needs a storage/RLS design. |
| Caption/date tokens | PASS locally with bounded semantics | `(함께한 날)`, `(만남)`, `(전역)` only render from available dates; `(만남)` is restricted to visit/vacation/date/trip events. |
| Partner-managed username | PASS for server-session contract; physical-phone proof UNVERIFIED | `059` derives the active couple and opposite member, blocks owner direct mutation, deletion/former/anon/collision cases. A web session cannot prove a physical phone. |
| Custom highlights | PASS locally / remote apply UNVERIFIED | `058` supports independent shared title, selected shared photos, order, cover-by-first-item, edit/delete, and highlight story route. Private records are filtered in client and database contracts. |
| Shared profile tabs | PASS locally / real couple parity UNVERIFIED | Grid is travel-photo focused, photo is a distinct shared-record list, travel is a compact trip list. No relationship metrics. Travel grouping is date-range inferred because records lack `trip_id`. |
| Story order/privacy | PASS locally | Highlight viewer follows saved item order and excludes private records. Highlight title is currently shared plaintext metadata and requires a production privacy decision. |
| Instagram-like clutter | PASS locally with one minor risk | Persistent camera/search clutter and old status/diary controls are absent. Highlight edit uses Instagram-like long-press/context-menu behavior; a visible edit icon was intentionally not added. |

## Corrections made after the independent audit

- Use actual `dischargeDate` over an expected date wherever service progress is shown.
- Restrict `(만남)` to meeting-like event types instead of every future event.
- Preserve stored highlight item order in the highlight story route.
- Reject a NULL actor in the username-changing trigger and add a fresh-chain assertion.
- Make the `사진` tab a distinct shared-record list instead of duplicating the photo grid.

## Verification

- `npm run verify`: PASS — typecheck, lint, 230 Vitest files / 3275 tests, build.
- `npm run test:phase0`: PASS — 57 migrations / 328 assertions on throwaway PostgreSQL.
- Focused tests: PASS — 6 files / 53 tests for the audit corrections.
- Local rendered browser paths `/us`, `/search`, `/settings?profile=edit`, and photo tab: PASS for inspected DOM/screenshots; no observed console errors.
- `npm run test:e2e`: UNVERIFIED; not run in this gate.
- Two authenticated accounts/devices: UNVERIFIED. Read-only table/column probes and a
  non-mutating anonymous RPC negative probe confirmed
  `couple_highlights` (`404 PGRST205`), `set_partner_username` (`404 PGRST202`), and
  `profiles.profile_caption` (`400 42703`) are absent. A full schema dump was
  BLOCKED because Docker Desktop is unavailable.

## Release boundary

Migrations `058_couple_highlights.sql` and `059_partner_managed_username.sql` are
local files only; targeted read-only probes confirm their remote objects are absent.
No remote Supabase change, commit, push, merge, or deployment was performed. Production
`/us` returned HTTP 200 for the existing deployment, which does not prove this working
tree is deployed.

## Next gate

Before remote application, decide the explicit `trip_id` association for shared travel
photos and run a staging actor/RLS/realtime test with two real accounts. Keep avatar
sync as a separate storage/privacy design rather than silently treating a device-local
photo as shared.
