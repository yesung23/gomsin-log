# 스토리·프로필 게시물·종이 보기 출시 후보 클로저 — 2026-08-28

## 1. 최종 판정

**CONDITIONAL PASS**

로컬 코드, 렌더링, 전체 회귀, PostgreSQL/RLS, Capacitor sync와 Xcode 27 beta simulator
빌드는 PASS다. 독립 보안 재검토도 PASS다. 다만 migration 067은 Production에 없고 최신
화면의 실물 iPhone·두 실제 계정 왕복·Foundation Models 동작은 UNVERIFIED이므로 App Store
제출 가능 판정은 아직 HOLD다.

## 2. exact state

- branch: `codex/profile-post-composer`
- base/reviewed HEAD: `5b3133f2fed5f0cda00908cde32ae632233256b0` 기반 dirty delta
- live `origin/master`: `d9a2eb0a22b657c6384d59d1a53aa668fdb286f0`
- 보존 대상: `.DS_Store`, `src/pages/authCallbackPkceRace.test.tsx`,
  `src/lib/store.test.tsx`의 별도 `INITIAL_SESSION` hunk
- push/deploy: 실행하지 않음

## 3. 변경 파일과 실제 사용자 동작

- `StoryRoute`/`StoryViewer`: 상단의 반복 이름을 빼고 시각은 `HH:mm`, 본문은 17px,
  사진은 잘리지 않는 `contain`, 책갈피·하이라이트·원본 액션은 콘텐츠 아래에 둔다.
- `HandwritingSection`/`paper.css`/`paperTexturePreference`: 44px `무지 종이 / 줄 종이`
  선택을 추가한다. 선택은 계정별 기기 로컬 값이며 서버로 전송하지 않고 재실행·계정 전환에
  다시 적용한다.
- `MobileShell`/`PaperHome`/`SharedProfile`: root scroll을 한 곳으로 제한해 Home/My 상단
  메뉴가 콘텐츠 스크롤 중 고정된다.
- `postTiles`/records/store/migration 067: 일반 Story 사진은 My 게시물 격자에 자동으로
  들어가지 않는다. My `+` 작성기에서 완전한 사진 저장과 공개 범위를 최종 확정한 기록만
  `is_profile_post=true`가 되며, 사진 목록과 원본 Story는 그대로 남는다.
- 타일·상세·원본 이동은 새 복제 행이 아니라 동일한 exact record ID를 계속 사용한다.

## 4. 온디바이스 요약 5개 초과 처리

- 상대의 오늘 적격 기록 전체를 시간순으로 유지한다.
- 처음 5개만 보여 주고 8개이면 `3개 더 보기`로 펼치고 다시 접을 수 있다.
- AI는 중요 항목을 고르지 않고 5개 고정 배치에서 문장 표현만 다듬는다.
- 규칙 요약을 먼저 렌더하고, 사용자가 상대의 오늘 Story를 열었을 때만 추론한다.
- 화면 이탈은 취소하고 전체 4초 deadline, timeout·취소·미지원·잘못된 출력·Segmenter 부재는
  모든 exact-source 규칙 문장으로 되돌아간다. 앱 시작·기록 저장·백그라운드 추론은 없다.

## 5. 개인정보·보안 불변식

- 네이티브 모델 payload는 `{index,text}`뿐이며 ID, 사용자, 날짜·시각, 미디어 URL,
  private 기록, 건강·생리 원자료를 보내지 않는다. 결과를 서버·DB·로그에 저장하지 않는다.
- `is_profile_post`는 cleartext 발행 의도 1비트일 뿐 권한이 아니다. private/shared, owner,
  active couple, Storage와 row RLS가 계속 접근을 결정한다.
- staging INSERT는 private이면서 marker `false`다. 완전한 media attachment, 의도한 공개 범위,
  marker `true`를 마지막 UPDATE에서 함께 확정한다.
- 응답 유실이 의심되면 DB를 read-back해 attachment commit을 확인한다. 확정할 수 없는
  ambiguous 실패에서는 이미 commit됐을 수 있는 새 Storage 객체를 임의 삭제하지 않는다.
- 기존 기록은 발행 의도를 추측해 backfill하지 않는다. 일반·구버전 UPDATE가 필드를 생략하면
  기존 marker가 보존된다.

## 6. 실행한 테스트와 정확한 결과

- 관련 focused Vitest: PASS, 최종 marker 범위 3 files / 112 tests; 전체 관련 묶음도 PASS
- Story/profile/paper/daily-summary Playwright: PASS, 5/5, 320px·390px
- `npm run test:phase0`: PASS, PostgreSQL 17 / 65 migrations / 420 assertions
- `npm run test:p5`: PASS, 105 assertions
- `LANG=en_US.UTF-8 npm run verify`: PASS, typecheck·full lint·260 files / 3,753 tests·
  production build 2,166 modules
- 대상 ESLint와 `git diff --check`: PASS
- `npx cap sync ios`: PASS, 5 plugins, tracked iOS diff 없음
- Xcode 27 beta / iPhoneSimulator 27.0 unsigned build: PASS, `BUILD SUCCEEDED`
- 전체 병렬 부하의 `deviceKeyPort` 테스트: PASS, 12/12 약 221ms; 이전 5초 timeout 미재발
- 독립 UI reviewer: 로컬 동작/테스트 PASS, Production 067 미적용 때문에 release HOLD
- 독립 Sol 보안 closure: PASS, 남은 구체적 보안 결함 없음; Production NOT APPLIED를 명시

## 7. 실패·차단·미검증

- 최신 Story/plain-paper/sticky-header/profile-post 후보의 실제 iPhone safe-area와 제스처: UNVERIFIED
- 실제 로그인 두 계정의 profile post 저장·상대 표시·exact original·재실행 지속성: UNVERIFIED
- Foundation Models 한국어/offline/latency/heat/battery: UNVERIFIED, flag 기본 OFF
- Apple provider, query-aware redirect allowlist, Google/Apple callback/session 왕복: 이번 closure에서
  재검증하지 않음
- Archive/TestFlight/App Store metadata/submission: NOT EXECUTED

## 8. Remote Supabase/Vercel/Apple/실기기 상태

- Supabase: read-only live 프로젝트 `ACTIVE_HEALTHY`; migration ledger는 전부 빈 상태라
  `db push` 금지. 062 RPC 3종은 존재하고 anon 실행은 거부된다. 067 column probe는
  PostgreSQL `42703`으로 실패해 **NOT APPLIED**를 확인했다.
- Vercel: CLI는 logged out. 2026-08-27 마지막 확인 Production `d9a2eb0` 이후 현재 exact
  deployed SHA/env는 UNVERIFIED다.
- Apple/Auth: 개발자 팀 등록·development signing의 이전 PASS와 별개로 provider/redirect,
  Distribution/Archive/TestFlight는 이번 범위에서 UNVERIFIED/NOT EXECUTED다.
- 실기기: 이전 Xcode 27 beta development 설치·launch는 PASS지만 이번 최신 UI delta를 다시
  설치하거나 화면 검증하지 않았다.

## 9. Production에 실제 적용한 것과 적용하지 않은 것

- 실제 적용: 로컬 소스·테스트·문서만 변경
- Supabase migration/Auth/provider: **NOT APPLIED**
- Vercel deploy/env: **NOT APPLIED**
- Apple/TestFlight/App Store Connect: **NOT APPLIED**
- Git push/merge: **NOT APPLIED**

## 10. 가장 작은 다음 출시 단계

Production backup과 catalog를 action-time에 다시 확인한 뒤, 빈 ledger를 신뢰하지 않고
063–066 실제 상태와 의존성을 확인한다. 그 다음 exact 067 한 개의 blast radius와 forward
rollback을 다시 제시해 사용자 확인을 받고, 067 적용 → PostgREST reload → 실제 actor matrix를
수행한다. 이후 정확히 그 commit으로 실물 iPhone development/TestFlight smoke를 진행한다.

## 11. rollback

- 코드: 이 범위의 단일 commit을 revert한다.
- 067 적용 뒤 클라이언트 문제가 있으면 먼저 이전 앱/web commit으로 되돌린다. `false` 기본값
  컬럼은 호환되므로 즉시 DROP하지 않고 unused 상태로 둔 뒤 별도 forward migration에서 정리한다.
- 종이 선택은 기기 로컬 key 삭제 또는 `줄 종이` 재선택으로 되돌린다.
- 이번 작업은 원격을 바꾸지 않아 현재 필요한 Production rollback은 없다.

## 12. 다음 단계 안전성

로컬 후보를 pre-production migration gate로 넘기는 것은 안전하다. 067·provider·deploy를
조용히 적용하거나 곧바로 App Store 제출하는 것은 안전하지 않다. action-time 승인, 실제 actor
matrix, 실물 iPhone/두 계정 smoke가 선행되어야 한다.

## 렌더 증거

- `/tmp/gomsinlog-home-sticky-390.png`
- `/tmp/gomsinlog-profile-sticky-390.png`
- `/tmp/gomsinlog-settings-plain-paper-390.png`
- `/tmp/gomsinlog-story-readable-actions-390.png`
- `ui-audit-results/story-profile-presentation/story-320.png`
- `ui-audit-results/story-profile-presentation/story-390.png`
