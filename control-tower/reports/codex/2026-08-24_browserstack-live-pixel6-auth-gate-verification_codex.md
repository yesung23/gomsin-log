# BrowserStack Live 실제 앱 검증 — GitHub 학생 로그인 후 Pixel 6 대체 세션

일자: 2026-08-24
소유자: Codex primary
결과: PARTIAL / BLOCKED

## 검증 범위

사용자가 제공한 BrowserStack Live URL을 열고, 실패하면 `https://www.browserstack.com/github-students`의 GitHub 로그인 경로를 사용해 실제 곰신로그 배포 화면을 Android Chrome에서 확인했다.

## 인증 및 세션

- Live URL은 BrowserStack 로그인 화면으로 이동했다.
- GitHub 학생 페이지의 `Sign Up with GitHub` 링크를 클릭했다.
- GitHub 계정 인증 후 BrowserStack Live 대시보드까지 진입했다.
- 비밀번호, OTP, CAPTCHA는 입력하지 않았다.
- BrowserStack Live 세션이 시작되었다.

## 기기 차이

- 요청된 `Google Nexus 6 / Android 6.0 / Chrome`은 현재 BrowserStack Android 기기 목록에 없었다.
- 목록에서 같은 Google 계열의 가장 오래된 대체 기기 `Google Pixel 6 / Android 12 / Chrome`을 선택했다.
- 따라서 아래 결과는 요청 기기 결과가 아니라 Pixel 6 대체 기기 결과다.
- BrowserStack 화면은 세션이 실제 기기라고 표시했으며, 세션 제목은 `Google Pixel 6 v12.0`이었다.

## 실제 배포 화면 확인

대상 배포 URL: `https://gomsin-log.vercel.app`

- `/search`: 배포 앱이 로드되었고 곰신로그 인증 안내 화면이 렌더링되었다.
- `/us`: 동일 인증 안내 화면이 렌더링되었다.
- `/settings`: 동일 인증 안내 화면이 렌더링되었다.
- 화면에는 약관·개인정보 동의 체크박스와 `Google로 계속하기` 진입점이 보였다.
- 빈 화면이나 브라우저 오류 화면은 확인되지 않았다.

## 한계

- BrowserStack 원격 기기에 곰신로그 로그인 세션이 없었다.
- 약관 동의, Google OAuth, 곰신로그 계정 비밀번호·OTP를 대신 입력하지 않았다.
- 따라서 찾기 탭의 복무 정보, 마이 탭, 기록 작성, 사진 상세, 하이라이트 편집 등 인증 후 화면은 검증하지 못했다.

## 판정

- BrowserStack GitHub 학생 로그인: PASS
- BrowserStack Live 세션 시작: PASS
- 요청 기기 `Nexus 6 / Android 6.0`: UNAVAILABLE
- Pixel 6 대체 기기에서 배포 앱 로드: PASS
- 비로그인 인증 보호 동작: PASS — 세 경로 모두 인증 안내 화면으로 보호됨
- 인증 후 실제 기능 검증: BLOCKED
- 저장소 코드·DB·Supabase·Vercel·PR·배포 변경: 없음

다음 단계는 사용자가 BrowserStack 원격 Pixel 6 화면에서 곰신로그 테스트 계정으로 직접 로그인하는 것이다. 로그인 후 동일 세션에서 인증 후 기능을 다시 검증해야 한다.
