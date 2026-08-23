import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, MoreHorizontal, Phone, Plus } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { usePartnerDay } from '@/lib/usePartnerDay';
import { localToday } from '@/lib/cycle';
import { InkCircle, PenFace } from '@/components/paper';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import type { DailyRecord } from '@/types';

/**
 * 홈 — 노트에 그린 인스타그램.
 *
 *     헤더 56px        곰신로그 · 이야기할 것 · 통화
 *     스토리 레일 106px 내 스토리(+) · 상대
 *     ─────────────
 *     포스트           작성자 54px → 사진/글 → 액션 44px → 캡션 → 시간
 *
 * 이 숫자들이 인스타를 인스타로 보이게 한다. 글자 크기는 임의 픽셀이 아니라 앱의 타입
 * 스케일을 쓴다 -- 둘이 거의 겹치기 때문이다(22 title · 17 heading · 15 body · 13 label ·
 * 12 caption). 겹치지 않는 곳까지 픽셀로 박으면 이 화면만 다른 서체 체계를 갖게 된다. 바뀌는 것은 그 안이 **무엇으로 그려졌는가**
 * 뿐이다 -- 그라디언트 링 대신 펜으로 그은 원, 채운 카드 대신 손으로 그린 상자.
 *
 * ## 위젯 대시보드를 대신한다
 *
 * 앞선 홈은 끌어 옮기는 위젯 목록이었다. 종이를 뒤에 깔아도 그것은 위젯 대시보드였고,
 * "노트에 그린 인스타그램"이 아니었다. 인스타의 홈에는 배치할 것이 없다 -- 레일과
 * 피드가 있을 뿐이다.
 *
 * ## 인스타에서 가져오지 않은 것
 *
 * 좋아요 **수**, 조회 수, 본 사람 목록, 팔로워. §16이 금지한다. 액션은 있고 숫자가
 * 없다 -- 반응은 전하되 세지 않는다. 헤더의 점도 개수를 적지 않는다: 개수는 부채다.
 *
 * ## 피드가 담는 구간
 *
 * §6.1 -- 아직 확인하지 않은 것은 **스토리**가, 확인했고 오늘이 아닌 것은 이 지면이,
 * 지난 달은 `우리` 가 갖는다. 같은 기록이 두 자리에 동시에 있지 않는다.
 */

/** 지면이 담는 구간. 그 앞은 `우리` 의 격자가 갖는다. */
const FEED_DAYS = 7;

function timeAgo(record: DailyRecord, todayStr: string): string {
  if (record.date === todayStr) return `오늘 ${record.time}`;
  const days = Math.round(
    (Date.parse(`${todayStr}T00:00:00`) - Date.parse(`${record.date}T00:00:00`)) / 86400000,
  );
  if (days === 1) return `어제 ${record.time}`;
  if (days < 7) return `${days}일 전`;
  const [, month, day] = record.date.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

export function PaperHome() {
  const navigate = useNavigate();
  const { state, markTalkAbout, unmarkTalkAbout } = useStore();
  const { profile, talkAboutMarks } = state;
  const todayStr = localToday();

  const partnerDay = usePartnerDay();

  const records = useMemo(
    () => visibleRecordsForViewer(state.records, {
      userId: profile.id,
      role: profile.role,
    }),
    [state.records, profile.id, profile.role],
  );

  /*
    지면에 오는 것.

    스토리가 가진 것 -- 상대의 아직 확인하지 않은 구간 -- 은 빼고, 최근 7일만 남긴다.
    경계가 날짜가 아니라 **확인 여부**인 이유는 §6.1의 놓친 구간이 어제·그제까지 뻗을 수
    있기 때문이다. 날짜로 자르면 겹친다.
  */
  const inStory = useMemo(
    () => new Set(partnerDay.surface.map((record) => record.id)),
    [partnerDay.surface],
  );

  const feed = useMemo(() => {
    const from = new Date(`${todayStr}T00:00:00`);
    from.setDate(from.getDate() - (FEED_DAYS - 1));
    const fromStr = from.toISOString().slice(0, 10);
    return records
      .filter((record) => record.date >= fromStr && !inStory.has(record.id))
      .sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));
  }, [records, inStory, todayStr]);

  const markedIds = useMemo(
    () => new Set((talkAboutMarks ?? []).map((mark) => mark.recordId)),
    [talkAboutMarks],
  );

  const partnerName = profile.couple.partnerName || '상대';
  const hasUnseen = partnerDay.surface.length > 0;
  const hasMarks = (talkAboutMarks?.length ?? 0) > 0;

  return (
    /*
      `home-core` -- 홈이 실제로 그려졌다는 표식.

      V4 이전에는 `RoleHome` 의 역할별 코어 표면이 이 이름을 달았고, e2e 의 홈 스크린샷이
      그것을 기다렸다. 홈이 피드가 되면서 그 노드는 사라졌지만 **표식이 지키는 것**은
      바뀌지 않았다: 스플래시도 온보딩도 아닌 홈이 떴는가. 그래서 이름을 지우지 않고
      새 홈의 뿌리로 옮긴다.
    */
    <div className="min-h-full pb-6" data-testid="home-core">
      <header
        className="flex h-14 items-center justify-between px-4"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)', background: 'var(--paper)' }}
      >
        {/*
          로고 자리. 이 앱의 이름은 손글씨다 -- 인스타의 로고가 그 앱의 손글씨인 것과
          같은 자리이고, 사람이 쓴 글은 아니지만 **간판**이라 인쇄체로 두면 서식이 된다.
        */}
        <span className="hand-text text-title leading-none" style={{ color: 'var(--ink)' }}>
          곰신로그
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="이야기할 것"
            onClick={() => navigate('/saved')}
            className="relative flex h-11 w-11 items-center justify-center"
          >
            <Bookmark size={22} className="pen-icon" color="var(--ink)" fill="none" aria-hidden="true" />
            {/* 인스타의 빨간 점과 같은 자리. 개수를 적지 않는다 -- 개수는 부채다. */}
            {hasMarks ? (
              <span
                aria-hidden="true"
                className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full"
                style={{ background: 'var(--ink-accent)' }}
              />
            ) : null}
          </button>
          <button
            type="button"
            aria-label="통화 모드"
            onClick={() => navigate('/call')}
            className="flex h-11 w-11 items-center justify-center"
          >
            <Phone size={21} className="pen-icon" color="var(--ink)" fill="none" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="px-4">
        <CoupleStatusBanner />
      </div>

      {/*
        스토리 레일 — 인스타와 같은 106px, 같은 순서.

        **내 스토리가 맨 왼쪽이다.** 인스타에서 왼쪽 끝은 언제나 자기 자신이고 `+` 배지가
        거기 붙는다. 손이 기억하는 자리를 바꾸면 인스타 문법을 빌려 온 이유가 사라진다.

        링은 둘에서 끝난다. 인스타라면 여기부터 팔로우한 사람들이 이어지지만 이 앱에는
        두 사람뿐이라 그 자리가 비고, **비는 것이 맞다**(§5.2: 링은 정확히 두 개다).
      */}
      <section aria-label="스토리" className="flex h-[106px] items-start gap-5 px-4 pt-1">
        <div className="relative">
          <button
            type="button"
            onClick={() => navigate('/story/mine')}
            className="flex w-[72px] flex-col items-center gap-1.5"
          >
            <InkCircle size={66} ring="seen"><PenFace size={44} tone="b" /></InkCircle>
            <span className="text-caption leading-none" style={{ color: 'var(--ink-soft)' }}>내 스토리</span>
          </button>
          <button
            type="button"
            aria-label="기록 남기기"
            onClick={() => navigate('/compose')}
            /*
              눈에 보이는 것은 22px 이지만 **누르는 곳은 46px** 이다.

              인스타의 `+` 배지도 이만큼 작게 그려진다 -- 작게 보이는 것이 이 배지의
              일이다. 하지만 그리는 크기와 닿는 크기는 다른 값이어야 한다(DESIGN_V2
              §Visual footprint ≠ hit target). 이 배지는 곰신의 1차 행동으로 가는
              문이므로, 22px 그대로 두면 앱에서 가장 중요한 동작이 가장 놓치기 쉬운
              표적이 된다.
            */
            className="absolute left-[46px] top-[42px] flex h-[22px] w-[22px] items-center justify-center rounded-full before:absolute before:-inset-3 before:content-['']"
            style={{ background: 'var(--ink)', border: '2px solid var(--paper)' }}
          >
            <Plus size={13} color="var(--paper)" strokeWidth={2.6} aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate('/story/partner')}
          aria-label={`${partnerName}의 스토리`}
          className="flex w-[72px] flex-col items-center gap-1.5"
        >
          {/*
            링의 상태가 유일하게 말하는 것: 아직 안 본 것이 있는가.

            열람 시각도, 본 사람 목록도, 읽음 표시도 아니다(§16). 링은 **내 쪽의 사실**만
            말한다 -- 상대는 내가 봤는지 알 수 없다.
          */}
          <InkCircle size={66} ring={hasUnseen ? 'new' : 'seen'}><PenFace size={44} /></InkCircle>
          <span
            className="max-w-[72px] truncate text-caption leading-none"
            style={{ color: hasUnseen ? 'var(--ink)' : 'var(--ink-soft)' }}
          >
            {partnerName}
          </span>
        </button>
      </section>

      <div className="ink-rule mx-4" aria-hidden="true" />

      {feed.length === 0 ? (
        <p className="px-8 pt-12 text-center text-label leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          지난 이레는 조용했어요.
          <br />
          오늘 있었던 일을 하나 남기면 여기 쌓여요.
        </p>
      ) : (
        feed.map((record, index) => (
          <Post
            key={record.id}
            record={record}
            index={index}
            mine={record.userId === profile.id}
            myName={profile.myName || '나'}
            partnerName={partnerName}
            todayStr={todayStr}
            onOpen={() => navigate(`/record?record=${encodeURIComponent(record.id)}`)}
            marked={markedIds.has(record.id)}
            onToggleTalkAbout={() => {
              if (markedIds.has(record.id)) void unmarkTalkAbout(record.id);
              else void markTalkAbout(record.id);
            }}
          />
        ))
      )}

      {feed.length > 0 ? (
        <p className="px-4 pt-4 text-center text-caption" style={{ color: 'var(--ink-soft)' }}>
          여기까지가 지난 {FEED_DAYS}일이에요
        </p>
      ) : null}
    </div>
  );
}

function Post({
  record,
  index,
  mine,
  myName,
  partnerName,
  todayStr,
  onOpen,
  marked,
  onToggleTalkAbout,
}: {
  record: DailyRecord;
  index: number;
  mine: boolean;
  myName: string;
  partnerName: string;
  todayStr: string;
  onOpen: () => void;
  marked: boolean;
  onToggleTalkAbout: () => void;
}) {
  const author = mine ? myName : partnerName;
  const hasMedia = (record.attachments?.length ?? 0) > 0;

  return (
    <article className="pb-2">
      {/* 작성자 줄 — 인스타와 같은 54px */}
      <header className="flex h-[54px] items-center gap-2.5 px-4">
        <InkCircle size={34}><PenFace size={24} tone={mine ? 'b' : 'a'} /></InkCircle>
        <span className="flex-1 truncate text-label font-semibold" style={{ color: 'var(--ink)' }}>
          {author}
        </span>
        <button
          type="button"
          aria-label={`${author}의 기록 열기`}
          onClick={onOpen}
          className="flex h-11 w-8 items-center justify-center"
        >
          <MoreHorizontal size={18} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
      </header>

      {/*
        사진이 있으면 인스타처럼 전폭, 없으면 **글이 그 자리를 차지한다.**

        빈 사진 틀을 남기면 화면이 로딩 실패처럼 보인다. 글이 주인공인 하루는 구멍이 아니다.
      */}
      <div className="px-4">
        {hasMedia ? (
          <RecordMediaGallery attachments={record.attachments ?? []} recordId={record.id} />
        ) : record.contentUnavailable ? (
          <div
            className="flex items-center px-5 py-6"
            style={{ border: 'var(--stroke) solid var(--ink-faint)', borderRadius: '10px 3px 12px 3px / 3px 12px 3px 10px' }}
          >
            <p className="text-label" style={{ color: 'var(--ink-soft)' }}>
              {record.contentUnavailable === 'key_unavailable'
                ? '이 기기에서 아직 이 기록을 열 수 없어요. 기기 연결이 끝나면 보여요.'
                : '이 기록을 열 수 없어요. 내용은 그대로 있지만 이 기기의 열쇠로는 읽을 수 없어요.'}
            </p>
          </div>
        ) : (
          <div
            className="flex items-center px-5 py-6"
            style={{
              border: 'var(--stroke) solid var(--ink-faint)',
              borderRadius: index % 2
                ? '10px 3px 12px 3px / 3px 12px 3px 10px'
                : '3px 12px 3px 10px / 12px 3px 10px 3px',
            }}
          >
            <p
              className="hand-text whitespace-pre-wrap break-keep text-heading"
              style={{ color: 'var(--ink)' }}
            >
              {record.log}
            </p>
          </div>
        )}
      </div>

      {/*
        액션 줄 — 인스타와 같은 44px. **숫자가 없다.**

        좋아요 수·조회 수·본 사람은 §16의 비목표다. 세는 순간 두 사람 사이에 점수가
        생기고, 이 제품은 관계에 점수를 매기지 않는다.

        ## 공감·토닥이기가 아직 없는 이유

        상대의 기록에 남기는 반응은 **데이터 모델에 없다.** `record.reaction` 은 작성자가
        자기 기록에 다는 표식이지 보는 사람의 반응이 아니고, 보는 사람의 반응을 만들려면
        테이블과 RLS가 필요해 migration gate 가 판정한다.

        그래서 그 자리에 눌리는 버튼을 두지 않았다. 눌러도 아무 일이 없는 하트는 **보낸
        줄 아는 사람에게 거짓말**이고, 이 제품에서 그것은 상대가 내 반응을 봤을 것이라고
        믿게 만드는 종류의 거짓말이다. 자리는 비워 두고 되는 것만 답한다.
      */}
      <div className="flex h-11 items-center gap-1 px-3">
        <span className="flex-1" />
        <button
          type="button"
          aria-label={marked ? '이따 이야기하기 취소' : '이따 이야기하기'}
          aria-pressed={marked}
          onClick={onToggleTalkAbout}
          className="flex h-11 w-11 items-center justify-center"
        >
          <Bookmark
            size={21}
            className="pen-icon"
            color="var(--ink)"
            fill={marked ? 'var(--ink)' : 'none'}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* 캡션과 시간. 글이 이미 위에 있으면 여기서 반복하지 않는다. */}
      <div className="space-y-1 px-4">
        {hasMedia && record.log ? (
          <p className="hand-text text-body" style={{ color: 'var(--ink)' }}>
            <span className="mr-1.5 text-label font-semibold">{author}</span>
            {record.log}
          </p>
        ) : null}
        <p className="text-caption" style={{ color: 'var(--ink-soft)' }}>
          {timeAgo(record, todayStr)}
        </p>
      </div>
    </article>
  );
}
