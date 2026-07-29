import React from 'react';
import { useStore } from '@/lib/store';
import { TodayLogWidget } from '@/components/widgets/TodayLogWidget';
import { DDayWidget } from '@/components/widgets/DDayWidget';
import { UpcomingScheduleWidget } from '@/components/widgets/UpcomingScheduleWidget';

// 1. 오늘의 브리핑 (today_briefing)
const TodayBriefingWidget = () => {
  const { state } = useStore();
  const isGomsin = state.profile.role === 'gomsin';
  const partnerName = state.profile.couple.partnerName || '상대방';
  
  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
      <h3 className="font-bold text-navy mb-2 text-sm">오늘의 브리핑</h3>
      <p className="text-xs text-gray-500 font-medium">
        {isGomsin 
          ? `오늘 하루는 어땠나요? ${partnerName}에게 소중한 순간을 기록해 보세요.` 
          : `${partnerName}이 남긴 오늘의 기록을 확인해 보세요.`}
      </p>
    </div>
  );
};
// Existing TodayLogWidget can be used or we can use a separate component.
// The user asked for "오늘의 한마디", which fits our TodayLogWidget which has input & timeline.
// Or TodayLogWidget can be "기록 바로가기". Let's map it clearly.

// 3. 기록 바로가기 (record_shortcut)
const RecordShortcutWidget = () => (
  <div className="bg-coral/10 p-4 rounded-2xl border border-coral/20 flex flex-col items-center justify-center min-h-[100px]">
    <span className="text-coral font-bold text-sm">빠른 기록 남기기 ✍️</span>
  </div>
);

// 5. 복무 진행률 (service_progress)
const ServiceProgressWidget = () => (
  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
    <h3 className="font-bold text-navy mb-2 text-sm">복무 진행률</h3>
    <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
      <div className="bg-teal-500 h-full w-[45%]"></div>
    </div>
    <div className="mt-2 text-right text-[10px] text-gray-400">45% 진행됨</div>
  </div>
);

// 6. 연락 가능 시간 (contact_time)
const ContactTimeWidget = () => (
  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
    <div>
      <h3 className="font-bold text-navy text-sm">연락 가능 시간 📞</h3>
      <p className="text-[11px] text-gray-400 mt-1">오늘 18:00 ~ 21:00</p>
    </div>
    <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></span>
  </div>
);

// 7. 오늘의 식단 (today_meal)
const TodayMealWidget = () => (
  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
    <h3 className="font-bold text-navy mb-2 text-sm">오늘의 식단 🍚</h3>
    <p className="text-xs text-gray-500">제육볶음, 된장찌개, 김치</p>
  </div>
);

// 8. 다음 기념일 (next_anniversary)
// 9. 다음 휴가/만남 (next_vacation)
// These are subsets of UpcomingScheduleWidget. Let's just use placeholder components for now.
const NextAnniversaryWidget = () => (
  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
    <div className="w-10 h-10 bg-pink-50 rounded-full flex items-center justify-center text-pink-500">🎉</div>
    <div>
      <h3 className="font-bold text-navy text-sm">1주년</h3>
      <p className="text-xs text-gray-400">D-45</p>
    </div>
  </div>
);

const NextVacationWidget = () => (
  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
    <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-500">🏖️</div>
    <div>
      <h3 className="font-bold text-navy text-sm">첫 휴가</h3>
      <p className="text-xs text-gray-400">D-12</p>
    </div>
  </div>
);

// 10. 추억 다시보기 (memories)
const MemoriesWidget = () => (
  <div className="bg-gradient-to-r from-purple-100 to-pink-100 p-4 rounded-2xl border border-white shadow-sm min-h-[120px] flex flex-col justify-end">
    <h3 className="font-bold text-navy text-sm">1년 전 오늘 📸</h3>
  </div>
);

// 11. 오늘의 컨디션 (today_condition)
const TodayConditionWidget = () => (
  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
    <h3 className="font-bold text-navy text-sm">오늘의 컨디션</h3>
    <span className="text-2xl">😊</span>
  </div>
);

// 12. 나만의 메모 (my_memo)
const MyMemoWidget = () => (
  <div className="bg-yellow-50 p-4 rounded-2xl border border-yellow-100 shadow-sm min-h-[100px]">
    <h3 className="font-bold text-yellow-800 text-sm mb-2">메모장 📝</h3>
    <p className="text-xs text-yellow-600/80">간단한 메모를 남겨보세요.</p>
  </div>
);

export type WidgetDef = {
  id: string;
  label: string;
  description: string;
  component: React.FC;
};

export const WIDGET_REGISTRY: Record<string, WidgetDef> = {
  today_briefing: {
    id: 'today_briefing',
    label: '오늘의 브리핑',
    description: '하루의 요약을 첫 화면에서 빠르게 확인하세요.',
    component: TodayBriefingWidget,
  },
  today_word: {
    id: 'today_word',
    label: '오늘의 한마디',
    description: '서로에게 남기는 짧은 한마디 기록',
    component: TodayLogWidget, // reusing existing input widget
  },
  record_shortcut: {
    id: 'record_shortcut',
    label: '기록 바로가기',
    description: '빠르게 새로운 기록을 추가할 수 있는 단축 버튼',
    component: RecordShortcutWidget,
  },
  dday: {
    id: 'dday',
    label: '전역 D-Day',
    description: '우리 커플의 남은 복무일 및 연결 일수',
    component: DDayWidget, // reusing existing DDay
  },
  service_progress: {
    id: 'service_progress',
    label: '복무 진행률',
    description: '현재 군 복무가 얼마나 진행되었는지 확인',
    component: ServiceProgressWidget,
  },
  contact_time: {
    id: 'contact_time',
    label: '연락 가능 시간',
    description: '오늘 통화나 연락이 가능한 시간대 안내',
    component: ContactTimeWidget,
  },
  today_meal: {
    id: 'today_meal',
    label: '오늘의 식단',
    description: '군화의 오늘 병영 식단 메뉴 보기',
    component: TodayMealWidget,
  },
  next_anniversary: {
    id: 'next_anniversary',
    label: '다음 기념일',
    description: '다가오는 100일, 1년 등의 기념일 카운트다운',
    component: NextAnniversaryWidget,
  },
  next_vacation: {
    id: 'next_vacation',
    label: '다음 휴가/만남',
    description: '기다리던 휴가나 면회까지 남은 시간',
    component: NextVacationWidget,
  },
  memories: {
    id: 'memories',
    label: '추억 다시보기',
    description: '과거의 오늘 남겼던 기록 돌아보기',
    component: MemoriesWidget,
  },
  today_condition: {
    id: 'today_condition',
    label: '오늘의 컨디션',
    description: '나의 오늘의 기분과 건강 상태 공유',
    component: TodayConditionWidget,
  },
  my_memo: {
    id: 'my_memo',
    label: '나만의 메모',
    description: '개인적으로 간직할 짧은 메모장',
    component: MyMemoWidget,
  },
};
