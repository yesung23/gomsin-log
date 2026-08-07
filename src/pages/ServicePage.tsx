import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import { useEscapeKey } from '@/lib/hooks';
import { localToday, toLocalDateString, addMonths, formatLocalDate } from '@/lib/utils';
import { computeServiceProgress, nextUpcomingEvent } from '@/lib/milestones';
import { ArrowLeft, Edit2, Phone, Shield, CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { Branch, MilitaryStatus, DischargeDateSource } from '@/types';

/** Standard service length by branch, in months. */
const SERVICE_MONTHS: Record<Branch, number> = {
  army: 18,
  marine: 18,
  reserve: 18,
  navy: 20,
  airforce: 21,
  social_service: 21,
  other: 0,
};

const BRANCH_LABELS: Record<Branch, string> = {
  army: '육군',
  marine: '해병대',
  reserve: '상근예비역',
  navy: '해군',
  airforce: '공군',
  social_service: '사회복무요원',
  other: '기타',
};

const STATUS_LABELS: Record<MilitaryStatus, string> = {
  planned: '입대 예정',
  serving: '복무 중',
  discharge_soon: '전역 예정',
  discharged: '전역',
  unknown: '미입력',
};

/**
 * Status the EDITOR opens on.
 *
 * A stored `unknown` means "nothing stated yet", which is the honest state to
 * read but a dead end to edit: the date fields are hidden, so the user who just
 * tapped 복무 정보 입력하기 would see nothing to fill in. The editor therefore
 * opens on `serving` — exactly the form this page showed before absent service
 * info stopped being back-filled with invented dates. Nothing is persisted until
 * 저장하기, which still validates the dates.
 */
function editableStatus(status: MilitaryStatus | undefined): MilitaryStatus {
  return !status || status === 'unknown' ? 'serving' : status;
}

/**
 * Provenance the EDITOR starts from. `unknown` is not an option the form can
 * express, and the discharge date is auto-derived from branch + enlistment until
 * the user overrides it, so `calculated` is the truthful starting point.
 */
function editableSource(source: DischargeDateSource | undefined): DischargeDateSource {
  return !source || source === 'unknown' ? 'calculated' : source;
}

export function ServicePage() {
  const { state, updateProfile } = useStore();
  const navigate = useNavigate();
  const { profile } = state;
  const military = profile.military;
  const todayStr = toLocalDateString(localToday());

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch>(military?.branch || 'army');
  const [editStatus, setEditStatus] = useState<MilitaryStatus>(
    editableStatus(military?.militaryStatus),
  );
  // No invented defaults: an empty field stays empty until the user fills it in.
  const [editEnlistDate, setEditEnlistDate] = useState(military?.enlistmentDate || '');
  const [editExpectedDischarge, setEditExpectedDischarge] = useState(
    military?.expectedDischargeDate || '',
  );
  const [editDischargeSource, setEditDischargeSource] = useState<DischargeDateSource>(
    editableSource(military?.dischargeDateSource),
  );

  useEscapeKey(() => {
    if (!isSaving) setIsEditing(false);
  }, isEditing);

  const isSoldier = profile.role === 'soldier';
  const soldierName = isSoldier ? profile.myName || '나' : profile.couple.partnerName || '군화';

  // Real progress, or null when the dates needed to compute it are missing.
  const progress = computeServiceProgress(military, todayStr);
  const nextLeave = nextUpcomingEvent(state.events, todayStr, ['vacation', 'visit']);

  const openEditor = () => {
    setEditBranch(military?.branch || 'army');
    setEditStatus(editableStatus(military?.militaryStatus));
    setEditEnlistDate(military?.enlistmentDate || '');
    setEditExpectedDischarge(military?.expectedDischargeDate || '');
    setEditDischargeSource(editableSource(military?.dischargeDateSource));
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (isSaving) return;
    if (editStatus !== 'unknown') {
      if (!editEnlistDate) {
        toast.error('입대일을 입력해 주세요.');
        return;
      }
      if (!editExpectedDischarge) {
        toast.error('예상 전역일을 입력해 주세요.');
        return;
      }
      if (editExpectedDischarge <= editEnlistDate) {
        toast.error('예상 전역일은 입대일보다 뒤여야 해요.');
        return;
      }
    }

    setIsSaving(true);
    try {
      const saved = await updateProfile({
        military: {
          ...military,
          branch: editBranch,
          militaryStatus: editStatus,
          enlistmentDate: editStatus === 'unknown' ? undefined : editEnlistDate,
          expectedDischargeDate: editStatus === 'unknown' ? undefined : editExpectedDischarge,
          dischargeDateSource: editDischargeSource,
        },
      });
      if (!saved) {
        toast.error('복무 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setIsEditing(false);
      toast.success('복무 정보가 저장되었습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBranchOrEnlistChange = (newBranch: Branch, newEnlist: string) => {
    setEditBranch(newBranch);
    setEditEnlistDate(newEnlist);
    // Only recalculate while the user has not overridden the discharge date.
    if (newEnlist && editDischargeSource === 'calculated') {
      const months = SERVICE_MONTHS[newBranch];
      if (months > 0) setEditExpectedDischarge(addMonths(newEnlist, months));
    }
  };

  return (
    <MobileShell>
      <div className="p-4 space-y-5 pb-28">
        <header className="flex items-center justify-between pt-2">
          <button
            onClick={() => navigate(-1)}
            aria-label="뒤로가기"
            className="p-2 -ml-2 rounded-xl hover:bg-muted text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold text-foreground">{soldierName}의 복무 현황</h1>
          <button
            onClick={openEditor}
            aria-label="복무 정보 수정"
            className="p-2 -mr-2 rounded-xl hover:bg-muted text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Edit2 size={18} />
          </button>
        </header>

        {/* D-Day / progress. Shown only when real dates exist. */}
        {progress ? (
          <div className="bg-gradient-to-br from-navy to-navy/80 rounded-3xl p-6 text-white shadow-sm relative overflow-hidden">
            <Shield className="absolute -right-4 -bottom-4 w-32 h-32 text-white/10 rotate-12" />
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-2">
                <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm">
                  {BRANCH_LABELS[military?.branch || 'army']} ·{' '}
                  {STATUS_LABELS[military?.militaryStatus || 'serving']}
                </span>
                {/* Provenance is only claimed when it is actually known.
                    `unknown` used to fall through to 자동 계산, which asserted
                    the date had been derived when nobody had said so. */}
                {military?.dischargeDateSource !== 'unknown' && (
                  <span className="bg-white/10 px-2.5 py-1 rounded-full text-[10px] font-semibold">
                    {military?.dischargeDateSource === 'manual' ? '직접 입력' : '자동 계산'}
                  </span>
                )}
              </div>

              <div className="text-5xl font-black mb-4 tracking-tight">
                {progress.isDischarged ? '전역 🎉' : `D-${progress.remainingDays}`}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm font-medium text-white/80">
                  <span>복무율 {progress.percent}%</span>
                  <span>{progress.remainingDays}일 남음</span>
                </div>
                <div className="h-2.5 bg-black/25 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-coral rounded-full transition-all duration-1000"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-white/60 pt-1">
                  <span>입대 {formatLocalDate(military!.enlistmentDate!)}</span>
                  <span>전역 {formatLocalDate(military!.expectedDischargeDate!)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-border bg-muted/40 p-6 text-center space-y-3">
            <Shield className="w-8 h-8 text-muted-foreground/60 mx-auto" />
            <div>
              <h2 className="font-bold text-foreground text-sm">복무 정보가 아직 없어요</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed break-keep">
                입대일과 예상 전역일을 입력하면 남은 날짜와 복무율을 계산해 드려요.
              </p>
            </div>
            <button
              onClick={openEditor}
              className="px-4 py-2.5 rounded-xl bg-coral text-white text-xs font-bold min-h-[44px]"
            >
              복무 정보 입력하기
            </button>
          </div>
        )}

        {/* Contact window, from the soldier's saved preferences. */}
        <div className="bg-card rounded-2xl p-4 shadow-sm border border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-lilac/30 rounded-full flex items-center justify-center text-foreground shrink-0">
              <Phone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-foreground text-sm">연락 가능 시간</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                평일 {profile.contact.weekdayStart} ~ {profile.contact.weekdayEnd} · 주말{' '}
                {profile.contact.weekendStart} ~ {profile.contact.weekendEnd}
              </div>
            </div>
          </div>
        </div>

        {/* Next leave / visit, read from real events. */}
        <div className="bg-card rounded-2xl p-4 shadow-sm border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-foreground text-sm">다음 휴가·면회</h2>
            <button
              onClick={() => navigate('/schedule')}
              className="text-xs font-bold text-coral flex items-center gap-1"
            >
              <CalendarPlus size={14} />
              일정 관리
            </button>
          </div>
          {nextLeave ? (
            <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5">
              <span className="text-sm font-semibold text-foreground truncate">
                {nextLeave.title}
              </span>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">
                {formatLocalDate(nextLeave.startDate)}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed break-keep">
              등록된 휴가나 면회 일정이 없어요. 일정을 추가하면 여기와 홈 화면에 함께 표시됩니다.
            </p>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="service-edit-modal-title" className="bg-card border border-border w-full max-w-md rounded-3xl p-6 shadow-xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <h3 id="service-edit-modal-title" className="text-lg font-bold text-foreground">복무 정보 수정</h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="svc-status" className="block text-xs font-semibold text-muted-foreground mb-1">
                  복무 상태
                </label>
                <select
                  id="svc-status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as MilitaryStatus)}
                  className="w-full border border-border rounded-xl px-3 py-3 bg-muted text-foreground text-sm min-h-[44px]"
                >
                  <option value="planned">입대 예정</option>
                  <option value="serving">복무 중</option>
                  <option value="discharge_soon">전역 예정</option>
                  <option value="discharged">전역했어요</option>
                  <option value="unknown">아직 입력하지 않을래요</option>
                </select>
              </div>

              <div>
                <label htmlFor="svc-branch" className="block text-xs font-semibold text-muted-foreground mb-1">
                  군종
                </label>
                <select
                  id="svc-branch"
                  value={editBranch}
                  onChange={(e) => handleBranchOrEnlistChange(e.target.value as Branch, editEnlistDate)}
                  className="w-full border border-border rounded-xl px-3 py-3 bg-muted text-foreground text-sm min-h-[44px]"
                >
                  <option value="army">육군 (18개월)</option>
                  <option value="marine">해병대 (18개월)</option>
                  <option value="reserve">상근예비역 (18개월)</option>
                  <option value="navy">해군 (20개월)</option>
                  <option value="airforce">공군 (21개월)</option>
                  <option value="social_service">사회복무요원 (21개월)</option>
                  <option value="other">기타</option>
                </select>
              </div>

              {editStatus !== 'unknown' && (
                <>
                  <div>
                    <label htmlFor="svc-enlist" className="block text-xs font-semibold text-muted-foreground mb-1">
                      입대일
                    </label>
                    <input
                      id="svc-enlist"
                      type="date"
                      value={editEnlistDate}
                      onChange={(e) => handleBranchOrEnlistChange(editBranch, e.target.value)}
                      className="w-full border border-border rounded-xl px-3 py-3 bg-muted text-foreground text-sm min-h-[44px]"
                    />
                  </div>

                  <div>
                    <label htmlFor="svc-discharge" className="block text-xs font-semibold text-muted-foreground mb-1">
                      예상 전역일
                    </label>
                    <input
                      id="svc-discharge"
                      type="date"
                      value={editExpectedDischarge}
                      onChange={(e) => {
                        setEditExpectedDischarge(e.target.value);
                        setEditDischargeSource('manual');
                      }}
                      className="w-full border border-border rounded-xl px-3 py-3 bg-muted text-foreground text-sm min-h-[44px]"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      군종과 입대일로 자동 계산되며, 직접 수정할 수도 있어요.
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
                className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl text-xs min-h-[44px]"
              >
                취소
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="flex-1 py-3 bg-coral text-white font-bold rounded-xl text-xs min-h-[44px] disabled:opacity-50"
              >
                {isSaving ? '저장 중…' : '저장하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
