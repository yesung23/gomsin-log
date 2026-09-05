# GomsinLog RC Closure Plan — 2026-09-05

Spec: 최신 사용자 승인 + `../PRODUCT_V5_MASTER_DECISION.md`.
순서의 canonical: `../ENGINEERING_ROADMAP.md` §0. 현재 사실: `../CURRENT_STATE.md`.
이 문서는 그 순서를 실행 가능한 작업·검증 범위로 나눈다. 완료 주장은 WORK_LOG의 exact-commit 증거를 따른다.
이전 `/private/tmp/gomsinlog-rc-final-plan.md`의 완료된 항목은 다시 실행하지 않는다.

## Global Constraints

- 앱 작업은 `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`, `codex/rc-v5-final-fixes`에 한정한다.
- 기능·원본 연결·RLS·삭제·E2EE·건강 owner-only·로그 비노출을 보존한다.
- 무료 정상 사진/연결/보안은 유지한다. 가격·수수료·수용량을 가정에서 실제값으로 둔갑시키지 않는다.
- Book Studio는 별도 task가 소유한다. 이 앱에서는 연동 계약만 다루며 Book repo를 수정하지 않는다.
- 하위 모델은 2026-09-05 최신 승인에 따라 역할·위험도별 배정한다. 추론 상한은 max다.
- 동시 하위 에이전트 최대 2명: 구현자 1명 + 독립 검토/탐색 1명. 같은 파일의 병렬 쓰기는 금지한다.
- 각 배정은 목표/범위/수정 허용·금지 파일/성공 조건/테스트/보고 형식을 명시한다. 하위 재위임은 금지한다.
- parent가 실제 diff·호출 경로·테스트를 확인한다. 구현자의 완료 주장은 독립 검토를 대체하지 않는다.
- 새 제품 아이디어는 backlog로 보낸다. 새 발견은 재현되는 결함과 해당 gate의 미충족 조건만 편입한다.
- CRITICAL/HIGH는 닫힐 때까지 release HOLD. 반복 실패 시 같은 전체 작업을 재실행하지 말고 원인/계약을 재설계한다.
- Production/Supabase/Apple/결제/외부 설정/merge는 이 로컬 계획의 실행으로 자동 활성화하지 않는다.
- 증빙·백업·rollback·기존 승인 범위를 확인하고, 추가 권한/결제/법적 선택이 필요하면 그 지점만 보고한다.
- 원본 일괄 업로드·재압축·삭제, 전체 E2EE 완료 주장, 플래그 우회, 고객 콘텐츠 analytics를 추가하지 않는다.

## 역할과 모델 배정

| 역할 | 기본 모델 / 추론 | 책임과 제한 |
|---|---|---|
| Control Tower | 현재 parent | 제품/사업 판단, 경계 승인, 실제 diff 확인, 통합, 최종 gate |
| Explorer | Gemini 3.8 Flash / high | 지정 경로·호출자 탐색, 읽기 전용. 보안 판정은 Architect에게 전달 |
| 좁은 Worker | Gemini 3.8 Flash / high | 정확히 정해진 반복 구현·테스트. DB/auth/crypto 변경 금지 |
| 통합 Worker | GPT-5.6 Sol / high | 업로드/조회/복구처럼 여러 모듈을 연결, 필요 시 max로 한 번 확대 |
| Architect | GPT-5.6 Sol / max | auth/RLS/DB/결제/삭제 계약, read-only 설계. 복잡한 교차 상태 문제는 Astra max 가능 |
| Verifier | GPT-5.6 Sol / high | 실제 호출 경로·diff·테스트, UI/기능 재설계 금지 |
| Independent Reviewer | GPT-5.6 Sol / max | 구현자와 분리한 security/regression 판정. 교차 상태/미해결 중대 결함은 Astra max |

초기 Astra auth/backend 배정은 반환/종료됐고, photo090의 parent 검증과 Sol Max 독립 리뷰도 완료했다.
현재 요약 구현은 Sol High다. 모델을 낮춘다는 이유로 부정 권한 테스트나 독립 리뷰를 생략하지 않는다.
Flash 장애 시 같은 일을 여러 모델에 중복 발송하지 않고, 한 작업의 소유권을 반환받아 Sol로 이전한다.

## Task 1 — Auth 및 기존 미디어 무결성 종결

- 담당: 독립 Reviewer, 수정 필요 시 원 구현자. 아래 로컬 검토는 종료됐고 parent가 증거를 확인했다.
- 기준: Apple fix `d08519f`, media hook `47f5d07`, cleanup 후속 `a8113b7`/`85be85b`.
- 완료: Apple 저장 후 늦은 SIGNED_IN HIGH DELTA + media hook 좁은 검토 PASS;
  086–088 cleanup 누적/계정 삭제 연결도 exact `fb880ed`에서 Sol Max PASS. 실제 provider/실기기는 미검증.
  기존 IAP 완료 영역을 불필요하게 재검토하지 않는다.
- 허용 수정: 리뷰가 지정한 auth/session/store 또는 media cleanup 정확한 파일만 새 Worker brief에 열거한다.
- 금지: provider/서명/Production, 다른 기능 UI, 암호 프로토콜, 광범위 리팩터링.
- 완료 조건: 재현 실패가 수정 후 통과, Google/Apple 정상 로그인·refresh·로그아웃, stale UI 재등장 없음;
  사진 삭제/CAS/응답 유실/소유권 충돌에서 데이터 손실 없음; independent CRITICAL/HIGH 0.
- 검증: 실제 SDK+Store 회귀, PostgreSQL actor/cleanup race, focused lint/typecheck. 실기기/hosted는 별도 표시.

## Task 2 — 사진 저장 비용과 책용 원본 식별

- 담당: Architect→통합 Worker, 별도 Reviewer. backend는 `fb880ed`에서 parent/독립 PASS,
  후속 앱 통합은 Sol High가 기본이다. 전용PG CI 연결도 통합 gate에 포함한다.
- Backend 허용: 신규 `090_record_photo_renditions.sql`, 전용 local PostgreSQL harness만 우선.
- Client 허용: API 확정 뒤 imageSanitization/records/record upload use case/useMediaAttachment,
  실제 gallery/grid 소비자와 직접 테스트. 정확한 파일 목록은 배정 전에 확인한다.
- 금지: 과거 migration 재작성, attachment `{type,name,path}`/crypto format 변경, 별도 Storage bucket/공개 경로,
  전체 원본 보관, 기존 사진 일괄 변경, Book repo 수정.
- 계약: 현재 2048px/.84 master 유지 + 기기에서 640px thumbnail 생성. 실제 치수/bytes/hash/버전으로 결속.
  논리 첨부 수를 줄이지 않고 파생 물리 객체 수만 구분한다. 구버전 글 수정도 thumbnail을 보존한다.
  원본 제거/교체는 master와 thumbnail을 기존 원장/cleanup으로 함께 처리한다.
- 완료 조건: 실제 작성→목록(작은 이미지)→확대(master)→수정/제거 흐름과 실패 복구가 연결된다.
  legacy/metadata 미지원 시 정상 master 흐름을 유지한다. Book에는 `screen_master`임을 명시하며
  최종 crop/인쇄 크기 검증과 부족한 사진만 재선택하는 소비 계약을 별도 Book 담당에게 전달한다.
- 검증: 단일 디코딩·EXIF·용량·부분 업로드·같은 ID 재시도·구버전 수정·32개 논리 첨부·권한 거절·삭제 경합.
  metadata는 client 보고값이며 최종 인쇄 품질은 다운로드 바이트/실제 배치로 다시 검증한다.

## Task 3 — 온디바이스 요약 정확성과 하위 기기 대응

- 담당: Sol Max 의미/성능 계약 설계 후 Sol High Worker, 별도 Max 의미 보존/개인정보 검토.
- 범위: `src/lib/dailySummary/`와 실제 native summary bridge, 연결된 Story 호출/직접 테스트.
  Swift plugin 정확한 파일은 배정 시 live 조회한다. unread/ack/confirmedThrough 상태는 수정 금지.
- 목표: 모든 허용 원문을 접근 가능하게 유지하고 요약 문장마다 정확한 source record를 연다.
  부정문/인용/조건절을 자르며 뜻을 뒤집지 않는다. 감정 추론/관계 평가/원문 자동 선택 금지.
- 성능: 총 기록 수와 모델에 넣을 긴 문장 수를 구분해 배치/시간 상한을 고정한다.
  미지원/저메모리/취소/실패 시 결정적 원문 발췌로 사용할 수 있고 몰래 cloud로 보내지 않는다.
- 완료 조건: 한국어 의미 반례·대량 기록·정확한 이동·취소/화면전환/동시 요청 통과.
  지원 실기기의 지연/메모리/발열/백그라운드 취소와 미지원 기기 fallback을 실제 관찰한다.
- flag OFF 준비와 실제 기기 검증 완료를 분리한다. 물리 장치 미확보는 UNVERIFIED gate다.

## Task 4 — 수익과 결제 운영 경로

- 담당: Sol Max Architect/독립 Reviewer, parent가 사업 경계·외부 의사결정.
- 범위: 기존 `src/lib/iap/`, 대응 Apple IAP Edge/원장, 실제 asset/export 소비 호출자.
- 전략: 무료 핵심 + 권리 확인된 장식/종이 1회 구매 + 책 제작 + 지속 가치가 동작하는 선택형 Plus.
  정액 가격 가설은 StoreKit 실가격과 구분. 학생팩을 실제 요금제/Apple 수수료 승인으로 가정하지 않는다.
- 완료 조건: 구매/복원/취소/환불/권리 회수/계정 삭제를 실제 원장에 일관되게 연결하고,
  사용 증빙은 실제 제공 이벤트만 남긴다. 취소·환불이 원본 기록/사진을 삭제하지 않는다.
- 검증: 이미 통과한 IAP 서버 로직은 변경 delta 중심. 실제 StoreKit 상품/Sandbox/정산·동의·CS 절차는 외부 gate.
- 판매는 실제 제공 가치·법적 notice·상품 승인·소비 증빙이 연결될 때까지 OFF. 환불 거절을 보장하지 않는다.

## Task 5 — 앱 전체 UX·접근성·복구 검증

- 최신 요청 우선 작업(2026-09-05): 복무 EXP 여정. parent 단일 writer, Sol Max 읽기 전용
  계산 위험 점검/최종 DELTA. 새 `ServiceJourney`와 찾기/복무 상세만 변경하며 UI 전면 재설계는 아님.
  기존 photo SliceA는 Hegel이 8개 WIP 파일을 보존하고 반환했다. Store 통합 후 검증은 아직
  하지 않았으므로 이 기능 완료 뒤 정확한 중단점에서 재개한다. 같은 파일의 동시 writer 없음.

- 담당: Sol High Verifier + parent 실제 화면 확인. 좁고 명확한 수정은 Flash High Worker에 배정.
- 범위: Home/Search/Diary/Schedule/Us/My/Story/Call/정원/Shop/온보딩/설정의 실제 경로.
- 기존 종이/아이콘/승인된 캐릭터를 유지한다. 새로운 전면 리디자인을 시작하거나 기능을 감추어 없애지 않는다.
- 완료 조건: 320/375/402/430px, 실제 light/dark, 긴 텍스트·200%·빈/loading/error/offline,
  VoiceOver/focus/44px/reduced-motion/safe-area, 사진 변경/파트너 표시/정원 상호작용 확인.
- 네트워크 지연/세션 만료/재연결/커플 해제/부분 데이터와 정상 고객 동선을 구분해 증거를 남긴다.

## Task 6 — 정확한 RC 통합과 마지막 검토

- 담당: parent 통합 + 구현과 독립된 Sol Max 전체 리뷰. 중대한 교차 상태 쟁점만 Astra Max로 확대.
- 선행: Task1–5 local gate, 미해결 CRITICAL/HIGH 0, 필요한 외부 검증/승인 정리.
- 검증: 한 exact HEAD에서 `npm run verify`, 관련 Edge/PG security-negative, 실제 browser/device,
  사진 전송량·bundle·동시 구독·background 측정. 같은 SHA의 통과 검사를 의례적으로 반복하지 않는다.
- 결과: branch/HEAD/commits/changed files/tests/남은 위험/rollback을 갖춘 READY TO MERGE 판정.
- 기존 master 통합 요청은 존중하되, dirty/병행 작업·자격 증명·외부 확인 blocker가 없을 때만 안전하게 실행한다.
- 그 전까지 '앱 완료', 'Production 적용', '지원 인원 보장'이라고 보고하지 않는다.

## 보고 계약

각 담당은 `완료 / 우려 있는 완료 / 정보 필요 / 차단`과 수정 파일·정확한 명령/결과·미검증을 보고한다.
parent는 원장에 진행/구현/독립 검토/로컬 통과/원격 확인을 분리한다. 사용자에게는 이번 결과,
열린 blocker, 다음 작업만 간결하게 전달한다. 최종 온전한 앱 완료 통지는 Task6 이후에 한다.
