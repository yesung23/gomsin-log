import React, { useState } from 'react';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/store';
import { daysBetweenLocal, localToday, toLocalDateString, addMonths } from '@/lib/utils';
import { Edit2, Phone, Shield, Coffee, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Branch, MilitaryStatus, DischargeDateSource } from '@/types';

export function ServicePage() {
  const { state, updateProfile } = useStore();
  const { profile } = state;
  const [isEditing, setIsEditing] = useState(false);
  
  const [editBranch, setEditBranch] = useState<Branch>(profile.military?.branch || 'army');
  const [editStatus, setEditStatus] = useState<MilitaryStatus>(profile.military?.militaryStatus || 'serving');
  const [editEnlistDate, setEditEnlistDate] = useState(profile.military?.enlistmentDate || '2025-03-10');
  const [editExpectedDischarge, setEditExpectedDischarge] = useState(profile.military?.expectedDischargeDate || '2026-09-09');
  const [editDischargeSource, setEditDischargeSource] = useState<DischargeDateSource>(profile.military?.dischargeDateSource || 'calculated');

  const soldierName = profile.role === 'soldier' ? profile.myName : (profile.couple.partnerName || '군화');

  const enlistmentDate = profile.military?.enlistmentDate || '2025-03-10';
  const expectedDischargeDate = profile.military?.expectedDischargeDate || '2026-09-09';
  const todayStr = toLocalDateString(localToday());

  const totalDays = daysBetweenLocal(enlistmentDate, expectedDischargeDate);
  const elapsedDays = daysBetweenLocal(enlistmentDate, todayStr);
  const dDay = daysBetweenLocal(todayStr, expectedDischargeDate);
  
  const progressPercent = totalDays > 0 ? Math.min(Math.max((elapsedDays / totalDays) * 100, 0), 100) : 0;

  const handleSaveEdit = () => {
    updateProfile({
      military: {
        ...profile.military,
        branch: editBranch,
        militaryStatus: editStatus,
        enlistmentDate: editEnlistDate,
        expectedDischargeDate: editExpectedDischarge,
        dischargeDateSource: editDischargeSource,
      }
    });
    setIsEditing(false);
  };

  const handleBranchOrEnlistChange = (newBranch: Branch, newEnlist: string) => {
    setEditBranch(newBranch);
    setEditEnlistDate(newEnlist);
    if (newEnlist && editDischargeSource === 'calculated') {
      const monthsMap: Record<Branch, number> = {
        army: 18,
        marine: 18,
        reserve: 18,
        navy: 20,
        airforce: 21,
        social_service: 21,
        other: 0,
      };
      const m = monthsMap[newBranch] || 18;
      if (m > 0) {
        setEditExpectedDischarge(addMonths(newEnlist, m));
      }
    }
  };

  return (
    <MobileShell>
      <div className="p-4 space-y-6 pb-24">
        <h1 className="text-2xl font-bold px-1 pt-4">{soldierName}의 복무 현황</h1>

        {/* D-Day Card */}
        <div className="bg-gradient-to-br from-teal-600 to-navy rounded-3xl p-6 text-white shadow-sm relative overflow-hidden">
          <Shield className="absolute -right-4 -bottom-4 w-32 h-32 text-white/10 rotate-12" />
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-2">
              <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm">
                예상 전역일 ({profile.military?.dischargeDateSource === 'manual' ? '수동 설정' : '자동 계산'})
              </span>
              <button 
                onClick={() => setIsEditing(true)}
                className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 min-h-[44px] min-w-[44px]"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
            <div className="text-5xl font-black mb-4 tracking-tight">
              D-{Math.max(0, dDay)}
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium text-teal-50">
                <span>복무율 {progressPercent.toFixed(1)}%</span>
                <span>{Math.max(0, totalDays - elapsedDays)}일 남음</span>
              </div>
              <div className="h-2.5 bg-black/20 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-coral rounded-full transition-all duration-1000"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-teal-100/70 pt-1">
                <span>입대일: {enlistmentDate}</span>
                <span>예상 전역일: {expectedDischargeDate}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-lilac/30 rounded-full flex items-center justify-center text-navy">
              <Phone className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-sm">연락 가능 시간 안내</div>
              <div className="text-xs text-gray-500 mt-0.5">
                평일 {profile.contact.weekdayStart} ~ {profile.contact.weekdayEnd}
              </div>
            </div>
          </div>
        </div>

        {/* 휴가·진급 준비 중 안내 */}
        <div className="bg-gray-50 rounded-2xl p-6 text-center border border-gray-200 border-dashed">
          <Coffee className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <h3 className="font-bold text-gray-700 mb-1 text-sm">휴가·면회·외박 관리</h3>
          <p className="text-xs text-gray-400">다음 업데이트에서 만나요</p>
        </div>

        {/* Upcoming Promo */}
        <div className="bg-gray-50 rounded-2xl p-6 text-center border border-gray-200 border-dashed">
          <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <h3 className="font-bold text-gray-700 mb-1 text-sm">진급 및 휴가 자동 계산</h3>
          <p className="text-xs text-gray-400">2차 업데이트 준비 중</p>
        </div>
      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-xl animate-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0 sm:zoom-in-95 space-y-4">
            <h3 className="text-lg font-bold">복무 정보 수정</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">군종</label>
                <select 
                  value={editBranch}
                  onChange={(e) => handleBranchOrEnlistChange(e.target.value as Branch, editEnlistDate)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-3 bg-white text-sm min-h-[44px]"
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

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">입대일</label>
                <input 
                  type="date"
                  value={editEnlistDate}
                  onChange={(e) => handleBranchOrEnlistChange(editBranch, e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-3 bg-white text-sm min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">예상 전역일</label>
                <input 
                  type="date"
                  value={editExpectedDischarge}
                  onChange={(e) => {
                    setEditExpectedDischarge(e.target.value);
                    setEditDischargeSource('manual');
                  }}
                  className="w-full border border-gray-300 rounded-xl px-3 py-3 bg-white text-sm min-h-[44px]"
                />
                <p className="text-[11px] text-gray-400 mt-1">자동 계산값에서 직접 수정할 수 있습니다.</p>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                onClick={() => setIsEditing(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs active:bg-gray-200 min-h-[44px]"
              >
                취소
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-3 bg-coral text-white font-bold rounded-xl text-xs active:bg-coral/90 min-h-[44px]"
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
