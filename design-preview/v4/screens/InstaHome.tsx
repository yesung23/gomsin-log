import { Heart, Phone, Plus, Bookmark, MoreHorizontal, Stamp as StampIcon } from 'lucide-react';
import { InkCircle, PenFace, PhotoFrame } from './common';
import { FIXTURE_RECORDS, TODAY } from '../fixtures';

/**
 * 홈 — 인스타그램 피드와 같은 자리, 같은 높이.
 *
 *     헤더 56px          로고 좌 · 알림/DM 우
 *     스토리 레일 106px  가로 원들
 *     포스트            작성자 54px → 사진 → 액션 44px → 캡션 → 시간
 *
 * 인스타와 다른 것은 셋뿐이다.
 *
 *   1. 링이 두 개다. N개면 스크롤이 생기고 스크롤이 있으면 정렬이 필요하고 정렬이
 *      있으면 알고리즘이 생긴다. 둘로 고정하면 그 사슬이 시작되지 않는다.
 *   2. 좋아요 수·댓글·공유가 없다. 세는 순간 경쟁이 되고, 대화의 출구는 앱 밖의 통화다.
 *   3. 알림 자리에 이야기거리가, DM 자리에 통화 모드가 온다. 이 앱에서 그 자리가 뜻하는
 *      것이 그것이다.
 */

/** 사진이 붙은 기록. 나머지는 글이 그 자리를 차지한다. */
const WITH_PHOTO = new Set(['p-2', 'm-2']);

const partnerToday = FIXTURE_RECORDS.filter((r) => r.userId === 'partner-fixture' && r.date === TODAY);
const feed = FIXTURE_RECORDS.filter((r) => r.date !== TODAY && !r.isPrivate).reverse();

function timeAgo(date: string, time: string): string {
  const days = Math.round((Date.parse(TODAY) - Date.parse(date)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return '어제';
  return `${days}일 전`;
}

export function InstaHome() {
  return (
    <div className="notebook min-h-full pb-6">
      {/* 헤더 — 인스타와 같은 56px */}
      <header className="flex h-14 items-center justify-between px-4">
        <span className="hand text-[22px] leading-none" style={{ color: 'var(--ink)' }}>
          곰신로그
        </span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="이야기할 것" className="tap relative flex h-11 w-11 items-center justify-center">
            <Bookmark size={22} className="pen-icon" color="var(--ink)" fill="none" />
            {/* 인스타의 빨간 점과 같은 자리. 개수를 적지 않는다 -- 개수는 부채다. */}
            <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
          </button>
          <button type="button" aria-label="통화 모드" className="tap flex h-11 w-11 items-center justify-center">
            <Phone size={21} className="pen-icon" color="var(--ink)" fill="none" />
          </button>
        </div>
      </header>

      {/* 스토리 레일 — 인스타와 같은 106px */}
      <section aria-label="스토리" className="flex h-[106px] items-start gap-5 px-4 pt-1">
        <button type="button" className="tap flex w-[72px] flex-col items-center gap-1.5">
          <InkCircle size={66} ring="new"><PenFace size={44} /></InkCircle>
          <span className="print text-[11px] leading-none" style={{ color: 'var(--ink)' }}>춘향</span>
        </button>

        <div className="relative">
          <button type="button" className="tap flex w-[72px] flex-col items-center gap-1.5">
            <InkCircle size={66} ring="seen"><PenFace size={44} tone="b" /></InkCircle>
            <span className="print text-[11px] leading-none" style={{ color: 'var(--ink-soft)' }}>내 스토리</span>
          </button>
          {/* 인스타의 `+` 배지와 같은 자리 */}
          <span
            className="absolute left-[46px] top-[42px] flex h-[22px] w-[22px] items-center justify-center rounded-full"
            style={{ background: 'var(--ink)', border: '2px solid var(--paper)' }}
          >
            <Plus size={13} color="var(--paper)" strokeWidth={2.6} />
          </span>
        </div>

        {/*
          링은 여기서 끝난다.

          인스타라면 여기부터 팔로우한 사람들이 이어진다. 이 앱에는 두 사람뿐이라
          그 자리가 비고, 비는 것이 맞다.
        */}
      </section>

      <div className="ink-rule mx-4" />

      {/* 포스트 */}
      {partnerToday.slice(0, 1).concat(feed).map((record, index) => {
        const mine = record.userId === 'me-fixture';
        return (
          <article key={record.id} className="pb-2">
            {/* 작성자 줄 — 인스타와 같은 54px */}
            <header className="flex h-[54px] items-center gap-2.5 px-4">
              <InkCircle size={34}><PenFace size={24} tone={mine ? 'b' : 'a'} /></InkCircle>
              <span className="print flex-1 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                {mine ? '몽룡' : '춘향'}
              </span>
              <button type="button" aria-label="더 보기" className="tap flex h-11 w-8 items-center justify-center">
                <MoreHorizontal size={18} className="pen-icon" color="var(--ink)" />
              </button>
            </header>

            {/*
              사진이 있으면 인스타처럼 전폭 4:5, 없으면 **글이 그 자리를 차지한다.**

              빈 사진 틀을 남기면 화면이 로딩 실패처럼 보이고, 그것이 2026-08-20에
              되돌린 피드가 겪은 밀도 실패다. 글이 주인공인 하루는 구멍이 아니다.
            */}
            <div className="px-4">
              {WITH_PHOTO.has(record.id) ? (
                <PhotoFrame ratio={index % 3 === 1 ? '1 / 1' : '4 / 5'} />
              ) : (
                <div
                  className="flex items-center px-5 py-7"
                  style={{
                    border: '1.5px solid var(--ink-faint)',
                    borderRadius: index % 2 ? '10px 3px 12px 3px / 3px 12px 3px 10px' : '3px 12px 3px 10px / 12px 3px 10px 3px',
                  }}
                >
                  <p className="hand text-[17px] whitespace-pre-wrap break-keep" style={{ color: 'var(--ink)' }}>
                    {record.log}
                  </p>
                </div>
              )}
            </div>

            {/* 액션 줄 — 인스타와 같은 44px. 좋아요 수는 없다. */}
            <div className="flex h-11 items-center gap-1 px-3">
              <button type="button" aria-label="공감" className="tap flex h-11 w-11 items-center justify-center">
                <Heart size={22} className="pen-icon" color="var(--ink)" fill="none" />
              </button>
              <button type="button" aria-label="토닥이기" className="tap flex h-11 w-11 items-center justify-center">
                <StampIcon size={21} className="pen-icon" color="var(--ink)" fill="none" />
              </button>
              <span className="flex-1" />
              <button type="button" aria-label="이따 이야기하기" className="tap flex h-11 w-11 items-center justify-center">
                <Bookmark size={21} className="pen-icon" color="var(--ink)" fill="none" />
              </button>
            </div>

            {/* 캡션과 시간. 글이 이미 위에 있으면 여기서 반복하지 않는다. */}
            <div className="space-y-1 px-4">
              {WITH_PHOTO.has(record.id) ? (
                <p className="hand text-[15px]" style={{ color: 'var(--ink)' }}>
                  <span className="print mr-1.5 text-[13px] font-semibold">{mine ? '몽룡' : '춘향'}</span>
                  {record.log}
                </p>
              ) : null}
              <p className="print text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                {timeAgo(record.date, record.time)}
              </p>
            </div>
          </article>
        );
      })}

      <p className="print px-4 pt-4 text-center text-[11px]" style={{ color: 'var(--ink-soft)' }}>
        여기까지가 지난 7일이에요
      </p>
    </div>
  );
}
