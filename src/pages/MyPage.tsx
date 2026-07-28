import React, { useState } from 'react';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/store';
import { 
  User, Link, Shield, Clock, LogOut, 
  Trash2, ChevronRight, Settings, FileText, AlertTriangle, Download, Smartphone, Share, PlusSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function MyPage() {
  const { state, switchRole, disconnect, signOut, reset, deleteRecord } = useStore();
  const { profile, isDemoMode, records } = state;
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showDeleteRecordsModal, setShowDeleteRecordsModal] = useState(false);
  const [showPWAModal, setShowPWAModal] = useState(false);

  const roleLabel = profile.role === 'soldier' ? '군화' : '곰신';
  const avatar = profile.role === 'soldier' ? '🪖' : '🌸';
  
  const ownRecords = records.filter((r) => r.authorRole === profile.role);

  const handleToast = (msg: string) => {
    toast(msg);
  };

  const SettingsGroup = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div className="mb-6">
      <h3 className="text-xs font-bold text-gray-500 px-4 mb-2">{title}</h3>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
        {children}
      </div>
    </div>
  );

  const SettingsItem = ({ icon: Icon, label, value, onClick, danger }: any) => (
    <button 
      onClick={onClick}
      className={cn(
        "w-full px-4 py-4 flex items-center justify-between bg-white active:bg-gray-50 transition-colors min-h-[44px]",
        danger ? "text-red-500" : "text-gray-800"
      )}
    >
      <div className="flex items-center gap-3">
        <Icon className={cn("w-5 h-5", danger ? "text-red-500" : "text-gray-400")} />
        <span className="font-medium text-[15px]">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {value && <span className="text-sm text-gray-400">{value}</span>}
        <ChevronRight className="w-5 h-5 text-gray-300" />
      </div>
    </button>
  );

  return (
    <MobileShell>
      <div className="p-4 pb-24">
        <h1 className="text-2xl font-bold px-2 pt-4 pb-2">마이</h1>

        {/* Profile Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 mb-6 text-center">
          <div className="text-6xl mb-4">{avatar}</div>
          <h2 className="text-2xl font-black text-gray-900 mb-1">{profile.myName}</h2>
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="bg-navy/10 text-navy px-2.5 py-1 rounded-full font-bold text-xs">
              {roleLabel}
            </span>
            <span className="text-gray-400">•</span>
            {profile.couple.connected && profile.couple.status === 'active' ? (
              <span className="text-mint-foreground font-medium text-xs">{profile.couple.partnerName}님과 1:1 연결됨</span>
            ) : profile.couple.status === 'disconnected' ? (
              <span className="text-red-500 font-medium text-xs">연결 해제됨 (개인 모드)</span>
            ) : (
              <span className="text-gray-400 text-xs">연결 대기 중</span>
            )}
          </div>
        </div>

        {/* Demo Mode Banner & Role Switch Toggle (EXCLUSIVELY in Demo Mode) */}
        {isDemoMode && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl mb-6">
            <div className="flex items-center justify-between text-amber-900 font-bold mb-2 text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <span>데모 테스트 공간</span>
              </div>
              <span className="bg-amber-200 text-amber-900 text-[10px] px-2 py-0.5 rounded-md">이 기기 전용 데모</span>
            </div>
            <p className="text-xs text-amber-800/80 mb-3 leading-relaxed">
              현재 데모 데이터는 <b>이 기기의 브리핑/로컬 저장소(localStorage)에만 저장</b>됩니다. 테스트를 위해 역할을 바로 전환해보실 수 있습니다.
            </p>
            <button 
              onClick={switchRole}
              className="w-full bg-amber-200 text-amber-950 font-bold py-2.5 rounded-xl text-xs active:bg-amber-300 transition-colors min-h-[44px]"
            >
              현재 {roleLabel} 모드 - 반대 역할로 테스트 전환
            </button>
          </div>
        )}

        {/* Profile Settings */}
        <SettingsGroup title="설정">
          <SettingsItem icon={User} label="내 프로필 편집" onClick={() => handleToast('프로필 편집 기능 준비 중')} />
          <SettingsItem icon={Link} label="우리 공간 초대 코드" value={profile.couple.coupleCode || '123456'} onClick={() => handleToast(`초대 코드: ${profile.couple.coupleCode || '123456'}`)} />
        </SettingsGroup>

        {/* Privacy */}
        <SettingsGroup title="프라이버시 & 앱 관리">
          <SettingsItem 
            icon={Shield} 
            label="1:1 비공개 로그 원칙" 
            onClick={() => handleToast('곰신로그의 기록은 1:1 연결된 상대에게만 공유됩니다. 나에게만 기록은 완전히 제외됩니다.')} 
          />
          <SettingsItem 
            icon={Smartphone} 
            label="PWA 홈 화면 설치 방법" 
            value="Safari 안내"
            onClick={() => setShowPWAModal(true)} 
          />
          <SettingsItem icon={Settings} label="민감 기록 잠금" onClick={() => handleToast('생체인증 잠금 기능 준비 중')} />
        </SettingsGroup>

        {/* Contact Hours */}
        <SettingsGroup title="연락 가능 시간">
          <SettingsItem 
            icon={Clock} 
            label="평일 연락 가능 시간" 
            value={`${profile.contact.weekdayStart}~${profile.contact.weekdayEnd}`} 
            onClick={() => handleToast('연락 가능 시간 수정 준비 중')}
          />
        </SettingsGroup>

        {/* Couple Space Section */}
        <SettingsGroup title="우리 공간 관리">
          <SettingsItem 
            icon={Download} 
            label="내 기록 내보내기" 
            value="준비 중"
            onClick={() => handleToast('내 기록 PDF/JSON 내보내기 기능 구현 예정입니다.')} 
          />
          <SettingsItem 
            icon={Trash2} 
            label="내 기록 선택 삭제" 
            value={`${ownRecords.length}개 보유`} 
            onClick={() => setShowDeleteRecordsModal(true)} 
          />
          {profile.couple.connected ? (
            <SettingsItem 
              icon={Link} 
              label="커플 연결 해제" 
              danger 
              onClick={() => setShowDisconnectModal(true)} 
            />
          ) : (
            <SettingsItem 
              icon={Link} 
              label="새 초대 코드 생성" 
              onClick={() => handleToast('새 초대 코드 발급 준비 중')} 
            />
          )}
        </SettingsGroup>

        {/* Account Management */}
        <SettingsGroup title="계정 관리">
          <SettingsItem icon={FileText} label="서비스 이용약관" onClick={() => handleToast('서비스 이용약관 준비 중')} />
          <SettingsItem icon={FileText} label="개인정보 처리방침" onClick={() => handleToast('개인정보 처리방침 준비 중')} />
          <SettingsItem 
            icon={LogOut} 
            label="로그아웃" 
            onClick={signOut} 
          />
          <SettingsItem 
            icon={Trash2} 
            label="계정 삭제 (회원 탈퇴)" 
            value="파일럿 전 구현 필요" 
            danger
            onClick={() => setShowDeleteAccountModal(true)} 
          />
        </SettingsGroup>

        {/* Reset App */}
        <button 
          onClick={reset}
          className="w-full py-4 mt-2 flex items-center justify-center gap-2 text-gray-400 hover:text-gray-600 font-medium text-xs min-h-[44px]"
        >
          앱 상태 초기화 (초기 온보딩으로 돌아가기)
        </button>

        {/* Disconnect Modal */}
        {showDisconnectModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl">
              <h3 className="text-lg font-bold text-gray-900">커플 연결 해제</h3>
              <div className="text-xs text-gray-600 space-y-2 leading-relaxed bg-gray-50 p-3 rounded-xl">
                <p>• <b>즉시 상대 접근이 차단</b>되며, 개인 모드로 전환됩니다.</p>
                <p>• 연결 해제 후 상대방은 내 새로운 기록을 볼 수 없습니다.</p>
                <p>• 기존에 작성한 내 기록은 내 아카이브에 안전하게 유지됩니다.</p>
                <p className="text-[11px] text-gray-400 pt-1 border-t border-gray-200">
                  * 데모 모드에서는 이 기기의 데모 연결 상태가 초기화됩니다.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowDisconnectModal(false)}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs active:bg-gray-200 min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    disconnect();
                    setShowDisconnectModal(false);
                    toast.success('커플 연결이 해제되었습니다. (개인 모드)');
                  }}
                  className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl text-xs active:bg-red-600 min-h-[44px]"
                >
                  해제하기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Records Modal */}
        {showDeleteRecordsModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl">
              <h3 className="text-lg font-bold text-gray-900">내 기록 전체 삭제</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                내가 작성한 총 {ownRecords.length}개의 일상 기록이 이 기기에서 삭제됩니다. 정말 삭제하시겠습니까?
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowDeleteRecordsModal(false)}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs active:bg-gray-200 min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    ownRecords.forEach((r) => deleteRecord(r.id));
                    setShowDeleteRecordsModal(false);
                    toast.success('내 기록이 모두 삭제되었습니다.');
                  }}
                  className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl text-xs active:bg-red-600 min-h-[44px]"
                >
                  전체 삭제
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Account Modal */}
        {/* DEVELOPER NOTE FOR SUPABASE INTEGRATION:
          * Real server account deletion requires calling a secure Edge Function with service_role key:
          * 1. Storage: delete objects in `couple-media` under user's records
          * 2. DB: delete rows in `daily_records`, `briefings`, `couple_members`, `profiles`
          * 3. Auth: call `supabase.auth.admin.deleteUser(user_id)`
          */}
        {showDeleteAccountModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl">
              <div className="flex items-center gap-2 text-red-500 font-bold text-base">
                <AlertTriangle size={20} />
                <span>계정 삭제 (회원 탈퇴)</span>
              </div>
              <div className="text-xs text-gray-600 space-y-2 leading-relaxed bg-red-50 p-3 rounded-xl text-red-900 border border-red-100">
                <p>• 계정을 삭제하면 내 프로필과 1:1 공간 데이터가 완전 삭제됩니다.</p>
                <p>• 상대방과의 연결이 끊어지며 복원할 수 없습니다.</p>
                <p>• <b>현재 데모 모드:</b> 이 기기의 데모 데이터가 초기화됩니다. (실제 Supabase 연동 시 서버 Auth/DB/Storage 데이터가 연쇄 삭제됩니다)</p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowDeleteAccountModal(false)}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs active:bg-gray-200 min-h-[44px]"
                >
                  닫기
                </button>
                <button
                  onClick={() => {
                    reset();
                    setShowDeleteAccountModal(false);
                    toast.info('데모 앱 상태가 초기화되었습니다.');
                  }}
                  className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl text-xs active:bg-red-600 min-h-[44px]"
                >
                  데모 데이터 초기화
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PWA Installation Modal */}
        {showPWAModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl">
              <div className="flex items-center gap-2 text-navy font-bold text-base">
                <Smartphone size={20} className="text-coral" />
                <span>iPhone PWA 홈 화면 설치</span>
              </div>
              <div className="text-xs text-gray-700 space-y-2 leading-relaxed bg-muted/50 p-3.5 rounded-xl border border-border">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-coral/20 text-coral font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                  <span>Safari 하단의 공유 아이콘 <Share size={13} className="inline text-coral mx-0.5" /> 을 누르세요.</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-coral/20 text-coral font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                  <span><b>'홈 화면에 추가'</b> <PlusSquare size={13} className="inline text-coral mx-0.5" /> 를 선택하세요.</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-coral/20 text-coral font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                  <span>'웹 앱으로 열기'를 켜고 추가하시면 전용 창으로 실행됩니다.</span>
                </div>
              </div>
              <button
                onClick={() => setShowPWAModal(false)}
                className="w-full py-3 bg-navy text-white font-bold rounded-xl text-xs active:scale-[0.99] min-h-[44px]"
              >
                확인
              </button>
            </div>
          </div>
        )}

      </div>
    </MobileShell>
  );
}
