# 곰신로그 App Store 제출 메타데이터 및 심사 가이드 (초안)

> **상태 안내 (Status Notice)**
> - **문서 상태**: DRAFT (로컬 검증 및 교정 초안)
> - **App Store Connect 반영 상태**: **미적용 (NOT APPLIED / UNVERIFIED)**
> - **목적**: Apple App Store (iOS) 정식 제출을 위한 정직하고 일관된 메타데이터 및 심사 대응 정보 정리
> - **기준 커밋**: `a633ccb0d194159d81c061add70fab4aa348eda1` (`codex/profile-post-composer`)
> - **식별자 및 빌드 사양**:
>   - Bundle ID (`PRODUCT_BUNDLE_IDENTIFIER`): `app.gomsinlog`
>   - Display Name (`CFBundleDisplayName`): `곰신로그`
>   - 지원 기기: **iPhone 전용 (`TARGETED_DEVICE_FAMILY = 1`, dirty pbx delta 적용됨)**
>   - 최소 지원 OS: **iOS 15.0 floor (`IPHONEOS_DEPLOYMENT_TARGET = 15.0`)**
>   - 빌드 및 제출 요건: **Xcode 26+ / iOS 26 SDK 제출 요구 (2026 Apple 공식 요건)**
>   - 연령 등급: **2026 Age Rating Questionnaire (소셜 미디어 기능 및 건강 관련 신규 설문 대응 필요)**
>
> ⚠️ **주의**: 본 문서에 기재된 모든 외부 URL, 고객지원 채널, 데모 계정 자격증명은 **[PLACEHOLDER / UNVERIFIED / BLOCKED]** 상태이며, 실제 배포 및 제출 전 승인된 실제 값으로 치환해야 합니다. 실제 운영 비밀번호나 시크릿은 절대 Git 저장소에 커밋하지 마십시오.

---

## 1. App Store 기본 메타데이터

### 1.1 앱 이름 (App Name)
- **공식 필드 정의**: 최대 30자 (Up to 30 characters)
- **추천안 (Recommended)**: `곰신로그` (4자 / 12 바이트)
  - **추천 사유**: 브랜드 본래의 명칭인 '곰신로그'를 단독으로 전면에 내세워 높은 브랜드 인지도와 심플한 앱스토어 검색 정체성을 확보합니다. 군인 커플 및 교환일기 맥락은 부제(Subtitle)와 검색 키워드(Keywords)로 충실하게 보완합니다.
- **대안 (Alternative)**: `곰신로그 - 군인 커플 다이어리` (17자 / 41 바이트)
  - **사유**: 앱스토어 검색 결과에서 카테고리와 타깃 사용자를 한눈에 인지할 수 있도록 설명적 수식어를 결합한 구성입니다.

### 1.2 부제 (Subtitle)
- **공식 필드 정의**: 최대 30자 (Up to 30 characters)
- **초안**: `복무 디데이와 둘만의 하루 기록` (17자 / 43 바이트)
- **설명**: 군 복무 일정/디데이 계산과 연인 간의 비공개 하루 기록이라는 핵심 사용자 가치를 직관적으로 전달합니다.

### 1.3 홍보 문구 (Promotional Text)
- **공식 필드 정의**: 최대 170자 (Up to 170 characters, 앱 심사 통과 후에도 새 버전 배포 없이 수정 가능)
- **초안**:
  `군 복무 중인 연인과 하루의 순간을 가볍게 기록하고 공유하세요. 복무 디데이 계산부터 둘만의 사진 기록까지, 둘만의 아늑한 공간에서 소중한 일상을 이어갑니다.` (88자 / 218 바이트)

### 1.4 검색 키워드 (Keywords)
- **공식 필드 정의**: 최대 100자 (Up to 100 characters, 쉼표로 구분, 불필요한 공백 제외)
- **초안**:
  `곰신로그,군인,커플,디데이,전역일,군화,교환일기,복무일,곰신,군인커플`
- **실측 검증**: 38자 (96 바이트).
  - Apple 공식 문자 수 기준: 38/100자 준수.
  - 레거시 시스템 UTF-8 바이트 기준: 96/100 바이트 준수.
  - 앱 이름 추천안('곰신로그')에서 생략된 '군인', '군화', '곰신', '커플', '디데이' 맥락을 밀도 있게 보완합니다.

### 1.5 카테고리 (Categories)
- **기본 카테고리 (Primary)**: 라이프스타일 (Lifestyle)
  - **선정 사유**: 1:1 연인 교환일기, 복무 일정 및 디데이 계산, 둘만의 일상 공유 목적에 가장 부합합니다.
- **보조 카테고리 (Secondary)**: 소셜 네트워킹 (Social Networking)
  - **선정 사유**: 폐쇄형 1:1 커플 간의 양방향 소통 및 관계 기록 공간 기능을 포괄합니다.

### 1.6 앱 설명 (Description)
- **공식 필드 정의**: 최대 4,000자 (Up to 4,000 characters)
- **실측 검증**: 1,435자 (3,287 바이트, 4,000자 제한 이내 준수)
- **본문 초안**:

```text
[곰신로그 — 군 복무 중인 연인과 함께 쓰는 1:1 비공개 다이어리]

곰신로그는 군 복무 중인 군화와 그를 기다리는 곰신이 서로의 하루를 가볍게 기록하고 따뜻하게 이어가는 둘만의 1:1 비공개 다이어리입니다.

불필요하게 복잡한 기능이나 불특정 다수에게 노출되는 공개 피드 대신, 서로에게만 집중할 수 있는 아늑한 1:1 공간을 제공합니다.

■ 주요 기능

1. 둘만의 1:1 비공개 연결
- 6자리 초대 코드로 서로의 계정을 1:1로 간편하게 연결합니다.
- 외부 노출 없이 오직 연결된 연인 둘만이 볼 수 있는 교환일기 공간이 만들어집니다.

2. 한눈에 확인하는 복무 일정과 디데이
- 입대일, 전역일, 진급일을 입력하면 현재 복무율과 남은 일수를 자동으로 계산합니다.
- 다음 진급일과 휴가 일정을 캘린더에서 함께 확인할 수 있습니다.

3. 오늘의 순간 가볍게 남기기 (Today 기록)
- '지금찍기' 카메라로 지금 이 순간의 생생한 사진을 촬영하거나, 기기 앨범에서 사진을 선택해 올립니다.
- 한 줄 글과 함께 부담 없이 오늘의 순간을 기록할 수 있습니다.

4. 둘만의 소중한 사진 모아보기 (My 게시물 작성기)
- 기기 앨범의 사진뿐만 아니라 우리가 함께 나눈 스토리와 여행 기록의 사진 중에서 최대 10장까지 선택해 게시물을 만듭니다.
- 사진 순서를 자유롭게 변경하고, 함께 나눈 소중한 기억에 캡션을 남길 수 있습니다.
- 둘만의 '공개' 또는 나만 볼 수 있는 '나만 보기'로 게시물 공개 범위를 설정할 수 있습니다.
- (필터 효과, 위치 정보 태깅, 인물 태그 기능은 제공하지 않습니다.)

5. 상대방의 오늘을 빠르게 훑어보는 하루 요약
- 바쁜 일상 속에서도 상대방이 오늘 기록한 하루의 흐름을 요약 카드로 빠르게 파악합니다.
- 요약 카드를 누르면 어림짐작이나 다른 날짜로 건너뛰지 않고, 해당 순간의 정확한 원본 기록 상세로 즉시 이동해 자세한 이야기를 확인합니다.
- 하루 요약은 사실 기반의 결정론적 규칙 요약이 기본으로 동작하며, 외부 AI 서버로 데이터를 전송하지 않습니다.

6. 투명한 계정 및 데이터 관리
- 앱 내 설정에서 언제든 직접 '계정 삭제 (회원 탈퇴)'를 진행할 수 있습니다.
- 탈퇴 시 본인의 프로필, 인증 정보, 본인이 작성한 기록과 사진 첨부 파일이 삭제되며 커플 연결이 해제됩니다. (상대방이 작성한 기록은 상대방 계정에 보존됩니다.)

■ 미디어 및 서비스 이용 안내
- 현재 신규 미디어 첨부는 안정적인 서비스 제공을 위해 '사진' 파일만 지원합니다. (기존에 등록된 동영상이나 음성은 재생 가능하며, 신규 동영상 및 음성 파일 업로드는 제공하지 않습니다.)
- 하루 요약 다듬기 기능은 지원 기기(iOS 26+ Apple Intelligence 지원 기기 및 한국어 로케일)에서 설정 활성화 시에만 조건부로 동작하며, 미지원 환경에서도 기본 규칙 기반 요약으로 안전하게 표시됩니다.
```

### 1.7 URL 정보 (URLs)
- **개인정보 처리방침 URL (Privacy Policy URL, 필수)**:
  `https://gomsin-log.vercel.app/legal/privacy` [UNVERIFIED - 새 약관/방침 문구 master/Production 배포 전]
  - 실제 구현 경로: `/legal/privacy` (소스코드 구현 확인 완료)
  - 배포 상태: Vercel 배포 본에 최신 법적 고지 문구가 배포·반영되기 전까지는 UNVERIFIED 상태입니다.
- **서비스 이용약관 URL (Terms of Service URL, 선택)**:
  `https://gomsin-log.vercel.app/legal/terms` [UNVERIFIED - 새 약관/방침 문구 master/Production 배포 전]
  - 실제 구현 경로: `/legal/terms` (소스코드 구현 확인 완료)
- **지원 URL (Support URL, 필수)**:
  **[BLOCKED / REQUIRED]** — 현재 공개 고객지원 웹페이지가 개설되어 있지 않습니다. App Store 심사 제출을 위해서는 외부에서 접근 가능한 공식 고객지원 페이지(예: `https://gomsin-log.vercel.app/support` 또는 문의 접수 이메일/폼 링크가 포함된 공개 페이지)의 신설 및 프로덕션 배포가 필수적입니다. (존재하지 않는 가상 도메인 `gomsinlog.app`은 사용하지 않습니다.)
- **마케팅 URL (Marketing URL, 선택)**:
  `https://gomsin-log.vercel.app` [UNVERIFIED]

### 1.8 저작권 (Copyright)
- `© 2026 GomsinLog. All rights reserved.` [PLACEHOLDER - UNVERIFIED]

---

## 2. 앱 심사 정보 (App Review Information)

### 2.1 심사 담당자 연락처 (Contact Information)
- **이름 (First Name)**: `Yejun` [PLACEHOLDER - UNVERIFIED]
- **성 (Last Name)**: `Han` [PLACEHOLDER - UNVERIFIED]
- **전화번호 (Phone Number)**: `+82 10-0000-0000` [PLACEHOLDER - UNVERIFIED]
- **이메일 주소 (Email)**: `support@gomsin-log.vercel.app` [PLACEHOLDER - UNVERIFIED]

### 2.2 심사용 로그인 데모 계정 (Demo Accounts)
> ⚠️ **상태: BLOCKED / PLACEHOLDER (원격 DB 미생성 상태)**
> - 실제 사전 페어링된 데모 계정은 아직 원격 Supabase DB에 생성되지 않았습니다.
> - 실제 운영 비밀번호나 시크릿은 절대 Git 저장소에 커밋하지 않습니다 (`[DEMO_PASSWORD_DO_NOT_COMMIT]`).
> - 아래 정보는 심사 직전 원격 DB에 생성 후 App Store Connect 로그인 정보 란에 직접 입력할 플레이스홀더입니다.

곰신로그는 1:1 연인 연결이 완료되어야 전체 핵심 기능(교환일기, 스토리, 디데이 현황)을 검증할 수 있습니다. 심사관의 원활한 테스트를 위해 상호 사전 페어링된 2개의 데모 계정을 원격 DB에 생성하여 App Store Connect에 등록해야 합니다.

#### 데모 계정 1 (곰신 역할 - 사전 페어링 대상)
- **아이디 (Username)**: `demo-gomsin@placeholder.internal` [BLOCKED / PLACEHOLDER]
- **비밀번호 (Password)**: `[DEMO_PASSWORD_DO_NOT_COMMIT]` [BLOCKED / PLACEHOLDER]
- **역할 및 용도**: 상대방(`demo-soldier`)과 1:1로 연결되어 있어 로그인 즉시 메인 홈, 상대방의 하루 스토리 요약, 기록 상세 및 작성 기능을 바로 테스트할 수 있습니다.

#### 데모 계정 2 (군화 역할 - 사전 페어링 대상)
- **아이디 (Username)**: `demo-soldier@placeholder.internal` [BLOCKED / PLACEHOLDER]
- **비밀번호 (Password)**: `[DEMO_PASSWORD_DO_NOT_COMMIT]` [BLOCKED / PLACEHOLDER]
- **역할 및 용도**: 군 복무 정보(육군, 계급, 입대일, 전역일)가 등록되어 있으며, 상대방 곰신 계정과 양방향으로 연결되어 상호 일기 및 복무 진행도를 확인할 수 있습니다.

#### (추가 선택) 신규 연결 테스트용 계정 (미연결 상태)
- **아이디 (Username)**: `demo-new@placeholder.internal` [BLOCKED / PLACEHOLDER]
- **비밀번호 (Password)**: `[DEMO_PASSWORD_DO_NOT_COMMIT]` [BLOCKED / PLACEHOLDER]
- **용도**: 온보딩 단계의 초대 코드 생성 및 코드 입력 페어링 절차를 처음부터 테스트하고자 할 때 사용합니다.

---

## 3. 심사 참고 사항 (App Review Notes)
- **공식 필드 정의**: 최대 4,000자 (Up to 4,000 characters)
- **실측 검증**: 2,138자 (3,990 바이트, 공식 4,000자 및 UTF-8 4,000 바이트 제한 모두 충족)
- **App Store Connect '메모(Notes)' 입력 텍스트 초안**:

```text
[App Review Notes - GomsinLog]

곰신로그 심사를 진행해 주셔서 감사합니다. 원활한 심사 및 기능 검증을 위해 핵심 흐름과 기술 정책을 안내합니다.

1. 커플 연결 흐름 (Connection Flow)
- 곰신로그는 연인이 1:1로 연결되어 사용하는 비공개 다이어리입니다.
- 심사용 사전 페어링 데모 계정 2개를 준비 중입니다. (자격증명은 심사 정보 로그인란 참조, DB 미생성 PLACEHOLDER 상태) 로그인 즉시 홈, 스토리, 공유 일기 확인이 가능합니다.
- (신규 연결): 온보딩에서 "새 공간 만들기"로 6자리 초대 코드를 생성하고, 다른 기기에서 "초대 코드가 있어요" 입력 시 1:1 연결됩니다.

2. 원본 기록 상세 이동 (Exact Record Navigation)
- 홈 기록 카드 또는 스토리 요약 줄 탭 시, 임의 추정 없이 해당 요약의 고유 ID(recordId)를 가진 원본 기록 상세 경로(/record?record=<id>)로 직접 이동합니다. (코드 및 라우트 검증 완료)
- 대상 기록 삭제 또는 접근 불가 시 대체 없이 "부재" 카드로 정직하게 표시합니다.

3. 일일 요약 온디바이스 동작 및 프라이버시 (Daily Summary & Privacy)
- 스토리 표지 요약은 사실 기반 결정론적 규칙 요약이 기본으로 즉시 표시됩니다.
- Foundation Models 정제는 VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED=true 시, iOS 26+ Apple Intelligence 지원 실기기 및 한국어(ko_KR) 로케일에서만 조건부 동작합니다. (현재 기본값 OFF, 실물 iPhone 런타임 UNVERIFIED)
- [폴백]: 4초 초과, 오류, 취소, 기기/OS 미지원 시 중단 없이 기존 결정론적 규칙 요약이 유지됩니다.
- [프라이버시]: 외부 AI 서버 전송이 없습니다. 모델 payload에는 recordId, userId, 날짜, 시각, 첨부 URL/파일명, 비공개 여부, 건강/주기 raw data가 일절 제외되며 정규화된 텍스트 줄과 서수 인덱스만 전달됩니다. (단 전체 앱 DB나 미디어 스토리지가 E2EE 상태인 것은 아닙니다.)

4. 카메라 및 사진 접근 정책 (Camera & Photo Policy)
- "지금찍기" 실시간 촬영 시에만 카메라 권한(NSCameraUsageDescription)을 요청합니다.
- 기기 앨범 사진 선택은 iOS 표준 PHPickerViewController를 사용하므로 사진 라이브러리 접근 권한(NSPhotoLibraryUsageDescription)을 요구하지 않습니다.

5. 미디어 업로드 정책 (Media Upload Policy)
- 현재 신규 미디어 업로드는 "사진"만 지원합니다 (MEDIA_POLICY_REFUSAL).
- 신규 동영상/오디오 업로드는 차단되며, 마이크 권한(NSMicrophoneUsageDescription)은 바이너리에 없습니다. (기존 등록 미디어 재생만 지원)

6. 게시물 작성기 (Profile Post Composer)
- 마이 탭 게시물 작성기는 기기 앨범, 스토리, 여행 사진 중 최대 10장을 선택해 순서 변경, 캡션 작성, 공개/나만 보기 설정이 가능합니다.
- 필터, 위치 태그, 사람 태그, 신규 비디오/오디오 업로드는 미제공합니다.

7. 계정 삭제 및 데이터 처리 정책 (Account Deletion Policy)
- App Store Guideline 5.1.1(v) 준수: 하단 탭 [마이] -> 상단 [설정] -> 계정 관리의 [계정 삭제 (회원 탈퇴)] -> "탈퇴" 직접 입력 확인.
- [삭제]: 본인 프로필, auth.users 계정, 본인 작성 기록 및 첨부 사진이 삭제되고 1:1 커플 연결이 해제됩니다.
- [보존]: 상대방이 작성한 기록과 게시물은 상대방 계정에 보존됩니다.
- [안정성]: 부분 미디어 삭제 실패 시 recovery 안내 및 재시도를 지원하며, 운영 백업은 검증/취소 후 7일 이내 삭제됩니다.

8. 인증 환경 안내 (Authentication Notes)
- 원격 Supabase는 Google OAuth 및 이메일 로그인이 활성화되어 있으며, Apple 로그인은 심사 제출 전 활성화 및 리다이렉트 등록 예정인 BLOCKER 상태입니다. (다크/라이트 모드 지원)
```

---

## 4. 스크린샷 캡처 매니페스트 (Screenshot Capture Manifest)

### 4.1 규격 사양 (Apple App Store 요구사항)
- **대상 기기 디스플레이**: 6.9형 디스플레이 (iPhone 16 Pro Max / 15 Pro Max 규격 지원)
- **이미지 해상도**: 1290 x 2796 픽셀 (세로형, 19.5:9 비율)
- **색상 포맷**: RGB 포맷, **알파 채널(투명도) 없음 (No Alpha Channel)**
- **파일 형식**: PNG 또는 무손실 고품질 JPEG
- **허용 매수**: 최소 1장 ~ 최대 10장 (Apple 공식 기준, 본 초안에서는 6장 권장)
- **캡처 진행 상태**: **UNVERIFIED / BLOCKED (실제 6장은 아직 캡처되지 않았음)**

### 4.2 캡처 제작 가이드라인
- **데이터 정결성**: 실제 사용자의 개인정보, 실명, 실제 군부대 명칭, 군사시설/위치 정보가 포함된 스크린샷은 절대 사용하지 마십시오.
- **예시 데이터**: 따뜻하고 정돈된 가상의 테스트 데이터만 활용합니다. (예: 닉네임 "곰신이", "군화", 일기 "오늘 점심은 맛있는 김치찌개!", "주말 외박 준비 중")
- **시각적 완성도**: 시스템 상태 표시줄(배터리 100%, Wi-Fi, 시계 9:41 등)이 정돈된 클린 렌더링 화면을 사용합니다.
- **알파 채널 검사 필수**: 캡처 후 `sips` 또는 그래픽 도구를 통해 알파 채널이 완전히 제거되었는지 확인해야 합니다.

### 4.3 스크린샷 목록 및 화면 구성표 (권장 6장)

| 번호 | 파일명 | 화면명 | 상단 캡션 문구 (한글) | 화면 주요 구성 요소 |
|---|---|---|---|---|
| 1 | `screenshot-01-home.png` | 홈 (Home) | 둘만의 오늘과 복무 디데이를 한눈에 | 상단 복무 디데이 카드(남은 복무일, 복무율 48%), 오늘 서로 나눈 기록 요약 카드, 따뜻한 안부 상태 |
| 2 | `screenshot-02-story.png` | 스토리 (Story) | 상대방의 오늘을 빠르게 훑어보는 하루 요약 | 시간순으로 정돈된 상대방의 하루 순간들, 정제된 한 줄 요약 속표지, 원본 기록으로 이동하는 인터랙션 |
| 3 | `screenshot-03-record-detail.png` | 기록 상세 (Record) | 소중한 순간이 담긴 사진과 따뜻한 이야기 | 첨부 사진 카드, 원본 일기 본문 텍스트, 함께 나눈 감정 태그, 작성 시각 |
| 4 | `screenshot-04-today-composer.png` | Today 기록 작성기 | 지금찍기와 사진으로 가볍게 남기는 순간 | 텍스트 작성 영역, '지금찍기' 카메라 및 앨범 첨부 버튼, 감정 선택 칩, 둘만의 공유/비공개 토글 |
| 5 | `screenshot-05-service.png` | 복무 정보 (Service) | 입대부터 전역까지, 한눈에 보는 복무 일정 | 계급(일병), 다음 진급일 D-14 및 진급 일정표, 정기 휴가 및 외박 디데이 캘린더 |
| 6 | `screenshot-06-post-composer.png` | My 게시물 작성기 | 둘만의 소중한 사진들을 모아 간직하는 방법 | 기기 앨범/스토리/여행 사진 선택 그리드(최대 10장), 사진 순서 변경, 캡션 작성, 공개/나만 보기 설정 |

---

## 5. 메타데이터 제한 및 실측 검증 요약

본 문서에 기재된 텍스트 및 사양의 Apple 공식 규격 충족 여부를 실제 측정 스크립트로 검증한 결과입니다.

| 항목 | Apple 공식 필드 정의 | 초안 값 | 실측 검증 결과 | 상태 |
|---|---|---|---|---|
| **앱 이름 (App Name) 추천안** | 최대 30자 (Up to 30 characters) | `곰신로그` | **4자 (12 바이트)** — 규격 충족 | READY |
| **앱 이름 (App Name) 대안** | 최대 30자 (Up to 30 characters) | `곰신로그 - 군인 커플 다이어리` | **17자 (41 바이트)** — 규격 충족 | READY |
| **부제 (Subtitle)** | 최대 30자 (Up to 30 characters) | `복무 디데이와 둘만의 하루 기록` | **17자 (43 바이트)** — 규격 충족 | READY |
| **홍보 문구 (Promotional Text)** | 최대 170자 (Up to 170 characters) | 초안 본문 | **88자 (218 바이트)** — 규격 충족 | READY |
| **검색 키워드 (Keywords)** | 최대 100자 (Up to 100 characters) | 키워드 10개 (쉼표 구분) | **38자 (96 바이트)** — 문자/바이트 모두 충족 | READY |
| **앱 설명 (Description)** | 최대 4,000자 (Up to 4,000 characters) | 초안 본문 | **1,435자 (3,287 바이트)** — 규격 충족 | READY |
| **심사 참고 메모 (Review Notes)** | 최대 4,000자 (Up to 4,000 characters) | 초안 본문 | **2,138자 (3,990 바이트)** — 문자/바이트 모두 충족 | READY |
| **스크린샷 규격** | 6.9형 1290x2796, 1~10장, RGB 무알파 | 1290x2796 6장 매니페스트 | **규격 충족 (실제 6장 미캡처)** | BLOCKED |
| **개인정보 처리방침 URL** | 필수 유효 URL | `https://gomsin-log.vercel.app/legal/privacy` | 코드 경로 존재 / 프로덕션 최신 배포 검증 대기 | UNVERIFIED |
| **서비스 이용약관 URL** | 선택 유효 URL | `https://gomsin-log.vercel.app/legal/terms` | 코드 경로 존재 / 프로덕션 최신 배포 검증 대기 | UNVERIFIED |
| **고객지원 URL (Support URL)** | 필수 유효 URL | 미개설 상태 (공개 지원 웹페이지 신설 필수) | **미개설 (심사 전 필수 개설)** | BLOCKED |
| **심사용 데모 계정** | 로그인 필수 앱 요구사항 | 상호 사전 페어링 계정 2개 | **원격 DB 미생성 (자격증명 미커밋)** | BLOCKED |
| **Apple 로그인 (Sign in with Apple)** | Guideline 4.8 필수 요건 | Supabase Apple Provider 활성화 | **현재 Provider 비활성(OFF) 상태** | BLOCKED |
| **빌드 & SDK 요구사항** | Xcode 26+ / iOS 26 SDK | iOS 15.0 floor, iPhone 전용 | **로컬 빌드/아카이브 미실행** | BLOCKED |
| **2026 연령 등급 설문** | 2026 Age Rating Questionnaire | 소셜 미디어/스크린타임/건강 설문 | **App Store Connect 미응답** | BLOCKED |

---

## 6. App Store 제출 준비 상태 종합 현황표 (Status Matrix)

| 구분 | 검토 항목 | 현재 상태 | 상세 내용 및 의존 관계 |
|---|---|---|---|
| **메타데이터** | 앱 이름, 부제, 홍보문구, 키워드, 카테고리 | **READY** | 문자 수 및 바이트 수 검증 완료, 즉시 등록 가능 |
| **메타데이터** | 앱 설명 (Description) | **READY** | 과장 없는 정직한 기능 및 제한사항 명시 완료 |
| **메타데이터** | 심사 참고 메모 (Review Notes) | **READY** | 8개 핵심 정책 및 기술 설명 완료, 4,000자 이내 준수 |
| **법적 문서** | 개인정보 처리방침 및 서비스 이용약관 | **PARTIAL** | 앱 내 `/legal/privacy`, `/legal/terms` 구현 완료. 최신 master 브랜치 Vercel 프로덕션 배포 확인 필요 |
| **고객지원** | 고객지원 웹페이지 URL (Support URL) | **BLOCKED** | 외부 접근 가능한 고객지원 페이지 개설 필수 (현재 미개설) |
| **인증 연동** | Apple 로그인 (Sign in with Apple) | **BLOCKED** | App Store 심사 지침 4.8 필수 요건이나 현재 Supabase Apple Provider 비활성(OFF) 상태. 활성화 및 redirect 등록 필수 |
| **심사 계정** | 사전 페어링된 심사용 데모 계정 | **BLOCKED** | 원격 DB에 1:1 연결된 곰신/군화 계정 실제 생성 및 비밀번호 ASC 등록 필요 |
| **디자인 에셋** | 6.9형 스크린샷 6장 (1290x2796, 무알파) | **BLOCKED** | 매니페스트 수립 완료. 가상 데이터 기반 실기기/시뮬레이터 실제 캡처 및 알파 채널 제거 필요 |
| **바이너리** | iPhone 전용 빌드 및 iOS 15 floor | **PARTIAL** | `TARGETED_DEVICE_FAMILY = 1`, `IPHONEOS_DEPLOYMENT_TARGET = 15.0` 프로젝트 설정 반영 완료 |
| **바이너리** | Xcode 26+ / iOS 26 SDK 빌드 및 아카이브 | **BLOCKED** | 2026 Apple 요건 준수 빌드 환경에서 Archive 및 TestFlight 업로드 검증 미실행 |
| **규정 준수** | 2026 Age Rating Questionnaire (연령 등급) | **BLOCKED** | App Store Connect 내 2026 신규 설문(소셜 미디어 기능, 스크린타임, 건강 등) 응답 필요 |
| **규정 준수** | 수출 규정 준수 (Export Compliance) | **BLOCKED** | App Store Connect 내 암호화 수출 규정 준수 질문 응답 미실시 |
| **규정 준수** | 개인정보 영양 라벨 (Privacy Nutrition Label) | **BLOCKED** | App Store Connect 수집 데이터 유형 선언 미실시 |
| **계정 관리** | Apple Developer Program 멤버십 활성화 | **BLOCKED** | 결제 처리 완료 및 개발자 계정 활성화 대기 중 |

---

## 7. App Store 제출 전 사용자/운영자 최종 체크리스트 (Action Items)

제출 승인을 위해 운영자 및 개발자가 순차적으로 수행해야 할 실제 작업 목록입니다.

### 1단계: 개발자 계정 및 인증 인프라 활성화
- [ ] **Apple Developer Program 계정 활성화 확인**: 등록 결제 승인 완료 및 계정 상태가 Active인지 확인합니다.
- [ ] **Apple Services ID & Private Key 생성**: Apple Developer 포털에서 Sign in with Apple을 위한 Services ID와 인증 키(`.p8`)를 생성합니다.
- [ ] **Supabase Apple Provider 활성화**: 원격 Supabase Auth 설정에서 Apple Provider를 활성화하고, Client ID, Team ID, Key ID, Private Key를 등록합니다.
- [ ] **리다이렉트 URL 등록**: Apple Developer Services ID 및 Supabase Redirect Allow-list에 네이티브 콜백(`gomsinlog://auth/callback`) 및 웹 콜백 URL을 등록합니다.

### 2단계: 공개 URL 배포 및 지원 채널 개설
- [ ] **최신 법적 문서 프로덕션 배포 확인**: Vercel 프로덕션(`https://gomsin-log.vercel.app`)에 접속하여 `/legal/privacy` 및 `/legal/terms`의 최신 문구가 정상 노출되는지 확인합니다.
- [ ] **공개 고객지원 웹페이지 개설 (Support URL)**:
  - 심사 제출용 고객지원 페이지(예: `https://gomsin-log.vercel.app/support` 또는 문의 접수 이메일/폼 링크가 포함된 공개 페이지)를 제작하여 프로덕션에 배포합니다.
  - 해당 URL을 App Store Connect의 '지원 URL' 필드에 입력합니다.

### 3단계: 심사용 데모 계정 생성
- [ ] **원격 DB에 1:1 페어링 데모 계정 생성**:
  - 곰신 계정: `demo-gomsin@gomsin-log.vercel.app` (또는 실제 사용 가능한 이메일 형태)
  - 군화 계정: `demo-soldier@gomsin-log.vercel.app` (복무 정보 등록 완료)
  - 두 계정 간 6자리 초대 코드를 통한 1:1 커플 페어링을 완료하고 가상의 일기 기록 2~3개를 등록해 둡니다.
- [ ] **App Store Connect 심사 정보 입력**:
  - 생성된 데모 계정의 ID와 비밀번호를 App Store Connect '앱 심사 정보'의 사용자 이름/비밀번호 필드에 입력합니다. (Git에는 절대 비밀번호를 커밋하지 않습니다.)

### 4단계: 스크린샷 캡처 및 알파 채널 제거
- [ ] **가상 데이터 기반 6.9인치 캡처 (1290 x 2796)**:
  - 시뮬레이터(iPhone 16 Pro Max) 또는 실기기에서 상기 매니페스트 6종 화면을 캡처합니다.
  - 민감 개인정보, 실제 군부대 위치 등이 포함되지 않도록 가상 데이터만 사용합니다.
- [ ] **알파 채널 제거 검증**:
  - macOS 터미널에서 `sips -s format png --deleteColorManagementProperties <파일>` 등을 활용하여 알파 채널을 완전히 제거한 후 App Store Connect에 업로드합니다.

### 5단계: Xcode 빌드 및 바이너리 업로드
- [ ] **Xcode 26+ / iOS 26 SDK 환경 확인**: 최신 공식 요구사항에 맞는 빌드 도구 버전을 확인합니다.
- [ ] **바이너리 아카이브 (Archive)**: Product -> Archive를 수행하고 유효한 배포 프로비저닝 프로파일로 서명합니다.
- [ ] **TestFlight 업로드 및 내부 테스트**: App Store Connect로 바이너리를 전송하고, 내부 테스터 실기기에서 로그인, 복무 디데이 계산, 일기 작성, 계정 삭제 경로가 정상 동작하는지 최종 확인합니다.

### 6단계: App Store Connect 등록 및 심사 제출
- [ ] **버전 정보 및 메타데이터 입력**: 본 문서 1장의 앱 이름, 부제, 키워드, 설명, URL 정보를 복사하여 입력합니다.
- [ ] **2026 연령 등급 설문 완료**: 소셜 미디어 기능, 스크린타임, 민감 데이터 관련 질문에 솔직하게 응답합니다.
- [ ] **개인정보 영양 라벨 선언**: 이용자 데이터 수집 항목(계정 정보, 사용자 콘텐츠, 기기 식별자 등)을 정직하게 체크합니다.
- [ ] **심사 참고 메모 입력**: 본 문서 3장의 심사 참고 메모 전문을 복사하여 입력합니다.
- [ ] **최종 심사 제출 (Submit for Review)**.

---

## 8. Apple 공식 참고 문서 (Official References)

App Store 제출 및 심사 대응 시 준수해야 하는 Apple 공식 기술 및 정책 문서 목록입니다.

1. **Apple Upcoming Requirements (SDK 및 도구 요구사항)**:
   [https://developer.apple.com/ios/upcoming-requirements/](https://developer.apple.com/ios/upcoming-requirements/)
2. **App Store Connect 스크린샷 규격 가이드 (Screenshot specifications)**:
   [https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)
3. **App Store Connect 메타데이터 필드 사양 (App information)**:
   [https://developer.apple.com/help/app-store-connect/reference/app-information/](https://developer.apple.com/help/app-store-connect/reference/app-information/)
4. **App Store 심사 지침 (App Review Guidelines)**:
   [https://developer.apple.com/app-store/review/guidelines/](https://developer.apple.com/app-store/review/guidelines/)
