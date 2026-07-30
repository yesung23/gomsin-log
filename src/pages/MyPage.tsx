import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/store';
import { 
  User, Shield, Lock, ChevronRight, AlertTriangle, 
  HeartPulse, ShieldAlert, Sparkles, CheckCircle2, ChevronLeft, Calendar, Settings, Plus, Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  fetchCycleEntriesFromDB, saveCycleEntryToDB, deleteCycleEntryFromDB, 
  fetchCycleSettingsFromDB, saveCycleSettingsToDB 
} from '@/lib/cycle';
import { CycleEntry } from '@/types';

export function MyPage() {
  const navigate = useNavigate();
  const { state, switchRole, disconnect, signOut } = useStore();
  const { profile, isDemoMode } = state;
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  const isGomsin = profile.role === 'gomsin';
  const roleLabel = isGomsin ? '곰신' : '군화';

  // Menstrual cycle DB state (Gomsin Only)
  const [cycleEntries, setCycleEntries] = useState<CycleEntry[]>([]);
  const [cycleLength, setCycleLength] = useState(28);
  const [periodLength, setPeriodLength] = useState(5);
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (isGomsin) {
      loadCycleData();
    }
  }, [isGomsin]);

  const loadCycleData = async () => {
    const [entries, settings] = await Promise.all([
      fetchCycleEntriesFromDB(),
      fetchCycleSettingsFromDB(),
    ]);
    setCycleEntries(entries);
    if (settings) {
      setCycleLength(settings.averageCycleLength);
      setPeriodLength(settings.averagePeriodLength);
    }
  };

  const handleToggleStartDate = async (dateStr: string) => {
    const existing = cycleEntries.find((e) => e.startDate === dateStr);
    if (existing) {
      const ok = await deleteCycleEntryFromDB(existing.id);
      if (ok) {
        setCycleEntries((prev) => prev.filter((e) => e.id !== existing.id));
        toast.info('생리 시작일 기록이 삭제되었습니다.');
      }
    } else {
      const saved = await saveCycleEntryToDB(dateStr);
      if (saved) {
        setCycleEntries((prev) => [saved, ...prev]);
        toast.success(`${dateStr} 생리 시작일이 기록되었습니다.`);
      }
    }
  };

  // Calculate next predicted start date
  const latestEntry = cycleEntries[0];
  const nextPredictedDate = latestEntry
    ? (() => {
        const d = new Date(latestEntry.startDate);
        d.setDate(d.getDate() + cycleLength);
        return d.toISOString().split('T')[0];
      })()
    : null;

  return (
    <MobileShell>
      <div className="p-4 pb-28 space-y-5">
        {/* Top Header with Settings Gear Button */}
        <div className="flex items-center justify-between px-1 pt-4 pb-1">
          <h1 className="text-2xl font-extrabold text-foreground">마이</h1>
          <button
            onClick={() => navigate('/settings')}
            className="p-2.5 rounded-2xl bg-card border border-border text-foreground hover:bg-muted active:scale-95 transition flex items-center justify-center min-h-[44px] min-w-[44px]"
            aria-label="설정 페이지로 이동"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Profile Card */}
        <div className="bg-card rounded-3xl p-5 shadow-sm border border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-coral/15 text-coral font-extrabold flex items-center justify-center text-xl border border-coral/30">
              {isGomsin ? '🌸' : '🪖'}
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{profile.myName || '나'}</h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span className="bg-coral/10 text-coral px-2 py-0.5 rounded-md font-bold text-[11px]">
                  {roleLabel}
                </span>
                {profile.couple.connected && profile.couple.status === 'active' ? (
                  <span className="text-emerald-600 font-semibold">{profile.couple.partnerName}님과 연결됨</span>
                ) : (
                  <span className="text-muted-foreground">연결 대기 중</span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/settings')}
            className="text-xs font-semibold text-coral bg-coral/10 px-3 py-2 rounded-xl active:scale-95 transition"
          >
            설정
          </button>
        </div>

        {/* GOMSIN ONLY: 내 몸의 리듬 (Menstrual Cycle Tracker) */}
        {isGomsin && (
          <section className="bg-card rounded-3xl p-5 border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-coral" />
                <h3 className="text-base font-extrabold text-foreground">내 몸의 리듬</h3>
              </div>
              <span className="text-[10px] text-coral font-bold bg-coral/10 px-2.5 py-1 rounded-full">
                🔒 나만 보기 (완전 비공개)
              </span>
            </div>

            {/* Privacy Box & Disclaimer */}
            <div className="bg-lilac/30 border border-lilac/60 p-4 rounded-2xl space-y-1.5 text-center">
              <div className="flex items-center justify-center gap-1.5 text-navy font-bold text-xs">
                <Lock className="w-3.5 h-3.5" />
                <span>군화, AI 브리핑, 파트너 어디에도 노출되지 않아요</span>
              </div>
              <p className="text-[11px] text-navy/70 leading-relaxed">
                ※ 단순 기록 보조용이며, 의학적 진단이나 피임 안내를 제공하지 않습니다.
              </p>
            </div>

            {/* Next Expected Period Date Card */}
            {nextPredictedDate ? (
              <div className="p-4 rounded-2xl bg-coral/10 border border-coral/20 flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-coral font-bold block">다음 예상 주기</span>
                  <span className="text-base font-extrabold text-foreground">{nextPredictedDate} 쯤</span>
                </div>
                <span className="text-xs text-coral font-semibold">평균 {cycleLength}일 주기</span>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60 text-xs text-muted-foreground text-center">
                생리 시작일을 달력에서 선택해 남겨보세요.
              </div>
            )}

            {/* Mini Calendar View */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={() => setViewMonth((m) => (m === 0 ? 11 : m - 1))}
                  className="p-1 rounded-lg hover:bg-muted"
                >
                  <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                </button>
                <span className="text-xs font-bold text-foreground">
                  {viewYear}년 {viewMonth + 1}월
                </span>
                <button
                  onClick={() => setViewMonth((m) => (m === 11 ? 0 : m + 1))}
                  className="p-1 rounded-lg hover:bg-muted"
                >
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* Day Labels & Grid */}
              <div className="grid grid-cols-7 text-center text-[10px] font-bold text-muted-foreground gap-1">
                <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
              </div>
              <div className="grid grid-cols-7 text-center text-xs gap-1 font-medium">
                {Array.from({ length: new Date(viewYear, viewMonth + 1, 0).getDate() }, (_, i) => i + 1).map((day) => {
                  const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const isRecordedStart = cycleEntries.some((e) => e.startDate === dateStr);
                  const isToday = new Date().toISOString().split('T')[0] === dateStr;

                  return (
                    <button
                      key={day}
                      onClick={() => handleToggleStartDate(dateStr)}
                      className={cn(
                        'py-2 rounded-xl transition flex flex-col items-center justify-center min-h-[36px]',
                        isRecordedStart && 'bg-rose-500 text-white font-bold shadow-sm',
                        !isRecordedStart && isToday && 'ring-2 ring-coral text-coral font-bold',
                        !isRecordedStart && !isToday && 'hover:bg-muted text-foreground'
                      )}
                    >
                      <span>{day}</span>
                      {isRecordedStart && <span className="text-[9px] font-normal leading-none mt-0.5">시작</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* SOLDIER ONLY: 병역 관련 도움 정보 (Military Service Help) */}
        {!isGomsin && (
          <section className="bg-card rounded-3xl p-5 border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-coral" />
                <h3 className="text-base font-extrabold text-foreground">병역 관련 도움 정보</h3>
              </div>
              <span className="text-[10px] text-muted-foreground font-medium">군 생활가이드</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/40 border border-border/60 p-3.5 rounded-2xl space-y-1">
                <span className="text-lg">🎖️</span>
                <h4 className="text-xs font-bold text-foreground">전역일 계산기</h4>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  복무율과 남은 일수를 한눈에 확인해요.
                </p>
              </div>

              <div className="bg-muted/40 border border-border/60 p-3.5 rounded-2xl space-y-1">
                <span className="text-lg">🏖️</span>
                <h4 className="text-xs font-bold text-foreground">휴가 일정 가이드</h4>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  정기/포상 휴가 계획을 세워보세요.
                </p>
              </div>
            </div>

            <div className="bg-mint/40 border border-mint-foreground/20 p-4 rounded-2xl space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-navy">
                <Sparkles className="w-4 h-4 text-navy" />
                <span>군 복무자 혜택 및 긴급 연락처</span>
              </div>
              <p className="text-[11px] text-navy/80 leading-relaxed pt-1">
                • 병사 적금(장병내일준비적금) 연 6% 이상 우대 금리 안내<br />
                • 국방 헬프콜 24시간 상담: 1303<br />
                • 군 장병 전용 할인 혜택 모음
              </p>
            </div>
          </section>
        )}

        {/* Demo Mode Toggle */}
        {isDemoMode && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl text-xs space-y-2">
            <div className="flex items-center justify-between font-bold text-amber-900">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <span>데모 역할 전환</span>
              </span>
              <span className="text-[10px] bg-amber-200 px-2 py-0.5 rounded-md">로컬 데모</span>
            </div>
            <p className="text-amber-800 text-[11px]">
              곰신/군화 각 역할별 전용 홈과 마이페이지를 바로 전환하여 체험해보세요.
            </p>
            <button
              onClick={switchRole}
              className="w-full py-2.5 rounded-xl bg-amber-200 text-amber-950 font-bold active:scale-98 transition min-h-[40px]"
            >
              현재 {roleLabel} 모드 → {isGomsin ? '군화' : '곰신'} 모드로 전환하기
            </button>
          </div>
        )}

        {/* Link to Full Settings Page */}
        <section className="bg-card rounded-3xl border border-border p-4 shadow-sm">
          <button
            onClick={() => navigate('/settings')}
            className="w-full py-3 px-2 flex items-center justify-between text-xs font-bold text-foreground hover:text-coral transition"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-coral" />
              <span>설정 및 계정 관리 (연결, 알림, 잠금, 로그아웃)</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </section>
      </div>
    </MobileShell>
  );
}
