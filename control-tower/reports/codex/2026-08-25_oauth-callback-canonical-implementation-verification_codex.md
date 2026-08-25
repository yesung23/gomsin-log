# OAuth callback canonical 구현·검증 보고서

- 기준일: 2026-08-25
- 저장소: `/Users/han-yejun/Desktop/곰신로그`
- Branch: `codex/service-rank-profile-settings-impl`
- Base / checked-out HEAD: `f02e93a26e9b6d73073cd42f6247a8ab30f2971a`
- 상태: working tree에만 존재, commit/push/PR/deploy 없음
- 코드 판정: **APPROVE — fresh Sol Max P0~P3 finding 없음**
- 출시 판정: **HOLD — 원격 redirect allow-list와 실제 provider/실기기 미검증**

## 1. 구현된 범위

- native와 web callback은 authorization code와 검증된 `sb_flow_id`만 받는다. `access_token`/`refresh_token`을 직접 `setSession`하는 fallback은 없다.
- Supabase Auth 2.111의 flow별 verifier 슬롯을 사용하도록 `exchangeCodeForSession(code, { flowId })`로 명시 결속했다.
- PKCE token request는 15초 transport deadline을 갖는다. 이 deadline은 응답 header뿐 아니라 body 전체 소비까지 유지되고, timeout 뒤 늦은 body가 와도 성공 응답으로 전달되지 않는다.
- native callback은 8개 pending queue로 직렬화하고, remembered callback 16개와 cold-start failure 8개로 메모리를 제한한다.
- exchange, `onFailure`, `Browser.close`, deferred sink, listener 등록·해제 실패가 다음 callback이나 앱 시작을 고착시키지 않도록 격리했다.
- queue가 가득 찬 callback도 Custom Tab을 안전하게 닫고 일반 실패 메시지를 전달한다.
- React StrictMode에서 Sonner가 실제 mount된 다음 commit에 cold-start failure sink를 활성화한다.
- provider raw error, description, code, token pair를 변경된 OAuth 경로의 로그에 출력하지 않는다.

## 2. 실제 SDK·원격 상태 확인

설치된 `@supabase/supabase-js`와 `@supabase/auth-js`는 모두 2.111.0이다. SDK 소스에서 다음 계약을 직접 확인했다.

- `appendPkceFlowIdToRedirects`는 OAuth redirect URL에 `sb_flow_id`를 추가한다.
- explicit `flowId` 교환은 해당 flow verifier 슬롯만 읽고 제거한다.
- token endpoint의 `fetch()`가 끝난 뒤 SDK가 `response.json()`을 읽고, 그 다음 세션을 저장한다. 따라서 body까지 deadline에 포함해야 late-session을 막을 수 있다.

Supabase Dashboard 프로젝트 `xzlorqsjajokrlkunxhr`를 읽기 전용으로 확인했다.

- Site URL: `https://gomsin-log.vercel.app`
- Redirect URLs: localhost 2개, `gomsinlog://auth/callback`, production web callback의 정확한 4개
- `sb_flow_id` query를 허용하는 wildcard/parameterized entry: 없음
- Save 클릭이나 원격 값 변경: 없음

따라서 현재 코드의 parameterized callback은 로컬에서 생성·검증되지만, 원격 Auth가 실제 provider return을 허용하는지는 **BLOCKED/UNVERIFIED**다. [Supabase redirect URL 문서](https://supabase.com/docs/guides/auth/redirect-urls)는 `redirectTo`가 allow-list와 일치해야 하고 wildcard를 지원한다고 설명한다. 배포 전에 기존 exact URL을 보존하면서 query가 붙은 web/native callback을 허용하는 최소 entry와 rollback을 별도 승인해야 한다.

## 3. 실행 결과

| 상태 | 명령/경로 | 정확한 결과와 증명 범위 |
|---|---|---|
| PASS | focused OAuth/Auth logging Vitest | 6 files / 89 tests. flow binding, token refusal, header/body timeout, late success 거부, duplicate/serialization/eviction, queue-full, listener·Browser·sink throw, StrictMode mount, email throw canary 비노출을 검증했다. |
| PASS | Opus negative mutation runs | body-deadline 구현 제거 시 4 tests 실패, queue/listener 방어 제거 시 5 tests 실패. 정적 문자열만으로 통과하지 않는다. |
| PASS | 대상 ESLint `--max-warnings 0` | 변경된 OAuth 파일 lint 성공. |
| PASS | `npm run typecheck` | current TypeScript graph 성공. |
| PASS | `LANG=en_US.UTF-8 npm run verify` | typecheck, 전체 lint, 235 files / 3,361 tests, production build 2,155 modules 모두 성공. 기존 500 kB chunk warning만 있다. |
| PASS | `npm run test:phase0` | throwaway PostgreSQL 17, 58 migrations / 333 actor·security assertions. OAuth나 원격 Supabase 자체 증거는 아니다. |
| PASS | `npm run verify:native` | 4 files / 96 tests. native project 정적 계약이며 실기기 증거는 아니다. |
| PASS | 기존 실제 브라우저 fragment-token callback | token pair가 세션으로 채택되지 않고 실패 UI·2.5초 복귀·token console 비노출을 확인했다. |
| UNVERIFIED | 실제 Google/Apple/email PKCE 성공 | provider 인증 계정으로 실행하지 않았다. |
| UNVERIFIED | iOS/Android cold start·Custom Tab | simulator/physical device callback을 실행하지 않았다. |
| BLOCKED | 원격 parameterized redirect | 현재 exact 4 entries에는 `sb_flow_id` query 허용 규칙이 없다. 변경은 하지 않았다. |
| NOT APPLIED | commit/push/PR/Vercel/Supabase/OAuth console | 모두 수행하지 않았다. |

## 4. 독립 검토 이력

첫 fresh Sol Max 검토는 flow binding을 CLOSED로 판정했지만 header 뒤 body가 지연되는 P1, raw OAuth start error log P3, listener/queue-full 복구 P3를 찾아 **HOLD**했다.

Kiro CLI의 `claude-opus-5`가 이 세 항목을 제한된 5개 파일에서 구현하고 mutation proof를 추가했다. Codex는 실제 diff와 SDK call path를 다시 읽고 focused 88/88, lint, typecheck, 전체 verify를 독립 재실행했다.

변경된 exact diff의 첫 검토 호출은 stream disconnect로 결과를 내지 못했다. 새 Sol Max reviewer가 저장소·branch·HEAD preflight, SDK 2.111, focused 5 files / 88 tests, typecheck, 대상 lint, runtime `setSession`·로그 검색을 독립 재실행했다.

- P0: NONE
- P1: NONE
- P2: NONE
- P3: NONE
- CODE VERDICT: **APPROVE**
- RELEASE VERDICT: **HOLD**

flow binding, token-pair refusal, header+body timeout, code-less `getSession`, native queue recovery, callback/listener/Browser/sink 격리, queue-full close/report, 민감 로그 배제는 모두 CLOSED로 판정됐다. 이 판정은 현재 OAuth dirty snapshot에만 유효하며 scoped file이 바뀌면 stale이다.

Kiro Opus가 별도 email magic-link catch의 raw exception log를 P3로 찾았다. Sol High가 실제
도달성과 SDK error path를 확인한 뒤 static one-argument log와 runtime canary negative test를
권고했고, Sol implementer가 `src/lib/supabaseAuthLogging.test.ts`와 최소 한 줄 patch를 추가했다.
Fresh Sol Max DELTA는 P0~P3 NONE, raw-log P3 CLOSED, CODE APPROVE, RELEASE HOLD로 판정했다.

## 5. 남은 gate

1. 원격 Supabase에 필요한 parameterized redirect entry와 rollback을 별도 승인한 뒤 적용한다.
2. Google/Apple 실제 계정으로 web 성공·취소·오류·중복 callback을 검증한다.
3. iOS/Android 실기기에서 cold start, warm return, Browser close, 네트워크 timeout, 재시도를 검증한다.
4. 그 exact 상태에서 release validation을 다시 실행한 뒤에만 commit/PR/deploy를 검토한다.

## 6. 수정하지 말아야 할 것

- OAuth 보안 수정에 iOS/Android project, migration, crypto/keystore, Search UI를 섞지 않는다.
- 원격 allow-list와 실제 provider proof 없이 merge/deploy하지 않는다.
- timeout을 UI Promise race로 되돌리지 않는다. underlying token transport와 body 소비가 실제로 취소돼야 한다.
- fragment/query token pair fallback이나 code-less session 채택을 code callback 경로에 다시 넣지 않는다.
