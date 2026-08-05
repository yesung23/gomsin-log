import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Battery,
  CalendarHeart,
  Clock,
  Image as ImageIcon,
  Notebook,
  PenLine,
  PhoneCall,
  Plane,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { TodayLogWidget } from '@/components/widgets/TodayLogWidget';
import { DDayWidget } from '@/components/widgets/DDayWidget';
import { UpcomingScheduleWidget } from '@/components/widgets/UpcomingScheduleWidget';
import { generateDailySummary } from '@/lib/briefing';
import {
  computeServiceProgress,
  computeTodayCondition,
  getMemory,
  getNextAnniversary,
  getNextMeetup,
  today as todayString,
} from '@/lib/insights';
import { formatLocalDate } from '@/lib/utils';

/**
 * 홈 화면 위젯 레지스트리.
 * 모든 위젯은 store에 저장된 실제 데이터(기록 · 일정 · 프로필)만 사용하고,
 * 데이터가 없을 때는 예시값 대신 입력을 유도하는 빈 상태를 보여줍니다.
 */

const cardClass = 'bg-card p-4 rounded-2xl border border-border shadow-sm';

function WidgetShell({
  title,
  icon,
  onClick,
  children,
  ariaLabel,
}: {
  title: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const content = (
    <>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h3 className="font-bold text-foreground text-sm">{title}</h3>
      </div>
      {children}
    </>
  );

  if (!onClick) return <div className={cardClass}>{content}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel || title}
      className={`${cardClass} w-full text-left active:scale-[0.99] transition`}
    >
      {content}
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground font-medium">{text}</p>;
}

// 1. 오늘의 브리핑 (today_briefing)
const TodayBriefingWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const todayStr = todayString();
  const isGomsin = state.profile.role === 'gomsin';
  const partnerName = state.profile.couple.partnerName || '상대방';

  const { myCount, partnerRecords, lastTime } = useMemo(() => {
    const todays = state.records.filter((r) => r.date === todayStr);
    const mine = todays.filter((r) => r.authorRole === state.profile.role);
    const partner = todays
      .filter((r) => r.authorRole !== state.profile.role && !r.isPrivate)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    return {
      myCount: mine.length,
      partnerRecords: partner,
      lastTime: partner.length > 0 ? partner[partner.length - 1].time : undefined,
    };
  }, [state.records, state.profile.role, todayStr]);

  const summary = useMemo(
    () => generateDailySummary(partnerRecords, partnerName),
    [partnerRecords, partnerName],
  );

  return (
    <WidgetShell
      title="오늘의 브리핑"
      icon={<Sparkles size={14} className="text-coral" />}
      onClick={() => navigate(`/record?date=${todayStr}`)}
    >
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-foreground">
          {partnerRecords.length > 0
            ? `${partnerName}이 오늘 ${partnerRecords.length}개의 순간을 공유했어요`
            : `${partnerName}이 공유한 오늘 기록은 아직 없어요`}
        </p>
        {summary.items.length > 0 && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            • {summary.items[0].text}
          </p>
        )}
        <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">
            내 기록 {myCount}개
          </span>
          {lastTime && (
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-coral" />
              마지막 {lastTime}
            </span>
          )}
        </div>
        {!isGomsin && partnerRecords.length === 0 && (
          <EmptyHint text="연락 시간 전에 다시 확인해 보세요." />
        )}
      </div>
    </WidgetShell>
  );
};

// 3. 기록 바로가기 (record_shortcut)
const RecordShortcutWidget = () => {
  const navigate = useNavigate();
  const { state } = useStore();
  const todayStr = todayString();
  const myTodayCount = state.records.filter(
    (r) => r.date === todayStr && r.authorRole === state.profile.role,
  ).length;

  return (
    <button
      type="button"
      onClick={() => navigate(`/record?date=${todayStr}`)}
      className="w-full bg-coral/10 p-4 rounded-2xl border border-coral/20 flex flex-col items-center justify-center min-h-[100px] gap-1 active:scale-[0.99] transition"
    >
      <PenLine size={20} className="text-coral" />
      <span className="text-coral font-bold text-sm">기록 보기 · 남기기</span>
      <span className="text-[11px] text-coral/70 font-medium">
        오늘 내가 남긴 순간 {myTodayCount}개
      </span>
    </button>
  );
};

// 5. 복무 진행률 (service_progress)
const ServiceProgressWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const progress = useMemo(
    () => computeServiceProgress(state.profile.military),
    [state.profile.military],
  );

  return (
    <WidgetShell
      title="복무 진행률"
      icon={<Shield size={14} className="text-teal-600" />}
      onClick={() => navigate('/service')}
      ariaLabel="복무 현황 자세히 보기"
    >
      {!progress.hasData ? (
        <EmptyHint text="입대일을 입력하면 복무율과 전역 D-Day를 계산해 드려요. 눌러서 입력하기 →" />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-foreground">{progress.headline}</span>
            <span className="text-muted-foreground">{progress.percent.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-muted h-3 rounded-full overflow-hidden">
            <div
              className="bg-teal-500 h-full rounded-full transition-all duration-700"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground">{progress.caption}</div>
        </div>
      )}
    </WidgetShell>
  );
};

// 6. 연락 가능 시간 (contact_window)
const ContactWindowWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const { contact } = state.profile;
  const isWeekend = [0, 6].includes(new Date().getDay());
  const start = isWeekend ? contact.weekendStart : contact.weekdayStart;
  const end = isWeekend ? contact.weekendEnd : contact.weekdayEnd;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const inWindow = currentMinutes >= toMinutes(start) && currentMinutes <= toMinutes(end);

  return (
    <WidgetShell
      title="연락 가능 시간"
      icon={<PhoneCall size={14} className="text-coral" />}
      onClick={() => navigate('/settings')}
    >
      <div className="space-y-1">
        <p className="text-sm font-extrabold text-foreground">
          {isWeekend ? '주말' : '평일'} {start} ~ {end}
        </p>
        <p className="text-[11px] font-medium text-muted-foreground">
          {!contact.enabled
            ? '연락 시간 안내가 꺼져 있어요'
            : inWindow
            ? '지금은 통화가 가능한 시간이에요 📞'
            : '지금은 통화가 어려운 시간이에요'}
        </p>
      </div>
    </WidgetShell>
  );
};

// 8. 다음 기념일 (next_anniversary)
const NextAnniversaryWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const next = useMemo(
    () => getNextAnniversary(state.profile.couple.anniversaryDate, state.events),
    [state.profile.couple.anniversaryDate, state.events],
  );

  return (
    <button
      type="button"
      onClick={() => navigate(next ? '/schedule' : '/us')}
      className={`${cardClass} w-full text-left flex items-center gap-3 active:scale-[0.99] transition`}
    >
      <div className="w-10 h-10 bg-coral/10 rounded-full flex items-center justify-center text-coral shrink-0">
        <CalendarHeart size={18} />
      </div>
      {next ? (
        <div className="min-w-0">
          <h3 className="font-bold text-foreground text-sm truncate">{next.label}</h3>
          <p className="text-xs text-muted-foreground">
            {next.dDay === 0 ? 'D-Day' : `D-${next.dDay}`} · {formatLocalDate(next.date)}
          </p>
        </div>
      ) : (
        <div>
          <h3 className="font-bold text-foreground text-sm">다음 기념일</h3>
          <p className="text-xs text-muted-foreground">사귄 날짜를 등록하면 계산해 드려요</p>
        </div>
      )}
    </button>
  );
};

// 9. 다음 휴가 / 만남 (next_vacation)
const NextMeetupWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const next = useMemo(() => getNextMeetup(state.events), [state.events]);

  const typeLabel: Record<string, string> = {
    visit: '면회',
    vacation: '휴가',
    trip: '여행',
  };

  return (
    <button
      type="button"
      onClick={() => navigate('/schedule')}
      className={`${cardClass} w-full text-left flex items-center gap-3 active:scale-[0.99] transition`}
    >
      <div className="w-10 h-10 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-500 shrink-0">
        <Plane size={18} />
      </div>
      {next ? (
        <div className="min-w-0">
          <h3 className="font-bold text-foreground text-sm truncate">
            {next.event.title}
            {!next.event.title.includes(typeLabel[next.event.eventType] || '') && (
              <span className="ml-1.5 text-[10px] font-semibold text-indigo-500">
                {typeLabel[next.event.eventType] || '일정'}
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {next.ongoing ? '진행 중' : next.dDay === 0 ? 'D-Day' : `D-${next.dDay}`} ·{' '}
            {formatLocalDate(next.event.startDate)}
          </p>
        </div>
      ) : (
        <div>
          <h3 className="font-bold text-foreground text-sm">다음 휴가 · 만남</h3>
          <p className="text-xs text-muted-foreground">면회나 휴가 일정을 등록해보세요</p>
        </div>
      )}
    </button>
  );
};

// 10. 추억 다시보기 (memories)
const MemoriesWidget = () => {
  const { state, setHighlightedRecordId } = useStore();
  const navigate = useNavigate();
  const memory = useMemo(
    () => getMemory(state.records, state.profile.role),
    [state.records, state.profile.role],
  );

  if (!memory) {
    return (
      <div className={`${cardClass} min-h-[100px] flex flex-col justify-center`}>
        <h3 className="font-bold text-foreground text-sm mb-1">추억 다시보기 📸</h3>
        <EmptyHint text="기록이 쌓이면 과거의 오늘을 다시 보여드려요." />
      </div>
    );
  }

  const handleClick = () => {
    setHighlightedRecordId(memory.record.id);
    navigate(`/record?date=${memory.record.date}&record=${memory.record.id}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full text-left rounded-2xl border border-border shadow-sm overflow-hidden bg-card active:scale-[0.99] transition"
    >
      {memory.photoUrl ? (
        <div className="relative h-32 w-full">
          <img
            src={memory.photoUrl}
            alt={memory.label}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4">
            <h3 className="font-bold text-white text-sm drop-shadow">
              {memory.label} 📸
            </h3>
            {memory.record.log && (
              <p className="text-[11px] text-white/85 truncate">{memory.record.log}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-1">
          <div className="flex items-center gap-1.5">
            <ImageIcon size={14} className="text-coral" />
            <h3 className="font-bold text-foreground text-sm">{memory.label}</h3>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {memory.record.log || '그날 남긴 기록을 확인해보세요'}
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            {formatLocalDate(memory.record.date)} · 그날의 기록 {memory.totalCount}개
          </p>
        </div>
      )}
    </button>
  );
};

// 11. 오늘의 컨디션 (today_condition)
const TodayConditionWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const condition = useMemo(
    () => computeTodayCondition(state.records, state.profile.role),
    [state.records, state.profile.role],
  );

  return (
    <button
      type="button"
      onClick={() => navigate(`/record?date=${todayString()}`)}
      className={`${cardClass} w-full text-left flex items-center justify-between gap-3 active:scale-[0.99] transition`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Battery size={14} className="text-emerald-600" />
          <h3 className="font-bold text-foreground text-sm">오늘의 컨디션</h3>
        </div>
        <p className="text-xs font-semibold text-foreground mt-1">{condition.label}</p>
        <p className="text-[11px] text-muted-foreground truncate">{condition.detail}</p>
      </div>
      <span className="text-2xl shrink-0">{condition.emoji}</span>
    </button>
  );
};

// 12. 나만의 메모 (my_memo) - 기기 안에만 저장
const MyMemoWidget = () => {
  const { state, setMyMemo } = useStore();
  const [draft, setDraft] = useState(state.myMemo || '');

  // 다른 화면에서 상태가 바뀐 경우 동기화
  useEffect(() => {
    setDraft(state.myMemo || '');
  }, [state.myMemo]);

  // 입력이 멈춘 뒤 저장 (localStorage 쓰기 최소화)
  useEffect(() => {
    if (draft === (state.myMemo || '')) return;
    const timer = setTimeout(() => setMyMemo(draft), 400);
    return () => clearTimeout(timer);
  }, [draft, state.myMemo, setMyMemo]);

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-2xl border border-amber-200/70 dark:border-amber-900/50 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-1.5">
          <Notebook size={14} /> 메모장
        </h3>
        <span className="text-[10px] font-semibold text-amber-700/70 dark:text-amber-300/70">
          🔒 이 기기에만 저장
        </span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="간단한 메모를 남겨보세요."
        rows={3}
        maxLength={500}
        aria-label="나만의 메모"
        className="w-full bg-transparent text-xs text-amber-900 dark:text-amber-100 placeholder:text-amber-600/60 outline-none resize-none leading-relaxed"
      />
      <div className="text-right text-[10px] text-amber-700/60 dark:text-amber-300/60">
        {draft.length}/500
      </div>
    </div>
  );
};

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
    description: '오늘 공유된 기록 개수와 핵심 한 줄을 확인하세요.',
    component: TodayBriefingWidget,
  },
  today_word: {
    id: 'today_word',
    label: '오늘의 한마디',
    description: '서로에게 남기는 짧은 한마디 기록',
    component: TodayLogWidget,
  },
  record_shortcut: {
    id: 'record_shortcut',
    label: '기록 바로가기',
    description: '기록 화면으로 바로 이동하는 단축 버튼',
    component: RecordShortcutWidget,
  },
  dday: {
    id: 'dday',
    label: '우리의 디데이',
    description: '연결 일수와 다음 기념일, 복무 현황 바로가기',
    component: DDayWidget,
  },
  service_progress: {
    id: 'service_progress',
    label: '복무 진행률',
    description: '입대일 기준 복무율과 전역까지 남은 일수',
    component: ServiceProgressWidget,
  },
  upcoming_schedule: {
    id: 'upcoming_schedule',
    label: '다가오는 일정',
    description: '등록한 공유 일정을 가까운 순서로 보기',
    component: UpcomingScheduleWidget,
  },
  contact_window: {
    id: 'contact_window',
    label: '연락 가능 시간',
    description: '오늘 통화가 가능한 시간대를 확인해요',
    component: ContactWindowWidget,
  },
  next_anniversary: {
    id: 'next_anniversary',
    label: '다음 기념일',
    description: '100일 · 주년 등 다가오는 기념일 카운트다운',
    component: NextAnniversaryWidget,
  },
  next_vacation: {
    id: 'next_vacation',
    label: '다음 휴가/만남',
    description: '등록된 면회 · 휴가 · 여행까지 남은 날',
    component: NextMeetupWidget,
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
    description: '오늘 내가 남긴 기록에서 요약한 컨디션',
    component: TodayConditionWidget,
  },
  my_memo: {
    id: 'my_memo',
    label: '나만의 메모',
    description: '기기 안에만 저장되는 개인 메모장',
    component: MyMemoWidget,
  },
};
