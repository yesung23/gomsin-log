import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sticker as StickerIcon, Check, BookHeart, Lock } from 'lucide-react';
import { STICKERS, loadPlacements, savePlacements, place, remove, PLACEMENT_LIMIT, type Placement } from './stickers';
import { StickerArt } from './StickerArt';
import type { DiaryMonth } from './diaryMonths';

/**
 * 한 달 지면 — 앱이 엮어 온 것 위에 사용자가 붙인다.
 *
 * ## 두 가지 상태뿐이다
 *
 *     읽기      지면을 읽는다. 스티커는 배경이고 눌리지 않는다.
 *     꾸미기    지면을 누르면 고른 스티커가 붙는다. 붙은 것을 누르면 뗀다.
 *
 * 편집 상태를 따로 두는 이유는 읽다가 실수로 붙는 것을 막기 위해서다. 다꾸는 붙이는
 * 재미지만, 읽으려고 열었는데 스크롤하다 스티커가 붙으면 그건 사고다.
 *
 * ## 붙인 자리는 지금 이 기기에만 남는다
 *
 * 커플이 공유하는 콘텐츠이므로 제대로 하려면 CSK 도메인의 테이블과 RLS가 필요하고 그것은
 * migration gate가 판정한다. 그때까지 이 기기에만 남기되 **화면이 그 사실을 직접
 * 말한다** -- 상대에게도 보이는 줄 알고 꾸몄는데 안 보이는 것은 이 제품이 만들면 안 되는
 * 종류의 놀람이다.
 */

/** 붙일 때 주는 기울기의 범위. 반듯한 스티커는 인쇄물처럼 보인다. */
const TILT = 14;

export function MonthSpread({
  month,
  userId,
  onClose,
}: {
  month: DiaryMonth;
  userId: string;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement | null>(null);
  const [decorating, setDecorating] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [placements, setPlacements] = useState<Placement[]>(() => loadPlacements(userId, month.key));

  /* 달을 바꿔 열면 그 달의 것을 읽는다. 안 하면 앞 달의 스티커가 이 지면에 남는다. */
  useEffect(() => {
    setPlacements(loadPlacements(userId, month.key));
  }, [userId, month.key]);

  const commit = useCallback((next: Placement[]) => {
    setPlacements(next);
    savePlacements(userId, month.key, next);
  }, [userId, month.key]);

  /*
    붙일 자리를 비율로 잡는다.

    픽셀로 저장하면 폰을 바꾸거나 화면을 돌릴 때 스티커가 지면 밖으로 나간다. 지면의
    실제 크기로 나눠 두면 어느 폭에서도 같은 자리에 있다.
  */
  const put = useCallback((x: number, y: number) => {
    if (!picked) return;
    /*
      기울기를 난수로 주지 않는다.

      `Math.random()` 이면 같은 지면이 열 때마다 달라 보이고, 무엇보다 붙이는 순간마다
      결과가 달라 되돌릴 수 없다. 붙은 개수에서 만들면 결정적이면서도 규칙적으로 보이지
      않는다.
    */
    const rotation = ((placements.length * 37) % (TILT * 2)) - TILT;
    const id = `${month.key}-${placements.length}-${Math.round(x * 1000)}-${Math.round(y * 1000)}`;
    commit(place(placements, picked, x, y, rotation, id));
  }, [commit, month.key, picked, placements]);

  const onSheetClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!decorating || !picked) return;
    const box = sheet.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    put((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  };

  /*
    포인터 없이도 꾸밀 수 있어야 한다.

    지면을 `<div onClick>` 으로만 두면 다꾸는 마우스나 손가락이 있는 사람만의 기능이
    된다. 지면에 버튼 계약(role · tab stop · 키 처리)을 주고, Enter 로 **가운데에**
    붙인다. 그 다음은 붙은 스티커가 받는다 -- 방향키로 옮기고 Enter 로 뗀다. 붙이고,
    옮기고, 떼는 세 동작이 전부 키보드로 닫힌다.
  */
  const onSheetKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!decorating || !picked) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    put(0.5, 0.5);
  };

  /** 방향키 한 번에 움직이는 거리. 지면 폭의 2%. */
  const NUDGE = 0.02;

  const onStickerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, target: Placement) => {
    const delta = {
      ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    commit(placements.map((placement) => (placement.id === target.id
      ? {
        ...placement,
        x: Math.min(1, Math.max(0, placement.x + delta[0])),
        y: Math.min(1, Math.max(0, placement.y + delta[1])),
      }
      : placement)));
  };

  const full = placements.length >= PLACEMENT_LIMIT;

  return (
    <div className="notebook flex min-h-full flex-col pb-24">
      <header className="flex h-14 shrink-0 items-center gap-1 px-3">
        <button
          type="button"
          aria-label="일기장으로 돌아가기"
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center"
        >
          <X size={22} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
        <span className="flex-1 text-heading" style={{ color: 'var(--ink)' }}>{month.label}</span>
        <button
          type="button"
          aria-pressed={decorating}
          onClick={() => { setDecorating(!decorating); setPicked(null); }}
          className="ink-chip flex min-h-11 items-center gap-1.5 px-3"
          style={decorating ? { background: 'var(--ink)', color: 'var(--paper)' } : { color: 'var(--ink)' }}
        >
          {decorating
            ? <Check size={15} className="pen-icon" aria-hidden="true" />
            : <StickerIcon size={15} className="pen-icon" aria-hidden="true" />}
          <span className="text-label">{decorating ? '다 붙였어요' : '꾸미기'}</span>
        </button>
      </header>

      {/*
        지면.

        스티커는 이 상자 안에 절대 위치로 얹힌다. 기록이 길어져 지면이 길어지면 스티커도
        같은 비율로 따라 내려간다 -- 화면이 아니라 **지면**을 기준으로 잡았기 때문이다.
      */}
      <div ref={sheet} className="relative mx-3 flex-1">
        {/*
          붙이는 층은 읽는 층과 **다른 요소**다.

          하나로 두면 읽는 동안에도 지면이 컨트롤이라 탭 순서에 이름 없는 버튼이 끼고,
          키보드 사용자는 기록을 읽으려다 매번 그것을 지나쳐야 한다. 스티커를 고른
          동안에만 이 층이 생긴다.

          아래 기록보다 위에 있어서 클릭을 받고, 붙은 스티커(z-20)보다는 아래라 스티커를
          눌러 떼는 것이 먼저 잡힌다.
        */}
        {decorating && picked ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="지면 · 누르면 고른 스티커가 가운데에 붙어요"
            onClick={onSheetClick}
            onKeyDown={onSheetKeyDown}
            className="absolute inset-0 z-10"
            style={{ cursor: 'copy' }}
          />
        ) : null}

        <ol className="relative z-0 space-y-4 py-2">
          {month.records.map((record) => {
            const [, , day] = record.date.split('-');
            return (
              <li key={record.id}>
                <div className="flex items-baseline gap-2">
                  <span className="text-label font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                    {Number(day)}일
                  </span>
                  <span className="text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>
                    {record.time}
                  </span>
                </div>
                {/*
                  열 수 없는 기록은 빈 줄이 아니다. "글을 안 썼다"와 "이 기기가 못 연다"가
                  같아 보이면, 기다리면 열릴 것을 사라진 줄 안다.
                */}
                {record.contentUnavailable ? (
                  <p className="mt-0.5 flex items-center gap-1.5 text-caption" style={{ color: 'var(--ink-soft)' }}>
                    <Lock size={12} className="pen-icon" aria-hidden="true" />
                    {record.contentUnavailable === 'key_unavailable'
                      ? '이 기기에서 아직 열 수 없어요'
                      : '이 기기의 열쇠로는 읽을 수 없어요'}
                  </p>
                ) : (
                  <p className="hand-text mt-0.5 whitespace-pre-wrap text-body" style={{ color: 'var(--ink)' }}>
                    {record.log}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        {placements.map((placement) => (
          <button
            key={placement.id}
            type="button"
            // 읽는 동안에는 눌리지 않는다. 스크롤하다 스티커가 떨어지면 그건 사고다.
            disabled={!decorating}
            aria-label={`${STICKERS.find((s) => s.id === placement.stickerId)?.label ?? '스티커'} · 방향키로 옮기고 누르면 떼요`}
            onClick={(event) => { event.stopPropagation(); commit(remove(placements, placement.id)); }}
            onKeyDown={(event) => onStickerKeyDown(event, placement)}
            className="absolute z-20 disabled:pointer-events-none"
            style={{
              left: `${placement.x * 100}%`,
              top: `${placement.y * 100}%`,
              transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)`,
            }}
          >
            <StickerArt id={placement.stickerId} size={34} />
          </button>
        ))}
      </div>

      {decorating ? (
        <div
          className="sticky bottom-0 shrink-0 space-y-2 px-3 pt-2"
          style={{
            background: 'var(--paper)',
            borderTop: 'var(--stroke) solid var(--ink-faint)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
          }}
        >
          <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="붙일 스티커">
            {STICKERS.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                role="radio"
                aria-checked={picked === sticker.id}
                aria-label={sticker.label}
                onClick={() => setPicked(picked === sticker.id ? null : sticker.id)}
                className="ink-chip flex h-12 w-12 shrink-0 items-center justify-center"
                style={picked === sticker.id ? { background: 'var(--ink)' } : undefined}
              >
                <StickerArt id={sticker.id} size={26} />
              </button>
            ))}
          </div>
          <p className="text-caption" style={{ color: 'var(--ink-soft)' }}>
            {full
              ? '이 지면은 더 붙일 자리가 없어요'
              : picked
                ? '지면을 누르면 붙어요 · 붙은 걸 누르면 떨어져요'
                : '스티커를 하나 고르세요'}
          </p>
        </div>
      ) : (
        <div className="mx-3 mt-4 space-y-2 border-t border-border pt-4">
          {/*
            §9.2 의 결제 버튼이 올 자리.

            `P-MP` 게이트 셋(구매자 정의, 미리보기의 상대 노출 범위, 연결 해제 후 접근)이
            열리기 전까지 여기 오는 것은 정직한 문장이다. 누를 수 있는 것을 두면 --
            `대기자 명단`이든 `곧 출시`든 -- 이 화면은 아직 존재하지 않는 것을 파는 화면이
            된다.
          */}
          <p className="flex items-center gap-1.5 text-label" style={{ color: 'var(--ink)' }}>
            <BookHeart size={15} className="pen-icon" aria-hidden="true" />
            한 권으로 만들기
          </p>
          <p className="text-caption leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            아직 준비 중이에요. 지금은 무엇이 담길지만 보여드려요.
          </p>
          {/*
            이 기기에만 남는다는 사실.

            상대에게도 보이는 줄 알고 꾸몄는데 안 보이는 것은 이 제품이 만들면 안 되는
            종류의 놀람이다. 나중에 동기화되면 이 줄이 사라진다.
          */}
          <p className="text-caption leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            붙인 스티커는 지금은 이 기기에만 남아요. 기록과 사진은 평소대로 함께 보여요.
          </p>
        </div>
      )}
    </div>
  );
}
