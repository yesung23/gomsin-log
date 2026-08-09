import { useNavigate, useParams } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { ArrowLeft } from 'lucide-react';

const LAST_UPDATED = '2026-08-09';

type Section = { heading: string; body: string[] };

const TERMS: Section[] = [
  {
    heading: '제1조 (목적)',
    body: [
      '이 약관은 곰신로그(이하 "서비스")를 이용하는 데 필요한 조건과 절차, 이용자와 운영자의 권리·의무를 정합니다.',
    ],
  },
  {
    heading: '제2조 (서비스 내용)',
    body: [
      '서비스는 군 복무 중인 이용자와 그 연인이 1:1로 연결된 비공개 공간에서 하루의 기록(글, 사진, 영상, 음성)과 일정을 공유할 수 있도록 돕습니다.',
      '서비스는 실시간 대화(채팅) 기능을 제공하지 않습니다.',
    ],
  },
  {
    heading: '제3조 (계정과 연결)',
    body: [
      '이용자는 Google 또는 Apple 계정, 또는 이메일 매직링크로 로그인합니다.',
      '하나의 계정은 동시에 하나의 커플 공간에만 참여할 수 있습니다.',
      '커플 공간은 6자리 초대 코드로 연결되며, 코드는 발급 후 24시간 동안만 유효합니다.',
    ],
  },
  {
    heading: '제4조 (이용자의 책임)',
    body: [
      '이용자는 타인의 권리를 침해하거나 법령을 위반하는 내용을 기록·공유해서는 안 됩니다.',
      '군사 기밀에 해당할 수 있는 정보(부대 위치, 작전, 병력 현황 등)를 기록하지 않아야 합니다.',
      '초대 코드는 연결하려는 상대에게만 전달해야 합니다.',
    ],
  },
  {
    heading: '제5조 (기록의 소유와 삭제)',
    body: [
      '이용자가 작성한 기록의 저작권은 작성자에게 있습니다.',
      '이용자는 언제든지 자신의 기록을 삭제하거나 계정을 삭제할 수 있습니다.',
      '계정을 삭제하면 이용자의 프로필, 이용자가 작성한 기록과 첨부파일이 삭제되고 커플 연결이 해제됩니다. 상대방이 직접 작성한 기록은 상대방의 것이므로 삭제되지 않습니다.',
    ],
  },
  {
    heading: '제6조 (면책)',
    body: [
      '서비스가 제공하는 전역일 계산, 감정 흐름 제안, 주기 기록 보조 기능은 참고용입니다. 의학적 진단, 병역 관련 법적 판단, 피임 안내를 제공하지 않습니다.',
      '천재지변, 통신 장애 등 운영자의 통제를 벗어난 사유로 서비스가 중단될 수 있습니다.',
    ],
  },
  {
    heading: '제7조 (약관의 변경)',
    body: [
      '약관이 변경되는 경우 앱 내에서 공지합니다. 변경 후에도 서비스를 계속 이용하면 변경된 약관에 동의한 것으로 봅니다.',
    ],
  },
];

const PRIVACY: Section[] = [
  {
    heading: '1. 수집하는 개인정보',
    body: [
      '계정 정보: 이메일 주소, 로그인 제공자(Google/Apple/이메일), 계정 식별자',
      '프로필 정보: 닉네임, 역할(곰신/군화), 사귄 날짜',
      '선택한 장식 사진(우리·마이 화면)은 이 기기에만 저장되고 서버나 상대방에게 전송되지 않습니다.',
      '복무 정보(군화 역할, 선택): 군종, 복무 상태, 입대일, 예상 전역일',
      '연락 가능 시간(군화 역할, 선택): 평일·주말 시간대',
      '기록 정보: 이용자가 직접 작성한 글, 리액션, 사진·영상·음성 파일, 일정, 여행 계획',
      '선택한 영상·음성은 원본 파일에 포함된 촬영 시각·기기 정보 등의 메타데이터가 함께 전송될 수 있습니다.',
      '주기 기록(곰신 역할, 선택): 생리 시작일과 평균 주기',
    ],
  },
  {
    heading: '2. 수집하지 않는 정보',
    body: [
      '앱은 기기의 위치 권한을 요청하거나 GPS를 직접 조회하지 않습니다. 사진은 업로드 전에 새 이미지로 변환해 EXIF 위치정보를 제거합니다.',
      '영상·음성의 원본 메타데이터는 자동으로 제거하지 않으므로, 민감한 위치·부대 정보가 포함된 파일은 첨부하지 않아야 합니다.',
      '연락처, 통화·문자 기록, 광고 식별자는 수집하지 않습니다.',
      '별도의 행동 추적(analytics) 도구나 광고 SDK를 사용하지 않습니다.',
    ],
  },
  {
    heading: '3. 이용 목적',
    body: [
      '1:1로 연결된 상대에게 기록을 전달하고, 하루 요약과 디데이를 계산하기 위해 사용합니다.',
      '수집한 정보를 광고나 제3자 마케팅 목적으로 사용하지 않습니다.',
    ],
  },
  {
    heading: '4. 공개 범위 (매우 중요)',
    body: [
      "'공유하기'로 남긴 기록은 커플 공간에 연결된 상대 1명에게만 보입니다.",
      "'나만 보기'로 남긴 기록은 상대방에게 전송되지 않으며, 작성자만 열람할 수 있습니다.",
      '주기 기록은 어떤 경우에도 상대방에게 공개되지 않습니다.',
      '연결이 해제되면 상대방은 이후 내 기록을 열람할 수 없습니다.',
    ],
  },
  {
    heading: '5. 처리 위탁',
    body: [
      '데이터베이스, 인증, 파일 저장은 Supabase Inc.의 인프라를 이용합니다.',
      '사진·영상·음성 파일은 공개 접근이 차단된 비공개 저장소에 보관되며, 권한 확인을 거친 만료형 링크로만 열람됩니다.',
    ],
  },
  {
    heading: '6. 보관 기간과 삭제',
    body: [
      '기록은 이용자가 삭제하거나 계정을 삭제할 때까지 보관합니다.',
      '계정 삭제 요청 시 프로필, 이용자가 작성한 기록, 첨부파일, 초대 코드가 삭제되고 로그인 계정이 제거됩니다.',
      '기기 전용 장식 사진은 로그아웃하거나 계정을 삭제할 때 이 기기에서 삭제됩니다.',
      '설정 > 내 기록 JSON으로 내보내기 를 통해 삭제 전에 데이터를 내려받을 수 있습니다.',
    ],
  },
  {
    heading: '7. 이용자의 권리',
    body: [
      '이용자는 언제든지 자신의 정보 열람, 수정, 삭제, 내보내기를 요청할 수 있습니다.',
      '앱 내 설정 화면에서 직접 프로필 수정, 기록 삭제, 연결 해제, 계정 삭제를 수행할 수 있습니다.',
    ],
  },
  {
    heading: '8. 아동의 개인정보',
    body: [
      '서비스는 만 14세 미만 아동을 대상으로 하지 않으며, 해당 연령의 가입을 허용하지 않습니다.',
    ],
  },
  {
    heading: '9. 보호조치와 암호화 범위',
    body: [
      '데이터는 HTTPS로 전송되며, 데이터베이스 행 단위 권한(RLS), 비공개 파일 저장소, 만료형 열람 링크로 접근을 제한합니다.',
      '현재 서비스는 종단간 암호화(E2EE)를 제공하지 않습니다. 따라서 서버 운영 권한을 가진 관리자는 장애 대응, 보안 사고 조사, 법적 의무 이행에 필요한 범위에서 데이터에 접근할 기술적 가능성이 있습니다.',
      '운영자는 관리자 접근을 최소화하고, 서비스 운영에 필요하지 않은 목적으로 기록 내용을 열람하거나 이용하지 않습니다.',
    ],
  },
];

export function LegalPage() {
  const navigate = useNavigate();
  const { doc } = useParams<{ doc: string }>();
  const isPrivacy = doc === 'privacy';
  const sections = isPrivacy ? PRIVACY : TERMS;
  const title = isPrivacy ? '개인정보 처리방침' : '서비스 이용약관';

  return (
    <MobileShell>
      <div className="px-5 pt-8 pb-28 space-y-5">
        <header className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-control hover:bg-muted text-muted-foreground min-h-[44px] flex items-center justify-center active:scale-95 transition"
            aria-label="뒤로가기"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-heading text-foreground">{title}</h1>
          <div className="w-8" />
        </header>

        <p className="text-caption text-muted-foreground">최종 개정일: {LAST_UPDATED}</p>

        <div className="space-y-5">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h2 className="text-heading text-foreground">{section.heading}</h2>
              <ul className="space-y-1.5">
                {section.body.map((line) => (
                  <li
                    key={line}
                    className="text-body text-muted-foreground leading-relaxed break-keep"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="rounded-surface bg-muted/60 border border-border p-4 text-caption text-muted-foreground leading-relaxed">
          문의: 앱 스토어 등록 페이지에 표기된 개발자 연락처로 문의해 주세요.
        </div>
      </div>
    </MobileShell>
  );
}
