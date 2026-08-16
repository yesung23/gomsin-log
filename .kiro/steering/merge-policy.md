# Merge and safety policy (Kiro)

Scope: this repository. Applies to every Kiro session, including future ones that
have no memory of how these rules were established.

공용 작업 절차는 [`docs/skills/`](../../docs/skills/README.md)가 소유한다. 이 문서는
Kiro가 자동으로 읽는 안전 경계만 담는다. 엔지니어링 계약은 `AGENTS.md`다.

## Merging

**Kiro는 어떤 PR도 merge하지 않는다.** 이전 정책은
`kiro/v1-product-excellence-audit`로의 자동 merge를 허용했으나, 그 브랜치는 현재 활성
스택과 무관해졌고 도구마다 다른 merge 권한을 갖는 것 자체가 위험하다. 세 도구 모두
같은 경계를 쓴다(Claude Code는 hook으로 `gh pr merge`를 차단한다).

- **merge는 사용자만 수행한다.** `master`든 다른 브랜치든 예외가 없다.
- 작성자가 Kiro라는 사실만으로는 근거가 되지 않는다.
- merge가 필요하다고 판단되면 **실행하지 말고** 근거와 함께 사용자에게 보고한다.

PR은 **Draft로 열어 두는 것까지**가 Kiro의 범위다.

## PR을 넘기기 전 확인 (merge와 무관하게 적용)

실제 출력으로 확인한다. 확인할 수 없으면 통과로 쓰지 말고 격차를 보고한다.

1. **Head/base**가 의도한 브랜치이고, diff에 무관한 변경이 없다(`changed_files` 확인;
   정책·CI 변경이 제품 코드를 실어 나르지 않는다).
2. **해당되는 GitHub Actions 체크가 green**이다. run 존재 여부가 아니라 실제 run과 job
   conclusion을 확인한다.
3. 변경된 코드에 대한 **로컬 검증이 통과**한다 → `docs/skills/release-validation.md`.
4. **merge conflict가 없다.**
5. **worktree가 깨끗하다**(`git status --short`).

CI가 없는 브랜치 계열이면 green을 주장하지 않는다. 아래 규칙이 그대로 적용된다.

## When CI does not run

Some branch families have no workflow that triggers for them. If the head commit
has zero workflow runs or zero check runs:

- **CI가 green이라고 주장하지 않는다.** run이 0건이면 그것은 "미검증"이며 통과가 아니다.
- 필요하면 해당 base 브랜치에 **배포하지 않는** CI workflow를 추가하거나 재사용한다.
  기존 예시는 `.github/workflows/v1-product-excellence-audit-pr-validation.yml`로,
  read-only(`permissions: contents: read`)이며 아무것도 배포하지 않는다.
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

## 작업을 넘길 때 보고

실제 출력으로 보고한다.

- **PR 번호와 head SHA**, 그리고 draft 상태
- green이었던 **체크**(run id, job conclusion). run이 없으면 `UNVERIFIED`
- 실행한 검증과 **실행하지 않은 검증**, 그리고 그 이유
- **`master`를 건드리지 않았고**, 배포·migration 적용·secret 변경·Supabase 운영 데이터
  변경이 없었다는 명시적 확인
- `docs/WORK_LOG.md`에 남긴 항목

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
