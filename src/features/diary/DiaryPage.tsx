import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookHeart, Images, NotebookPen, CalendarDays, ShoppingBag, Sprout } from 'lucide-react';
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { useStore } from '@/lib/useStore';
import { buildDiaryMonths, type DiaryMonth } from './diaryMonths';
import { MonthSpread } from './MonthSpread';
import { MobileShell } from '@/components/MobileShell';

/**
 * 일기장 — 쌓인 것이 물건이 되는 곳.
 *
 * 가운데 칸인 이유는 이 앱이 **왜 기록을 쌓게 하는지**에 대한 답이 여기 있기 때문이다.
 * 하루하루 남기라고 하면서 그것이 무엇이 되는지 보여주지 않으면 기록은 숙제가 된다.
 *
 *     앱이 엮어 온다        한 달치 기록·사진이 지면이 된다      노동 -- 자동
 *     사용자가 꾸민다        스티커                             놀이 -- 선택
 *     한 권으로 만든다       Memory Product (BUSINESS §9.2)     1회 결제
 *
 * ## 노동과 놀이를 가른다
 *
 * §9.2가 파는 것을 "다시 모으고 **정리하지 않고** 하나의 기억으로 완성하는 경험"이라
 * 정의한다. 없애 주겠다고 한 것은 강제된 정리의 부담이지 재미가 아니다. 그래서 엮는 것은
 * 앱이 자동으로 하고, 꾸미는 것은 하고 싶은 사람만 한다. **꾸미지 않아도 책은 나온다** --
 * 꾸미기가 결제의 전제가 되는 순간 그것은 놀이가 아니라 관문이 된다.
 *
 * ## `우리`와 겹치지 않는 선 (§5.5)
 *
 *     우리      자동으로 쌓인다    하루 칸      본다
 *     일기장    내가 만든다        한 달 지면    만든다
 *
 * `우리`에는 손대지 않은 원본이 쌓이고 여기에는 손댄 것이 남는다. 이 선이 없으면 같은
 * 격자를 두 탭이 보여주게 되고, 그것은 §5.3이 `찾기` 탭을 없앤 것과 같은 결함이다.
 */

function DiaryPageBody() {
  const navigate = useNavigate();
  const { state } = useStore();
  const { profile } = state;
  const [openKey, setOpenKey] = useState<string | null>(null);

  const records = useMemo(
    () => visibleRecordsForViewer(state.records, {
      userId: profile.id,
      role: profile.role,
    }),
    [state.records, profile.id, profile.role],
  );

  const months = useMemo(() => buildDiaryMonths(records), [records]);
  const open = useMemo(
    () => months.find((month) => month.key === openKey) ?? null,
    [months, openKey],
  );

  if (open) {
    return (
      <MonthSpread
        month={open}
        userId={state.authenticatedUser?.id || profile.id || ''}
        coupleId={profile.couple.coupleId}
        onClose={() => setOpenKey(null)}
      />
    );
  }

  return (
    <div className="min-h-full pb-24">
      <AppBar
        title="일기장"
        actions={(
          <>
            <AppBarAction
              aria-label="상점 열기"
              onClick={() => navigate('/shop')}
            >
              <ShoppingBag size={20} className="pen-icon" color="var(--ink)" aria-hidden="true" />
            </AppBarAction>
            <AppBarAction
              aria-label="우리 정원 열기"
              onClick={() => navigate('/diary/garden')}
            >
              <Sprout size={20} className="pen-icon" color="var(--ink)" aria-hidden="true" />
            </AppBarAction>
          </>
        )}
      />

      <div className="px-4 py-4 space-y-4">
        {months.length === 0 ? (
          <EmptyYet onCompose={() => navigate('/compose')} />
        ) : (
          months.map((month) => (
            <MonthCard key={month.key} month={month} onOpen={() => setOpenKey(month.key)} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * 아직 엮을 것이 없을 때.
 *
 * 며칠 남았는지 세어 주지 않는다. 세는 순간 그것은 카운트다운이 되고, §16이 연속 기록을
 * 금지하는 것과 같은 이유로 남기지 않은 날이 결핍이 된다.
 */
function EmptyYet({ onCompose }: { onCompose: () => void }) {
  return (
    <div className="rounded-surface border border-border bg-card p-6 text-center">
      <BookHeart size={28} className="mx-auto text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-body text-card-foreground">아직 엮을 것이 없어요.</p>
      <Button variant="primary" size="md" onClick={onCompose} className="mt-4">
        <NotebookPen size={16} aria-hidden="true" />
        첫 기록 남기기
      </Button>
    </div>
  );
}

/**
 * 한 달 지면 하나.
 *
 * 숫자를 먼저 보여준다 -- 기록 몇 개, 사진 몇 장, 남긴 날 며칠. 이 화면이 파는 것이
 * "쌓인 시간"이므로 얼마나 쌓였는지가 곧 설명이다. 앱이 만든 홍보 문구보다 정확하다.
 */
function MonthCard({ month, onOpen }: { month: DiaryMonth; onOpen: () => void }) {
  const latest = month.records[month.records.length - 1];
  const [, latestMonth, latestDay] = latest?.date.split('-') ?? [];
  const latestDateLabel = latestMonth && latestDay
    ? `${Number(latestMonth)}월 ${Number(latestDay)}일`
    : '';
  const firstLine = latest?.contentUnavailable
    ? '이 기기에서 아직 열 수 없는 기록이에요'
    : latest?.log.split('\n').map((line) => line.trim()).find(Boolean)
      ?? ((latest?.attachments?.length ?? 0) > 0 ? '사진으로 남긴 기록' : '짧게 남긴 기록');

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${month.label} 지면 열기`}
      className="press-response w-full rounded-surface border border-border bg-card p-4 text-left"
    >
      <h2 className="text-heading text-card-foreground">{month.label}</h2>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 text-label text-card-foreground">
          <NotebookPen size={14} className="text-muted-foreground" aria-hidden="true" />
          기록 {month.recordCount}개
        </span>
        <span className="flex items-center gap-1.5 text-label text-card-foreground">
          <Images size={14} className="text-muted-foreground" aria-hidden="true" />
          사진 {month.photoCount}장
        </span>
        <span className="flex items-center gap-1.5 text-label text-card-foreground">
          <CalendarDays size={14} className="text-muted-foreground" aria-hidden="true" />
          {month.dayCount}일
        </span>
      </div>

      {latest ? (
        <div className="mt-3 border-t border-border pt-3">
          {latestDateLabel ? (
            <p className="text-caption text-muted-foreground">{latestDateLabel}</p>
          ) : null}
          <p className="hand-text mt-1 line-clamp-2 break-keep text-body text-card-foreground">
            {firstLine}
          </p>
        </div>
      ) : null}
    </button>
  );
}

/**
 * 탭은 셸 안에 있어야 한다.

 * 셸이 하단 탭바와 스킵 링크와 라우트 안내를 갖는다. 이것 없이 렌더하면 그 탭에 들어간
 * 사람은 탭바가 없어 **빠져나올 수 없다** -- 뒤로 가기 말고는.
 */
export function DiaryPage() {
  return (
    <MobileShell>
      <DiaryPageBody />
    </MobileShell>
  );
}
