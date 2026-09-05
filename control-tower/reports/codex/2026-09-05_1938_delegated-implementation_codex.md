# RC delegated implementation — 2026-09-05 19:38 KST

## Decision

최신 사용자 지시대로 parent는 계획·배분·검증·통합만 맡고 source/test를 직접 구현하지 않는다.
`subagent-driven-development`, `dispatching-parallel-agents`, `using-git-worktrees`,
`requesting-code-review` 절차를 사용하되 사용자/저장소 경계가 generic auto-commit/push보다 우선한다.
기존 linked worktree를 그대로 사용하며 의례적인 전체테스트·중복agent를 만들지 않는다.

- Worktree `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`
- Branch `codex/rc-v5-final-fixes`, dispatch HEAD `1c7503e620b9958adf3dad0b30f037bfea6b46c0`
- 기존 Apple 정책/Store identity WIP 보존. parent claim은 실행 중인 하위작업의 점유를 나타낸다.
- 기준: 최신 지시, V5§11/RC6task, 현재상태·직전원장, photo무료핵심 BUSINESS§9.5.
  전략충돌 없음. Bohr의 기존 SolMax 서버 architecture결정은 동일runtime 기준에서 재사용했다.

## Active ownership

| 역할 | 모델/추론 | 실제 agent | 범위 |
|---|---|---|---|
| 구현자 Herschel | GPT-5.6 Sol high | 01a07123-3249-72f0-8cf9-2f55739b3f23 | Apple code 등록·암호화 token보관·탈퇴 revoke 서버/091/local tests |
| 독립 검토자 Lovelace | GPT-5.6 Sol max | 01a07123-33f0-73f3-aa6b-f9fa28acf5fd | 기존 Store identity test1파일 실제 event/격리 검증, READONLY |
| Parent | 현 Control Tower | 현재 task | 다음 사진표시 계획·결과 판단·실제검증·보고, source수정 없음 |

두 하위모델 모두 fresh context, 하위재위임/remote/commit/stage 금지다. 서버writer가 허용파일
목록을 벗어나야 하면 먼저 정확한 파일/이유를 보고한다. 검토자는 어떤 파일도 쓰지 않는다.
두 실제 spawn handle을 받았다. 최초 wait는 timeout이며, 종료/실패/완료 증거가 아니다.

## Exact work artifacts

계획별 ignored workspace `.superpowers/sdd/rc-closure-plan-2026-09-05/`:

- `task-1-apple-server-brief.md`: 목표, 기존architect 결정, 허용경로, 서버 권한·replay·삭제경합·
  비밀로그금지, localPG/Edge 부정경로, 보고·후속 native caller gate.
- `task-1-apple-server-report.md`: 구현자 반환 예정. 존재/완료를 선제 주장하지 않음.
- `task-1-identity-continuity-brief.md`/`report.md`: 앞선 테스트 요구·구현자 주장.
- `task-1-identity-review-package.md`: review에 전달한 해당1파일 actual diff.
- `task-2-display-planning-notes.md`: 실제 records fetch/signing/metadata090/grid/gallery/Us caller
  확인으로 작성한 다음 작업 계획. 아직 최종write brief나 구현완료가 아니다.
- `progress.md`: 기존 완료gate와 현재실행/agent ID를 분리한 복구지도.

## Photo planning findings

640px thumbnail을 생성/업로드해도 현재 consumer는 master URL을 사용한다. 목록 작은격자만640으로
전환하고, 430px3x 화면 fullwidth/gallery/fullscreen은master를 유지해 선명도를 보존한다.
Metadata조회는 batch100, 원본 master attachment identity/저장format불변, 권한/계정변경/응답역전
무효화를 유지한다. Grid에서 쓰던 displayed URL을 fullscreen에 그대로 넘기지 않도록 분리한다.
Book앱전용 export caller는 아직 발견되지 않았으므로 미연결helper를 완료라고 보고하지 않는다.
실제Book 담당이 exactsource·master치수/hash/인쇄crop PPI를 소비할 계약은 별도 조율한다.

## Gates / next steps

서버 반환→parent diff/실행증거→별도 SolMax server security/spec review→수정은하위구현자→
client/native실제호출/서명·provider·실기기 gate. 기존 identity test review의 결함도 parent가
직접 고치지 않고 단일writer 반환 뒤 정확한scope로 배정한다. 이후 Task2B를 실행한다.

새 server 구현의 완료/보안/실제Apple로그인 증거는 아직 없다. Supabase/키/앱flag/DDL/배포/master
추가변경은 NOT APPLIED다. 앞선 Apple portal capability만 APPLIED이며 이를 전체인증완료로
확장하지 않는다. 전체RC목표를 줄이거나 완료처리하지 않는다.

## Followup allocation

Lovelace의 identityreview/후속설명은 반환 후 종료했다(1949report). Herschel서버worker는
동일handle에서 계속 작업중이며 sharedhelper/Edge/091/config/lock WIP가 관찰됐다. 완료/테스트
반환 전이라 gatePASS로 판정하지 않는다. timeout은 agent실패/재시작근거로 사용하지 않았다.
빈readonlyseat는 Maxwell SolMax `01a07139-7e5b-75c1-a23a-0aed4b4349c3`에게 배정했다:
현재Xcode효과설정/bridge/실행artifact와 signedApple·실물FoundationModels검증조건만 확인한다.
source/설정/secret/profile/기기수정·설치·실행·재위임은금지. 두agent/한writer 제한을 유지한다.
