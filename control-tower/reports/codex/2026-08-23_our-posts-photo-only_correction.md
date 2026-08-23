# 우리 게시물 사진 전용 보정 보고서

## 범위

요청한 최종 제품 방향은 다음과 같다.

- `우리 → 게시물`은 여행에서 올린 **사진 게시물 전용** 3열 격자다.
- 글이 없는 사진을 중심으로 보여주며, 글은 사진 아래 보조 캡션이다.
- 타일을 누르면 인스타그램 게시물처럼 사진 중심 상세 화면이 열린다.
- 기존 글·기록 중심 화면은 `우리 → 사진`에 남긴다.
- 상단 프로필 구조·탭 줄·`찾기` 역할별 메인은 변경하지 않는다.

## 구현

- `getPhotoAttachments()`라는 순수 함수로 사진 첨부만 추렸다.
- 게시물 격자는 사진 첨부가 없는 기록과 영상·음성 전용 기록을 제외한다.
- `PhotoPostViewer`를 추가해 사진을 먼저 보여주고, 기존 `RecordMediaGallery`의 서명 URL,
  여러 장 넘기기, 확대 동작을 재사용한다.
- `visibleRecordsForViewer()` 뒤에서 여행 날짜 범위를 적용해 기존 커플 프라이버시 경계를 유지한다.
- `사진` 탭의 `ProfileRecordList`는 그대로 두었다.
- DailyRecord에 여행 외래키를 추가하지 않고 기존 여행/여행 이벤트의 날짜 범위를 사용한다.

## 커밋

- `a773834` — `fix: make our posts photo-only`
- `8d6f67d` — `test: use canonical media path in photo post fixture`
- 위 두 커밋은 사용자 요청에 따라 `master`에 직접 반영했다.

## 검증

- local focused Vitest: PASS — 3 files / 62 tests
- local lint 및 diff whitespace check: PASS
- local `npm run verify` with documented non-secret placeholders: PASS — 221 files / 3202 tests 및 build
- GitHub master validation `32633810978`: PASS
- GitHub native release validation `32633810931`: PASS
- in-app browser production `/us`: HTTP 200; `게시물` 사진 전용 빈 상태와 `사진` 기존 기록 목록을 캡처·확인
- 첫 GitHub 브라우저 실행의 실패는 fixture 한글 파일명이 canonical media-path 규칙에 거부된 테스트 문제였고,
  ASCII `trip-photo.jpg`로 보정한 재실행은 PASS했다.

## 적용하지 않은 것

- Supabase 운영 데이터·스키마·migration은 변경하거나 적용하지 않았다.
- 실제 사용자 사진을 새로 만들거나 삭제하지 않았다.
- 실기기 검증은 실행하지 않았다.
