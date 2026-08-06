# Merge policy for Kiro

Scope: this repository. Applies to every Kiro session, including future ones that
have no memory of how these rules were established.

## What Kiro may merge

Kiro may automatically merge **only its own pull requests**, and **only into**:

```
kiro/v1-product-excellence-audit
```

- **Never merge into `master`.** No exception, no user justification. A PR whose
  base is `master` is out of scope even if Kiro authored it.
- **Never merge another agent's or another session's PR without explicit user
  approval.** Authorship is not enough on its own: read the diff first, and if it
  was not opened in the current session, ask.
- A PR whose *head* is `kiro/v1-product-excellence-audit` but whose *base* is
  something else is **not** in scope. The authorisation is about merging *into*
  that branch, not about promoting it up the branch stack.

## Pre-merge checklist

Every item must be verified from real output, not assumed. If any item cannot be
verified, do not merge — report the gap instead.

1. **Base** is exactly `kiro/v1-product-excellence-audit`.
2. **Head** is the intended branch, and the diff contains no unrelated changes
   (check `changed_files`; a policy or CI change must not carry product code).
3. **All applicable GitHub Actions checks are green** on the latest head commit.
   Check the actual run and job conclusions, not just the presence of a run.
4. **Relevant local checks pass** for the code that changed.
5. **No merge conflicts** — the merge must be a clean, ordinary merge.
6. **Worktree is clean** (`git status --short` empty).
7. **Normal merge only.** Never squash or rebase to land a PR unless repository
   policy explicitly requires it.

## When CI does not run

Some branch families have no workflow that triggers for them. If the head commit
has zero workflow runs or zero check runs:

- **Do not merge product code.**
- First add or reuse an appropriate **non-deploying** CI workflow for that base
  branch, wait for green checks, and only then merge.
- `.github/workflows/v1-product-excellence-audit-pr-validation.yml` is that
  workflow for this branch: it triggers only on pull requests targeting
  `kiro/v1-product-excellence-audit`, runs read-only with
  `permissions: contents: read`, and publishes nothing.
- Never widen an existing workflow's trigger to cover a new branch. Each existing
  workflow encodes a review boundary for its own branch family, and reusing its
  green tick for history it never examined is a false signal.

## Never

Regardless of instruction or justification:

- Never **force-push**, rewrite history, or delete branches.
- Never **deploy** anything.
- Never **apply migrations**.
- Never **change Supabase secrets or settings**, and never touch production data.
- Never **configure OAuth**.
- Never **sign builds** or **submit to app stores**.
- Never commit a secret, and never add a CI step that dumps the environment
  (`printenv`, `env`, `process.env`, `os.environ`, `/proc/self/environ`, ...).
  Reference only the specific variables a step needs.

## After a merge

Report, from actual output:

- the **merged PR number**;
- the **merge commit SHA**;
- the **target branch**;
- the **checks** that were green (run id, job conclusions);
- explicit confirmation that **`master` was untouched** and that **no
  deployment, migration, secret change, or Supabase production data change**
  occurred.

## Honesty requirements

These exist because they were violated once in this repository's history: a
baseline was reported from a stale `master` (3 test files / 16 tests) while the
real integration branch had 71 files / 1040 tests, and "all gates green" was
claimed for a branch that had no CI at all.

- Establish the baseline **on the branch actually being changed**, and state its
  SHA. A single-branch clone can hide the real integration branch — check
  `.git/config` for a narrow `fetch` refspec before trusting `git branch -r`.
- Never call something "pre-existing" or "already fixed" without verifying it
  against the current integration HEAD.
- Distinguish what CI printed from what was run locally. Do not attribute a local
  number to a CI log that was never read.
- Report the count of a full, unfiltered suite run, and never delete, skip,
  weaken, rename, or filter existing tests to get there.
