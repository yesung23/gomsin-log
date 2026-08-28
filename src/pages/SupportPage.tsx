import { Link, useNavigate } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { AppBar } from '@/components/ui/AppBar';
import { ChevronRight, ExternalLink, Mail, ShieldAlert } from 'lucide-react';

type FaqItem = {
  category: string;
  items: Array<{ title: string; desc: string }>;
};

const SUPPORT_TOPICS: FaqItem[] = [
  {
    category: '1. 로그인 및 커플 연결',
    items: [
      {
        title: '로그인 및 세션',
        desc: 'Google 또는 Apple 로그인 진행 중 문제가 발생하는 경우 앱을 완전히 종료한 후 다시 실행해 보세요. 문제가 지속되면 오류가 발생한 단계나 진단 코드만 지원 문의로 전달해 주시기 바랍니다.',
      },
      {
        title: '초대 코드 및 상대방 연결',
        desc: '초대 코드는 연결하려는 상대방 1명에게만 전달해야 합니다. 이미 다른 상대방과 연결된 상태에서는 추가 연결이 불가하며, 새 연결을 위해서는 기존 연결을 먼저 해제해야 합니다.',
      },
      {
        title: '커플 연결 해제',
        desc: '상대방과의 연결 해제는 [설정 > 커플 연결 해제] 메뉴에서 언제든 직접 진행하실 수 있습니다. 연결 해제 시 서버에서 새로운 공유 기록 조회 및 실시간 동기화 접근이 즉시 차단됩니다. 다만 상대방 기기에 이미 다운로드되거나 보관된 기존 데이터 사본을 원격으로 회수하거나 삭제하는 것은 아닙니다.',
      },
    ],
  },
  {
    category: '2. 기록 및 사진',
    items: [
      {
        title: '기록 조회 및 나만 보기',
        desc: '작성 시 "나만 보기"로 설정된 기록은 본인만 열람할 수 있으며 상대방에게 공유되지 않습니다. 공유 기록은 1:1 연결된 상대방에게만 실시간 표시됩니다.',
      },
      {
        title: '사진 첨부 및 메타데이터',
        desc: '신규 업로드는 사진만 가능하며, 기존에 등록된 영상·음성은 재생할 수 있습니다. 사진 업로드 시 EXIF 위치정보는 자동으로 제거됩니다.',
      },
      {
        title: '오프라인 저장 및 동기화',
        desc: '오프라인 상태에서 작성한 기록은 기기 내 임시 보관함에 대기하며, 앱이 다시 연결되면 서버 전송을 재시도합니다. 동기화 완료 안내를 확인하기 전에는 앱 데이터 삭제나 재설치를 피해주세요.',
      },
    ],
  },
  {
    category: '3. 계정 삭제 및 탈퇴',
    items: [
      {
        title: '계정 삭제(회원 탈퇴) 방법',
        desc: '앱 내 [설정 > 계정 삭제(회원 탈퇴)] 메뉴에서 본인 확인 후 계정과 관련 개인정보 삭제를 직접 진행하실 수 있습니다.',
      },
      {
        title: '데이터 복구 불가 및 상대방 기록 안내',
        desc: '계정 삭제가 완료되면 본인의 프로필, 직접 작성한 기록 및 첨부파일은 앱에서 복구할 수 없습니다. 상대방이 작성한 기록은 상대방 계정에 유지됩니다. 일부 운영 백업은 개인정보 처리방침에 적힌 제한된 기간 뒤 삭제됩니다.',
      },
      {
        title: '삭제 전 데이터 내보내기',
        desc: '탈퇴 전 필요한 경우 [설정 > 내 데이터 목록 JSON으로 내보내기] 기능을 통해 자신이 작성한 텍스트 기록과 일정 목록을 백업해 두실 수 있습니다.',
      },
    ],
  },
  {
    category: '4. 개인정보 문의 및 권리 행사',
    items: [
      {
        title: '개인정보 열람·정정·삭제 요청',
        desc: '정보주체로서 개인정보 열람, 정정, 삭제, 처리정지를 요청하시거나 처리방침에 관한 문의가 있으신 경우 지원 이메일로 접수해 주시면 본인 확인 후 법정 기한 내 처리해 드립니다.',
      },
    ],
  },
];

export interface SupportPageProps {
  contactEmail?: string;
}

export function SupportPage({ contactEmail }: SupportPageProps = {}) {
  const navigate = useNavigate();
  const email = (contactEmail ?? import.meta.env.VITE_PRIVACY_CONTACT_EMAIL)?.trim() || '';

  return (
    <MobileShell hideNav>
      <div className="px-5 pt-8 pb-28 space-y-6">
        <AppBar
          sticky={false}
          className="px-0 pt-0"
          title="고객지원"
          onBack={() => navigate(-1)}
          backLabel="뒤로가기"
        />

        <div className="rounded-control border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground leading-relaxed">
          곰신로그 이용 중 발생한 문제나 문의사항을 안내해 드립니다.
        </div>

        {/* 이메일 문의 CTA 카드 */}
        <div className="rounded-surface bg-card border border-border p-4 space-y-3">
          <h2 className="text-heading text-foreground">문의하기</h2>
          {email ? (
            <div className="space-y-3">
              <p className="text-body text-muted-foreground leading-relaxed break-keep">
                서비스 이용 오류, 계정 문의, 건의사항은 아래 지원 문의처로 접수해 주세요.
              </p>
              <div className="rounded-control border border-border bg-muted/40 p-3 flex items-center justify-between gap-2">
                <span className="text-caption text-muted-foreground shrink-0">지원 이메일</span>
                <span className="text-label text-foreground font-medium break-all text-right">{email}</span>
              </div>
              <a
                href={`mailto:${email}?subject=${encodeURIComponent('[곰신로그 지원 문의]')}`}
                className="press-response inline-flex min-h-11 min-w-[44px] w-full items-center justify-center gap-2 rounded-control bg-coral-fill px-4 text-emphasis font-semibold text-coral-fill-foreground shadow-soft transition hover:opacity-90 active:scale-[0.98]"
              >
                <Mail size={18} aria-hidden="true" />
                <span>이메일로 문의하기</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              <p className="text-caption text-muted-foreground leading-relaxed">
                접수된 문의는 운영자가 순차적으로 확인 후 회신해 드립니다.
              </p>
            </div>
          ) : (
            <div className="rounded-control border border-border bg-muted/40 p-4 text-caption text-muted-foreground leading-relaxed space-y-1">
              <p className="font-semibold text-foreground">문의처 설정 안내</p>
              <p>
                고객지원 문의처(이메일)가 아직 설정되지 않았습니다. 앱 스토어 등록 정보에 게시된 지원 연락처를 이용해 주세요.
              </p>
            </div>
          )}
        </div>

        {/* 보안 및 개인정보 유의사항 */}
        <div className="rounded-surface border border-border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <ShieldAlert size={18} className="text-coral-strong shrink-0" aria-hidden="true" />
            <h3 className="text-emphasis">개인정보 및 보안 유의사항</h3>
          </div>
          <p className="text-caption text-muted-foreground leading-relaxed break-keep">
            보안과 개인정보 보호를 위해 비밀번호, 민감한 개인 기록·일기 내용, 건강·생리 정보, 부대 위치나 군사기밀 등 민감한 원자료를 이메일 본문이나 첨부파일로 보내지 마세요.
          </p>
        </div>

        {/* 핵심 지원 항목 안내 */}
        <div className="space-y-6">
          {SUPPORT_TOPICS.map((topic) => (
            <section key={topic.category} className="space-y-3">
              <h3 className="text-heading text-foreground break-keep">{topic.category}</h3>
              <div className="space-y-2">
                {topic.items.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-control border border-border bg-muted/20 p-3 space-y-1"
                  >
                    <h4 className="text-emphasis text-foreground break-keep">{item.title}</h4>
                    <p className="text-body text-muted-foreground leading-relaxed break-keep">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* 약관 및 방침 링크 */}
        <div className="space-y-3 pt-2">
          <h3 className="text-heading text-foreground">서비스 약관 및 정책</h3>
          <div className="flex flex-col gap-2">
            <Link
              to="/legal/privacy"
              className="flex min-h-11 min-w-[44px] items-center justify-between rounded-control border border-border bg-muted/30 px-4 text-body text-foreground transition hover:bg-muted/50"
            >
              <span>개인정보 처리방침</span>
              <ChevronRight size={18} className="text-muted-foreground" aria-hidden="true" />
            </Link>
            <Link
              to="/legal/terms"
              className="flex min-h-11 min-w-[44px] items-center justify-between rounded-control border border-border bg-muted/30 px-4 text-body text-foreground transition hover:bg-muted/50"
            >
              <span>서비스 이용약관</span>
              <ChevronRight size={18} className="text-muted-foreground" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </MobileShell>
  );
}
