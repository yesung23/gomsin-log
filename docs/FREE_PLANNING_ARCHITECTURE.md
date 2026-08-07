# 무료 우선 일정·여행 플래너 구조

## 기본 원칙

핵심 기능은 외부 지도 API 키나 결제수단이 없어도 작동한다.

- 공유 일정과 할 일: 기존 Supabase 프로젝트의 `events`, `couple_tasks` 사용
- 여행 장소와 방문 순서: `trip_items` 사용
- 지도 캡처 읽기: Tesseract.js를 브라우저에서 실행하며 이미지는 서버로 업로드하지 않음
- 장소 열기: 저장된 상호명·주소로 네이버지도 검색 URL을 열며 API 호출 없음
- 동선 순서: 서버의 원자적 `reorder_trip_items` RPC를 그대로 사용

OCR 실행 파일과 한국어 학습 데이터는 `public/ocr`에 자체 호스팅한다. 따라서 외부 CDN 장애,
CORS, CSP, 사용량 과금에 의존하지 않는다. 약 5.6MB의 OCR 자원은 사용자가 캡처 읽기를
눌렀을 때만 내려받는다.

## 선택적 지도 검색 API

장소 자동완성이나 좌표 검색이 필요해지면 `TripItem.source = 'kakao'`로 저장하는 Kakao Local
어댑터를 별도 Edge Function으로 추가한다. REST 키를 Vite 환경변수에 넣으면 브라우저에
노출되므로 클라이언트에서 직접 호출하지 않는다.

2026-07-21부터 Kakao Map API의 무료 쿼터는 개발자 계정에서 처음 활성화한 지도 앱 하나에만
제공된다. 무료 한도를 넘거나 두 번째 앱부터는 Biz Wallet이 필요할 수 있으므로 현재 기능의
필수 의존성으로 사용하지 않는다.

- 정책: https://developers.kakao.com/docs/ko/kakaomap/common
- 쿼터: https://developers.kakao.com/docs/ko/getting-started/quota
- OCR: https://github.com/naptha/tesseract.js

공용 OpenStreetMap Nominatim 서버는 자동완성 금지, 최대 초당 1회, 캐시·식별자·출처 표시 등의
제약이 있고 일반적인 앱 검색 서비스에 그대로 내장하기에 적합하지 않아 사용하지 않는다.

## 배포 순서

1. `018_shared_tasks_and_trip_places.sql`을 Supabase SQL Editor에서 실행한다.
2. 결과가 성공인지 확인한 뒤 웹 앱을 배포한다.
3. 두 계정으로 같은 날짜의 할 일 추가·완료가 실시간 반영되는지 확인한다.
4. 여행 장소 추가에서 지도 캡처를 올리고 상호명·주소·영업시간을 확인·수정한 뒤 저장한다.

OCR 결과는 참고값이다. 지도 화면 구성과 글꼴에 따라 틀릴 수 있으므로 자동 저장하지 않고 항상
사용자가 확인할 수 있는 입력칸에 먼저 채운다.
