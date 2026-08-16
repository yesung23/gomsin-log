> **도구 중립 절차서.** Codex·Kiro·Claude Code가 모두 이 파일을 원본으로 읽는다.
> 각 도구의 설정은 이 파일을 가리키는 얇은 래퍼일 뿐이므로, 내용을 도구별로
> 복사하지 않는다. 수정은 여기서 한 번만 한다. 도구별 진입점은 `docs/skills/README.md`.

# Feature Build

먼저 `gomsin-control-tower`로 상태를 복구하고 DIRECTION CHECK를 기록한다.

## 1. 조사 — 기존 구현을 재사용한다

새로 만들기 전에 이미 있는지 확인한다. 이 저장소에서 반복된 실제 결함은
**구현은 존재하는데 어떤 사용자 경로에서도 호출되지 않는 것**이었다.

```bash
rg -n "<symbol>" src/ --glob '!*.test.*'   # 정의
rg -n "<symbol>" src/ | rg -v '\.test\.'   # 호출자 — 0이면 미연결
```

"코드가 존재한다"와 "실제 사용자 경로에서 사용된다"를 구분해 보고한다.

## 2. 설계

- 핵심 루프를 깨지 않는다: 기록 → 상대방의 오늘 → 정확한 원본 → 이따 이야기하기 →
  실제 대화. 요약 항목은 **정확한** 원본을 가리켜야 한다.
- 신규 기능 명세는 `docs/PRODUCT_V3.md` §14.2의 네 항목을 포함한다.
- 새 평문 사용자 콘텐츠 컬럼을 추가하지 않는다.
- 시각 재설계는 별도 workstream이다. 기능·보안 이유가 없으면 UI를 바꾸지 않는다.
- 가장 작은 변경을 택한다. 무관한 refactor를 하지 않는다.

고위험(암호 신뢰모델·권한·migration·데이터 손실·대규모 구조 변경)이면 먼저 plan을
세우고 self-critique한 뒤 구현한다.

## 3. 구현

표현 계층이 Supabase 권한·RLS·암호 내부를 알아야 하게 만들지 않는다. 경계는
UI → hook → use case → repository → crypto/authorization → Supabase다.

## 4. Targeted test

변경한 경로만 먼저 좁게 돌린다.

```bash
npx vitest run <path>
```

보안 관련이면 성공 경로만으로 부족하다. 비인가·이전 파트너·anon·비공개 거부 같은
negative test를 포함한다. 테스트 개수를 근거로 삼지 않는다.

## 5. Integration validation

종료 전에 `gomsin-release-validation`을 사용한다.

## 6. 문서

- `docs/WORK_LOG.md` — 항목 하나 (`AGENTS.md` §18 형식)
- `docs/CURRENT_STATE.md` — 현재 현실이 바뀐 경우만
- `docs/ENGINEERING_ROADMAP.md` — 순서·gate가 바뀐 경우만

제품 전략은 구현이 바뀌었다는 이유로 수정하지 않는다.

## 7. Commit → push → Draft PR

```bash
git add <의도한 경로만>      # git add -A 를 쓰지 않는다
git commit -m "<type>: <설명>"
git push -u origin <branch>
gh pr create --draft --base <base> --title "..." --body "..."
```

master merge와 PR merge는 하지 않는다. Draft를 유지한다.

## 8. 최종 보고

changed files · changed behavior · DB/schema · **실제 적용된 remote 변경** ·
실행한 테스트 · 실행하지 않은 테스트와 이유 · 남은 위험 · rollback · 다음 단계
시작 가능 여부. 가정을 검증된 사실로 제시하지 않는다.
