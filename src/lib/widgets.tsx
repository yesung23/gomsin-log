import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/lib/store';
import { TodayLogWidget } from '@/components/widgets/TodayLogWidget';
import { DDayWidget } from '@/components/widgets/DDayWidget';
import { UpcomingScheduleWidget } from '@/components/widgets/UpcomingScheduleWidget';
import { generateDailySummary, generateEmotionFlowBriefing } from '@/lib/briefing';
import { localToday, toLocalDateString, formatLocalDate } from '@/lib/utils';
import {
  computeServiceProgress,
  nextAnniversaryMilestone,
  nextUpcomingEvent,
  findMemories,
} from '@/lib/milestones';
import { isOwnRecord } from '@/lib/privacy';
import { PenLine, PartyPopper, Plane, Images, Smile } from 'lucide-react';

/**
 * Every widget here renders data derived from the user's actual records,
 * profile and events. Earlier revisions shipped hardcoded values (a 45%
 * service bar, a fixed barracks menu, "1주년 D-45", "첫 휴가 D-12") that looked
 * like live data. Where no real data source exists the widget now shows an
 * explicit empty state instead.
 */

/** Shared empty-state body so every widget is visually consistent. */
const WidgetEmpty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-muted-foreground leading-relaxed break-keep">{children}</p>
);

const WidgetCard = ({
  title,
  icon,
  children,
  onClick,
  ariaLabel,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
}) => {
  const content = (
    <>
      <h3 className="font-bold text-foreground mb-2 text-sm flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel || title}
        className="w-full text-left bg-card p-4 rounded-2xl border border-border shadow-sm active:scale-[0.99] transition"
      >
        {content}
      </button>
    );
  }
  return <div className="bg-card p-4 rounded-2xl border border-border shadow-sm">{content}</div>;
};

// 1. 오늘의 브리핑 -- summarises what actually happened today.
const TodayBriefingWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const { profile, records } = state;
  const viewer = { userId: profile.id, role: profile.role };
  const partnerName = profile.couple.partnerName || '상대방';
  const todayStr = toLocalDateString(localToday());

  const todayRecords = records.filter((record) => record.date === todayStr);
  const partnerShared = todayRecords.filter(
    (record) => !isOwnRecord(record, viewer) && !record.isPrivate,
  );
  const mine = todayRecords.filter((record) => isOwnRecord(record, viewer));

  const emotionBriefing = generateEmotionFlowBriefing(partnerShared);
  const summary = generateDailySummary(partnerShared, partnerName);

  return (
    <WidgetCard title="오늘의 브리핑" onClick={() => navigate('/record')}>
      {partnerShared.length > 0 ? (
        <p className="text-xs text-muted-foreground font-medium leading-relaxed break-keep">
          {emotionBriefing?.flowText ||
            summary.opener?.text ||
            summary.items[0]?.text ||
            `${partnerName}이 오늘 ${partnerShared.length}개의 순간을 공유했어요.`}
        </p>
      ) : (
        <WidgetEmpty>
          {mine.length > 0
            ? `오늘 ${mine.length}개를 남겼어요. ${partnerName}의 기록은 아직 없어요.`
            : `아직 오늘의 기록이 없어요. 첫 순간을 남겨보세요.`}
        </WidgetEmpty>
      )}
    </WidgetCard>
  );
};

// 3. 기록 바로가기 -- was a styled div with no click handler at all.
const RecordShortcutWidget = () => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('/record')}
      className="w-full bg-coral/10 p-4 rounded-2xl border border-coral/20 flex flex-col items-center justify-center min-h-[100px] gap-1.5 active:scale-[0.99] transition"
    >
      <PenLine size={20} className="text-coral" />
      <span className="text-coral font-bold text-sm">기록 모아보기</span>
    </button>
  );
};

// 5. 복무 진행률 -- computed from the enlistment/discharge dates.
const ServiceProgressWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const todayStr = toLocalDateString(localToday());
  const progress = computeServiceProgress(state.profile.military, todayStr);

  return (
    <WidgetCard title="복무 진행률" onClick={() => navigate('/service')}>
      {progress ? (
        <>
          <div className="w-full bg-muted h-3 rounded-full overflow-hidden">
            <div
              className="bg-success h-full rounded-full transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {progress.elapsedDays}일 / {progress.totalDays}일
            </span>
            <span className="font-bold">
              {progress.isDischarged ? '전역했어요 🎉' : `${progress.percent}% 진행`}
            </span>
          </div>
        </>
      ) : (
        <WidgetEmpty>입대일과 전역일을 입력하면 진행률을 보여드려요.</WidgetEmpty>
      )}
    </WidgetCard>
  );
};

// 8. 다음 기념일 -- computed from the couple's anniversary date.
const NextAnniversaryWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const todayStr = toLocalDateString(localToday());
  const milestone = nextAnniversaryMilestone(state.profile.couple.anniversaryDate, todayStr);

  return (
    <WidgetCard
      title="다음 기념일"
      icon={<PartyPopper size={14} className="text-coral" />}
      onClick={() => navigate('/settings')}
    >
      {milestone ? (
        <div className="flex items-baseline gap-2">
          <span className="text-base font-extrabold text-foreground">{milestone.label}</span>
          <span className="text-xs font-bold text-coral">D-{milestone.daysRemaining}</span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {formatLocalDate(milestone.date)}
          </span>
        </div>
      ) : (
        <WidgetEmpty>사귄 날짜를 입력하면 다음 기념일을 세어드려요.</WidgetEmpty>
      )}
    </WidgetCard>
  );
};

// 9. 다음 휴가/만남 -- reads the couple's real events.
const NextVacationWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const todayStr = toLocalDateString(localToday());
  const event = nextUpcomingEvent(state.events, todayStr, ['vacation', 'visit']);
  const daysRemaining = event
    ? Math.max(0, Math.round((new Date(`${event.startDate}T00:00:00`).getTime() - new Date(`${todayStr}T00:00:00`).getTime()) / 86_400_000))
    : 0;

  return (
    <WidgetCard
      title="다음 휴가·면회"
      icon={<Plane size={14} className="text-info" />}
      onClick={() => navigate('/schedule')}
    >
      {event ? (
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-extrabold text-foreground truncate">{event.title}</span>
          <span className="text-xs font-bold text-info shrink-0">
            {daysRemaining === 0 ? '오늘' : `D-${daysRemaining}`}
          </span>
          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
            {formatLocalDate(event.startDate)}
          </span>
        </div>
      ) : (
        <WidgetEmpty>등록된 휴가나 면회 일정이 없어요. 일정을 추가해 보세요.</WidgetEmpty>
      )}
    </WidgetCard>
  );
};

// 10. 추억 다시보기 -- shows a record from the same day in a past year.
const MemoriesWidget = () => {
  const { state, setHighlightedRecordId } = useStore();
  const navigate = useNavigate();
  const { profile, records } = state;
  const viewer = { userId: profile.id, role: profile.role };
  const todayStr = toLocalDateString(localToday());

  const visible = records.filter((record) => isOwnRecord(record, viewer) || !record.isPrivate);
  const memory = findMemories(visible, todayStr);
  const first = memory?.records[0];

  return (
    <WidgetCard
      title={memory ? `${memory.label} 📸` : '추억 다시보기'}
      icon={!memory ? <Images size={14} className="text-muted-foreground" /> : undefined}
      onClick={
        first
          ? () => {
              setHighlightedRecordId(first.id);
              navigate('/record');
            }
          : undefined
      }
    >
      {first ? (
        <p className="text-xs text-muted-foreground leading-relaxed break-keep line-clamp-2">
          {first.log?.trim() || '사진으로 남긴 기록이 있어요.'}
        </p>
      ) : (
        <WidgetEmpty>기록이 쌓이면 작년 오늘의 순간을 다시 보여드려요.</WidgetEmpty>
      )}
    </WidgetCard>
  );
};

// 11. 오늘의 컨디션 -- reflects the reaction on today's own record.
const REACTION_FACES: Record<string, { emoji: string; label: string }> = {
  good: { emoji: '😊', label: '좋은 하루예요' },
  thought_of_you: { emoji: '🥰', label: '보고 싶은 하루' },
  event: { emoji: '🎉', label: '특별한 일이 있었어요' },
  hard: { emoji: '🥹', label: '조금 힘든 하루' },
};

const TodayConditionWidget = () => {
  const { state } = useStore();
  const navigate = useNavigate();
  const { profile, records } = state;
  const viewer = { userId: profile.id, role: profile.role };
  const todayStr = toLocalDateString(localToday());

  // The most recent reaction I recorded today.
  const mineToday = records
    .filter((record) => record.date === todayStr && isOwnRecord(record, viewer))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const latestReaction = [...mineToday].reverse().find((record) => !!record.reaction)?.reaction;
  const face = latestReaction ? REACTION_FACES[latestReaction] : undefined;

  return (
    <WidgetCard
      title="오늘의 컨디션"
      icon={<Smile size={14} className="text-coral" />}
      onClick={() => navigate('/home')}
    >
      {face ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">{face.label}</span>
          <span className="text-2xl">{face.emoji}</span>
        </div>
      ) : (
        <WidgetEmpty>오늘 기록에 기분을 함께 남기면 여기에 표시돼요.</WidgetEmpty>
      )}
    </WidgetCard>
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
    description: '오늘 상대방이 공유한 기록의 요약',
    component: TodayBriefingWidget,
  },
  today_word: {
    id: 'today_word',
    label: '오늘의 기록',
    description: '글·사진·영상·음성으로 오늘을 남기기',
    component: TodayLogWidget,
  },
  record_shortcut: {
    id: 'record_shortcut',
    label: '기록 모아보기',
    description: '지금까지 쌓인 기록을 달력으로 보기',
    component: RecordShortcutWidget,
  },
  dday: {
    id: 'dday',
    label: '전역 D-Day',
    description: '남은 복무일과 함께한 날 수',
    component: DDayWidget,
  },
  upcoming_schedule: {
    id: 'upcoming_schedule',
    label: '다가오는 일정',
    description: '가까운 일정을 첫 화면에서 확인',
    component: UpcomingScheduleWidget,
  },
  service_progress: {
    id: 'service_progress',
    label: '복무 진행률',
    description: '입대일과 전역일로 계산한 복무 진행률',
    component: ServiceProgressWidget,
  },
  next_anniversary: {
    id: 'next_anniversary',
    label: '다음 기념일',
    description: '100일·1주년 등 다가오는 기념일 카운트다운',
    component: NextAnniversaryWidget,
  },
  next_vacation: {
    id: 'next_vacation',
    label: '다음 휴가·면회',
    description: '등록한 휴가나 면회 일정까지 남은 날',
    component: NextVacationWidget,
  },
  memories: {
    id: 'memories',
    label: '추억 다시보기',
    description: '작년 오늘 남긴 기록 돌아보기',
    component: MemoriesWidget,
  },
  today_condition: {
    id: 'today_condition',
    label: '오늘의 컨디션',
    description: '오늘 기록에 남긴 기분 표시',
    component: TodayConditionWidget,
  },
  // Removed: `today_meal` rendered a fixed barracks menu ("제육볶음, 된장찌개, 김치")
  // with no data source behind it, and `my_memo` was a static card with no input
  // that duplicated the composer's "나만 보기" option. Existing layouts that
  // still reference these ids are filtered out by WidgetDashboard.
};
