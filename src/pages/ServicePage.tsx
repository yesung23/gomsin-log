import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/store';
import { BRANCH_SERVICE_MONTHS, addMonths, cn, formatLocalDate } from '@/lib/utils';
import {
  BRANCH_LABELS,
  computeRankTimeline,
  computeServiceProgress,
  getUpcomingEvents,
} from '@/lib/insights';
import {
  Edit2,
  Phone,
  Shield,
  CalendarPlus,
  Check,
  ChevronRight,
  Plane,
  MapPin,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Branch, MilitaryStatus, DischargeDateSource } from '@/types';

const BRANCH_OPTIONS: Branch[] = [
  'army',
  'marine',
  'reserve',
  'navy',
  'airforce',
  'social_service',
  'other',
];

const STATUS_OPTIONS: { key: MilitaryStatus; label: string }[] = [
  { key: 'planned', label: '입대 예정' },
  { key: 'serving', label: '복무 중' },
  { key: 'discharge_soon', label: '전역 예정' },
  { key: 'discharged', label: '전역했어요' },
  { key: 'unknown', label: '미입력' },
];

export function ServicePage() {
  const { state, updateProfile } = useStore();
  const navigate = useNavigate();
  const { profile, events } = state;
  const [isEditing, setIsEditing] = useState(false);

  const [editBranch, setEditBranch] = useState<Branch>(profile.military?.branch || 'army');
  const [editStatus, setEditStatus] = useState<MilitaryStatus>(
    profile.military?.militaryStatus || 'serving',
  );
  const [editEnlistDate, setEditEnlistDate] = useState(profile.military?.enlistmentDate || '');
  const [editExpectedDischarge, setEditExpectedDischarge] = useState(
    profile.military?.expectedDischargeDate || '',
  );
  const [editDischargeSource, setEditDischargeSource] = useState<DischargeDateSource>(
    profile.military?.dischargeDateSource || 'calculated',
  );

  // 모달을 열 때마다 저장된 값으로 초기화 (비동기 로딩 이후에도 최신값 반영)
  useEffect(() => {
    if (!isEditing) return;
    setEditBranch(profile.military?.branch || 'army');
    setEditStatus(profile.military?.militaryStatus || 'serving');
    setEditEnlistDate(profile.military?.enlistmentDate || '');
    setEditExpectedDischarge(profile.military?.expectedDischargeDate || '');
    setEditDischargeSource(profile.military?.dischargeDateSource || 'calculated');
  }, [isEditing, profile.military]);

  const soldierName =
    profile.role === 'soldier' ? profile.myName || '나' : profile.couple.partnerName || '군화';

  const progress = useMemo(
    () => computeServiceProgress(profile.military),
    [profile.military],
  );
  const rankTimeline = useMemo(
    () => computeRankTimeline(profile.military),
    [profile.military],
  );
  const leaveEvents = useMemo(
    () => getUpcomingEvents(events, { types: ['visit', 'vacation'], limit: 5 }),
    [events],
  );

  const handleSaveEdit = () => {
    if (editStatus !== 'unknown' && !editEnlistDate) {
      toast.error('입대일을 선택해 주세요.');
      return;
    }

    updateProfile({
      military: {
        ...profile.military,
        branch: editBranch,
        militaryStatus: editStatus,
        enlistmentDate: editEnlistDate || undefined,
        expectedDischargeDate: editExpectedDischarge || undefined,
        dischargeDateSource: editEnlistDate ? editDischargeSource : 'unknown',
      },
    });
    setIsEditing(false);
    toast.success('복무 정보를 저장했어요.');
  };

  const recalcDischarge = (branch: Branch, enlist: string) => {
    if (!enlist || editDischargeSource !== 'calculated') return;
    const months = BRANCH_SERVICE_MONTHS[branch];
    if (months > 0) setEditExpectedDischarge(addMonths(enlist, months));
  };

  const handleBranchChange = (branch: Branch) => {
    setEditBranch(branch);
    recalcDischarge(branch, editEnlistDate);
  };

  const handleEnlistChange = (enlist: string) => {
    setEditEnlistDate(enlist);
    recalcDischarge(editBranch, enlist);
  };

  return (
    <MobileShell>
      <div className="p-4 space-y-5 pb-28">
        <div className="flex items-center justify-between px-1 pt-4">
          <h1 className="text-2xl font-bold text-foreground">{soldierName}의 복무 현황</h1>
          <button
            onClick={() => setIsEditing(true)}
            className="p-2.5 rounded-2xl bg-card border border-border text-foreground active:scale-95 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="복무 정보 수정"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        </div>

        {/* D-Day Card */}
        {progress.hasData ? (
          <div className="bg-gradient-to-br from-teal-600 to-navy rounded-3xl p-6 text-white shadow-sm relative overflow-hidden">
            <Shield className="absolute -right-4 -bottom-4 w-32 h-32 text-white/10 rotate-12" />
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-2">
                <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm">
                  {BRANCH_LABELS[profile.military.branch]} ·{' '}
                  {profile.military.dischargeDateSource === 'manual' ? '수동 설정' : '자동 계산'}
                </span>
              </div>
              <div className="text-5xl font-black mb-4 tracking-tight">
                {progress.phase === 'discharged' ? '전역 🎉' : progress.headline}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-medium text-teal-50">
                  <span>복무율 {progress.percent.toFixed(1)}%</span>
                  <span>{progress.remainingDays}일 남음</span>
                </div>
                <div className="h-2.5 bg-black/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-coral rounded-full transition-all duration-1000"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-teal-100/70 pt-1">
                  <span>입대일: {progress.enlistmentDate}</span>
                  <span>전역일: {progress.dischargeDate}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="w-full rounded-3xl border border-dashed border-border bg-muted/40 p-6 text-center active:scale-[0.99] transition"
          >
            <Shield className="w-8 h-8 text-muted-foreground/60 mx-auto mb-2" />
            <h3 className="font-bold text-foreground text-sm mb-1">복무 정보를 입력해 주세요</h3>
            <p className="text-xs text-muted-foreground">
              군종과 입대일만 넣으면 전역 D-Day, 복무율, 진급 예정일을 계산해 드려요.
            </p>
          </button>
        )}

        {/* 진급 예정 타임라인 */}
        {rankTimeline.hasData && (
          <section className="bg-card rounded-2xl p-4 shadow-sm border border-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                <Star className="w-4 h-4 text-amber-500" /> 진급 예정일
              </h3>
              {rankTimeline.currentRank && (
                <span className="text-[11px] font-bold text-coral bg-coral/10 px-2.5 py-1 rounded-full">
                  현재 {rankTimeline.currentRank}
                </span>
              )}
            </div>

            <ol className="space-y-2">
              {rankTimeline.milestones.map((m) => (
                <li
                  key={m.rank}
                  className={cn(
                    'flex items-center justify-between rounded-xl px-3 py-2.5 border',
                    m.achieved
                      ? 'bg-muted/50 border-border/60'
                      : 'bg-card border-border',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold',
                        m.achieved
                          ? 'bg-teal-500/15 text-teal-600'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {m.achieved ? <Check className="w-3.5 h-3.5" /> : m.rank.charAt(0)}
                    </span>
                    <div>
                      <div className="text-xs font-bold text-foreground">{m.rank}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatLocalDate(m.date)}
                      </div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-[11px] font-bold',
                      m.achieved ? 'text-muted-foreground' : 'text-coral',
                    )}
                  >
                    {m.achieved ? '진급 완료' : m.dDay === 0 ? 'D-Day' : `D-${m.dDay}`}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              ※ 표준 진급 소요기간(이병 2개월 · 일병 6개월 · 상병 6개월)으로 계산한 예상일이며,
              부대 사정에 따라 실제 진급일은 달라질 수 있어요.
            </p>
          </section>
        )}

        {/* 휴가 · 면회 일정 */}
        <section className="bg-card rounded-2xl p-4 shadow-sm border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-foreground text-sm flex items-center gap-1.5">
              <Plane className="w-4 h-4 text-indigo-500" /> 다가오는 휴가 · 면회
            </h3>
            <button
              onClick={() => navigate('/schedule')}
              className="text-[11px] font-bold text-coral flex items-center gap-0.5"
            >
              <CalendarPlus className="w-3.5 h-3.5" /> 일정 추가
            </button>
          </div>

          {leaveEvents.length === 0 ? (
            <button
              onClick={() => navigate('/schedule')}
              className="w-full rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center active:scale-[0.99] transition"
            >
              <p className="text-xs font-semibold text-foreground">등록된 휴가 · 면회가 없어요</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                공유 일정에 추가하면 여기에서 D-Day로 확인할 수 있어요.
              </p>
            </button>
          ) : (
            <ul className="divide-y divide-border/50">
              {leaveEvents.map(({ event, dDay, ongoing }) => (
                <li key={event.id} className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
                      <MapPin className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-foreground truncate">
                        {event.title}
                        {!event.title.includes(event.eventType === 'visit' ? '면회' : '휴가') && (
                          <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground">
                            {event.eventType === 'visit' ? '면회' : '휴가'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatLocalDate(event.startDate)}
                        {event.endDate ? ` ~ ${formatLocalDate(event.endDate)}` : ''}
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded-md shrink-0">
                    {ongoing ? '진행 중' : dDay === 0 ? 'D-Day' : `D-${dDay}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Contact info */}
        <button
          onClick={() => navigate('/settings')}
          className="w-full bg-card rounded-2xl p-4 shadow-sm border border-border flex items-center justify-between active:scale-[0.99] transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-lilac/30 rounded-full flex items-center justify-center text-navy">
              <Phone className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className="font-bold text-foreground text-sm">연락 가능 시간 안내</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                평일 {profile.contact.weekdayStart} ~ {profile.contact.weekdayEnd} · 주말{' '}
                {profile.contact.weekendStart} ~ {profile.contact.weekendEnd}
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-3xl p-6 shadow-xl border border-border space-y-4 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-foreground">복무 정보 수정</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">군종</label>
                <select
                  value={editBranch}
                  onChange={(e) => handleBranchChange(e.target.value as Branch)}
                  className="w-full border border-border rounded-xl px-3 py-3 bg-card text-sm text-foreground min-h-[44px]"
                >
                  {BRANCH_OPTIONS.map((branch) => (
                    <option key={branch} value={branch}>
                      {BRANCH_LABELS[branch]}
                      {BRANCH_SERVICE_MONTHS[branch] > 0
                        ? ` (${BRANCH_SERVICE_MONTHS[branch]}개월)`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">복무 상태</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setEditStatus(option.key)}
                      className={cn(
                        'py-2.5 rounded-xl text-[11px] font-bold border transition min-h-[40px]',
                        editStatus === option.key
                          ? 'bg-coral text-white border-coral'
                          : 'bg-card border-border text-muted-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">입대일</label>
                <input
                  type="date"
                  value={editEnlistDate}
                  onChange={(e) => handleEnlistChange(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-3 bg-card text-sm text-foreground min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  예상 전역일
                </label>
                <input
                  type="date"
                  value={editExpectedDischarge}
                  onChange={(e) => {
                    setEditExpectedDischarge(e.target.value);
                    setEditDischargeSource('manual');
                  }}
                  className="w-full border border-border rounded-xl px-3 py-3 bg-card text-sm text-foreground min-h-[44px]"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  군종과 입대일로 자동 계산되며, 직접 수정할 수도 있어요.
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setIsEditing(false)}
                className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl text-xs active:scale-95 transition min-h-[44px]"
              >
                취소
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-3 bg-coral text-white font-bold rounded-xl text-xs active:scale-95 transition min-h-[44px]"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
