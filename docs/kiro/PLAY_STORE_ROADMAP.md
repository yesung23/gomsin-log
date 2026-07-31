# Google Play 출시 로드맵

> ⚠️ **아직 제출하지 않았습니다.** 제출은 되돌리기 어렵고 비용/심사가 걸려 있어
> 반드시 사람이 직접 해야 합니다. 이 문서는 그 순서를 정리한 것입니다.

## 현재 상태

| 항목 | 상태 |
| --- | --- |
| Capacitor 설정 (`capacitor.config.ts`) | ✅ 완료 |
| 네이티브 구글 로그인 (딥링크) 코드 | ✅ 완료 |
| `android/` 네이티브 프로젝트 | ❌ 미생성 (아래 1단계) |
| 앱 아이콘 / 스플래시 | ⚠️ SVG만 있음, PNG 필요 |
| 서명 키(keystore) | ❌ 미생성 |
| 개인정보 처리방침 URL | ⚠️ 앱 내 문서는 완료, 공개 URL 필요 |
| Play Console 계정 | ❌ 확인 필요 (등록비 $25 1회) |

---

## 1. 안드로이드 프로젝트 생성

개발자 컴퓨터에서 (Android Studio 필요):

```bash
npm install
npm run cap:add:android   # android/ 폴더 생성
npm run cap:sync          # 웹 빌드 후 android/ 로 복사
npm run cap:open          # Android Studio 열기
```

`android/` 는 Git에 넣지 않습니다(생성물). 대신 **손으로 고쳐야 하는 부분**을
아래에 적어 두었으니, 프로젝트를 다시 만들 때 그대로 다시 적용하세요.

### 1-1. 딥링크 등록 (구글 로그인에 필수)

`android/app/src/main/AndroidManifest.xml` 의 `<activity>` 안에 추가:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="gomsinlog" android:host="auth" />
</intent-filter>
```

이게 없으면 구글 로그인 후 앱으로 돌아오지 못합니다.
`gomsinlog` 라는 값은 `capacitor.config.ts` 및 `src/lib/platform.ts` 와 반드시
같아야 합니다 (`src/lib/platform.test.ts` 가 이 일치를 검사합니다).

### 1-2. 권한

`AndroidManifest.xml` 에 필요한 권한:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

- `RECORD_AUDIO` : 음성 기록 기능에 필요
- 카메라/갤러리는 시스템 파일 선택기를 쓰므로 별도 권한이 필요 없습니다
- 위치·연락처 권한은 **넣지 마세요.** 쓰지 않는 권한은 심사에서 문제가 됩니다

---

## 2. 아이콘과 스플래시

현재 `public/icons/` 에 SVG만 있습니다. Play Store는 PNG를 요구합니다.

필요한 것:
- **앱 아이콘**: 512×512 PNG (투명 배경 없음)
- **적응형 아이콘**: 전경/배경 레이어 (Android Studio의 Image Asset 도구 사용)
- **그래픽 이미지**: 1024×500 PNG
- **스크린샷**: 휴대폰용 최소 2장 (권장 4~8장), 16:9 또는 9:16

`@capacitor/assets` 로 자동 생성할 수 있습니다:

```bash
npx @capacitor/assets generate --android
```
(`assets/icon.png` 1024×1024 와 `assets/splash.png` 2732×2732 를 먼저 준비)

---

## 3. 서명 키 만들기

```bash
keytool -genkey -v -keystore gomsinlog-release.keystore \
  -alias gomsinlog -keyalg RSA -keysize 2048 -validity 10000
```

> 🔐 **이 파일과 비밀번호를 잃어버리면 앱을 두 번 다시 업데이트할 수 없습니다.**
> 비밀번호 관리자에 저장하고, 파일은 별도로 안전하게 백업하세요.
> `.gitignore` 에 `*.keystore` 가 있어 Git에는 올라가지 않습니다.

Play Console의 **Play 앱 서명**을 사용하는 것을 권합니다(키 분실 대비).

---

## 4. 릴리스 빌드

```bash
npm run cap:assemble
# → android/app/build/outputs/bundle/release/app-release.aab
```

`.aab`(Android App Bundle)를 업로드합니다. `.apk`는 신규 앱에 허용되지 않습니다.

빌드 전 확인:
- `.env` 의 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` 가 **운영값**인지
- Supabase Redirect URLs 에 `gomsinlog://auth/callback` 이 있는지

---

## 5. Play Console 등록 정보

### 5-1. 필수 입력

| 항목 | 값 |
| --- | --- |
| 앱 이름 | 곰신로그 |
| 패키지명 | `app.gomsinlog` (**변경 불가**) |
| 카테고리 | 라이프스타일 또는 소셜 |
| 콘텐츠 등급 | 설문 응답 (아래 참고) |
| 개인정보 처리방침 URL | **공개 URL 필요** |

개인정보 처리방침은 앱 안에 이미 있습니다(`/legal/privacy`). 배포된 웹 주소를
쓰면 됩니다: `https://<앱-주소>/legal/privacy`
이용약관: `https://<앱-주소>/legal/terms`

### 5-2. 데이터 보안 양식 (Data safety)

이 앱이 실제로 수집하는 것만 신고하세요. 거짓 신고는 정지 사유입니다.

| 데이터 | 수집 | 공유 | 목적 |
| --- | --- | --- | --- |
| 이메일 주소 | 예 | 아니오 | 계정 관리 |
| 이름(닉네임) | 예 | 아니오 | 앱 기능 |
| 사진·동영상 | 예 | 아니오 | 앱 기능 |
| 음성·오디오 | 예 | 아니오 | 앱 기능 |
| 건강 정보(주기 기록) | 예 | 아니오 | 앱 기능 (**본인만 열람**) |
| 위치 | **아니오** | - | - |
| 연락처 | **아니오** | - | - |
| 광고 식별자 | **아니오** | - | - |

추가로 체크할 항목:
- ✅ 전송 중 암호화 (HTTPS)
- ✅ 사용자가 데이터 삭제를 요청할 수 있음 (설정 → 계정 삭제)

### 5-3. 콘텐츠 등급

- 폭력·성적 콘텐츠·도박·약물: 모두 없음
- **사용자 간 상호작용: 있음** (1:1로 연결된 상대에게만 기록 공유)
  - 단, 실시간 채팅 기능은 없습니다
- 위치 공유: 없음

### 5-4. 앱 접근 권한

심사자가 로그인해서 확인해야 하므로, **테스트 계정을 제공**하세요.
Play Console → 앱 콘텐츠 → 앱 접근 권한 → "모든 기능에 로그인 필요" 선택 후
심사용 이메일/코드 안내를 적습니다.

> 이 앱은 커플 연결이 필요하므로, 심사자용으로 **이미 서로 연결된 계정 2개**를
> 준비해 주는 것이 좋습니다. 그러지 않으면 심사자가 기능을 볼 수 없어
> 반려될 수 있습니다.

---

## 6. 출시 순서 (권장)

1. **내부 테스트** — 본인 계정 1~2개. 즉시 배포됨.
2. **비공개 테스트** — 지인 5~10명. 실제 기기/통신 환경 확인.
3. **공개 테스트(선택)** — 넓은 기기 커버리지.
4. **프로덕션** — 단계적 출시 20% → 50% → 100% 를 권합니다.

각 단계 전 `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` 를 다시 통과시키세요.

---

## 7. 제출 전 최종 점검

- [ ] `npm run verify` 전부 통과
- [ ] `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` 전 항목 완료
- [ ] 마이그레이션 013 운영 적용 완료
- [ ] `delete-account` Edge Function 배포 완료
- [ ] 2계정 수동 테스트 ❌ 0개
- [ ] 실기기에서 구글 로그인 성공 (딥링크 확인)
- [ ] 실기기에서 사진·영상·음성 업로드 성공
- [ ] 다크 모드 전 화면 확인
- [ ] keystore 백업 2곳 이상
- [ ] 개인정보 처리방침 URL 접속 확인
- [ ] 데이터 보안 양식이 실제 동작과 일치
- [ ] 심사용 연결된 테스트 계정 2개 준비

---

## 알려진 제약

- **iOS는 범위에 없습니다.** `capacitor.config.ts` 는 안드로이드 기준이며,
  Apple 로그인 코드는 있지만 iOS 빌드는 검증되지 않았습니다.
- **푸시 알림이 없습니다.** 상대가 기록을 남겨도 알림이 가지 않습니다.
  (기능이 없기 때문에 관련 UI도 제거했습니다.)
- **채팅 기능은 의도적으로 없습니다.**
- 번들이 약 520KB(gzip 약 151KB)로, 코드 분할을 하면 첫 로딩이 빨라집니다.
  출시를 막는 문제는 아닙니다.
