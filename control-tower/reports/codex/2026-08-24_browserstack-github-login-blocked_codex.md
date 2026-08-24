# BrowserStack GitHub 로그인 및 실기기 검증 시도

일자: 2026-08-24
소유자: Codex primary
결과: BLOCKED

## 요청 범위

사용자가 제공한 BrowserStack Live URL에서 GitHub 계정으로 로그인한 뒤 실제 곰신로그 앱을 검증한다.

## 확인한 사실

- BrowserStack Live URL을 별도 탭에서 열었다.
- BrowserStack 로그인 화면으로 리다이렉트되었다.
- 현재 로그인 화면에 노출된 방법은 `Sign in with Google`과 BrowserStack 비즈니스 이메일·비밀번호 입력뿐이었다.
- 화면 DOM에서 GitHub 로그인 버튼이나 GitHub OAuth 링크는 확인되지 않았다.
- 별도 GitHub 탭이 로그인되어 있어도 BrowserStack의 현재 로그인 화면과 자동으로 연결되지 않았다.
- BrowserStack 세션을 시작하거나 앱 URL을 원격 Android 기기에 로드하는 단계까지 도달하지 못했다.

## 안전 경계

- 비밀번호, OTP, CAPTCHA, API 키를 입력하지 않았다.
- BrowserStack 계정을 새로 만들지 않았다.
- Google 로그인이나 임의의 OAuth 엔드포인트를 추측해서 시도하지 않았다.
- 저장소 코드, Supabase, Vercel, PR, 배포 상태를 변경하지 않았다.

## GitHub Education 링크 추가 확인

- `https://education.github.com/pack/redeem/browserstack-student`는 BrowserStack 리딤 화면이 아니라 GitHub Student Developer Pack 전체 페이지(`/pack`)로 리다이렉트되었다.
- 해당 페이지의 Student Developer Pack 가입 링크를 따라가 GitHub Education benefits 화면을 확인했다.
- 현재 GitHub 계정은 인증되어 있고 학생 혜택이 사용 가능한 상태로 표시되었다.
- 로드된 Student Developer Pack의 파트너 목록과 페이지 DOM에서 BrowserStack 항목은 확인되지 않았다.
- 따라서 GitHub 로그인 자체는 확인했지만, 이 링크로 BrowserStack Live 세션을 자동 인증하거나 BrowserStack 학생 리딤을 완료할 수는 없었다.

## 판정

현재 BrowserStack 로그인 화면에는 GitHub 인증 경로가 없고, 제공된 GitHub Education 리딤 링크도 BrowserStack offer로 연결되지 않아 실제 앱 검증은 BLOCKED다. 사용자가 BrowserStack 계정으로 직접 로그인하거나, 로그인 완료 후 BrowserStack 탭을 다시 넘겨주면 동일 탭에서 검증을 이어갈 수 있다. 로그인 후에는 배포된 앱 기준으로 `/search`, `/us`, `/settings`와 기록·사진 상세 경로를 확인하며, 로컬 dirty worktree의 미배포 변경은 이 검증 결과로 간주하지 않는다.

## 증거 범위

- 브라우저: Codex In-app Browser의 별도 BrowserStack 탭
- 대상: 사용자가 제공한 BrowserStack Live URL
- 로그인 화면 제목: `BrowserStack Login | Sign Into The Best Mobile & Browser Testing Tool`
- 앱 화면 검증: UNVERIFIED
- 원격 데이터·배포 변경: NOT APPLIED
