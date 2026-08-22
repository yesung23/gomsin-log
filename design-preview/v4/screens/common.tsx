import type { ReactNode } from 'react';

/**
 * 노트에 그린 인스타그램의 공통 조각.
 *
 * 인스타의 각 부분이 갖는 **높이와 자리**를 그대로 쓴다. 헤더 56px, 스토리 레일 106px,
 * 포스트 헤더 54px, 액션 줄 44px -- 이 숫자들이 인스타를 인스타로 보이게 하는 것이고,
 * 바뀌는 것은 그 안이 무엇으로 그려졌는가뿐이다.
 */

/** 손으로 그린 원. 스토리 링과 아바타에 쓴다. */
export function InkCircle({
  size = 64,
  ring = 'none',
  children,
}: {
  size?: number;
  /** `new` 잉크 · `seen` 연필 · `none` 링 없음 */
  ring?: 'new' | 'seen' | 'none';
  children?: ReactNode;
}) {
  const r = size / 2 - 2;
  const stroke = ring === 'new' ? 'var(--accent)' : 'var(--ink-faint)';
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {ring !== 'none' ? (
        <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          {/*
            완벽한 원은 인쇄된 도형으로 읽힌다. 시작점과 끝점이 살짝 어긋난 원이 사람이
            그은 선으로 읽힌다. 어긋남은 고정값이라 렌더마다 흔들리지 않는다.
          */}
          <path
            d={`M ${size / 2} ${size / 2 - r}
                A ${r} ${r} 0 1 1 ${size / 2 - 0.7} ${size / 2 - r}
                A ${r * 1.02} ${r * 0.98} 0 0 1 ${size / 2 + 1.6} ${size / 2 - r + 1}`}
            fill="none" stroke={stroke} strokeWidth={ring === 'new' ? 2.4 : 1.4} strokeLinecap="round"
          />
        </svg>
      ) : null}
      <span
        className="flex items-center justify-center overflow-hidden rounded-full"
        style={{
          width: size - (ring === 'none' ? 0 : 11),
          height: size - (ring === 'none' ? 0 : 11),
          background: 'var(--paper)',
          border: '1.2px solid var(--ink-faint)',
        }}
      >
        {children}
      </span>
    </span>
  );
}

/** 손으로 그린 얼굴. 아바타 자리에 온다. */
export function PenFace({ size = 40, tone = 'a' }: { size?: number; tone?: 'a' | 'b' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" fill="none">
      <circle cx="20" cy="17" r="9" stroke="var(--ink)" strokeWidth="1.4" />
      {tone === 'a' ? (
        <path d="M11 14 Q20 4 29 14" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" />
      ) : (
        <path d="M11 15 Q20 6 29 15 L29 16 L11 16 Z" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" />
      )}
      <circle cx="17" cy="17" r="0.9" fill="var(--ink)" />
      <circle cx="23" cy="17" r="0.9" fill="var(--ink)" />
      <path d="M17.5 21 Q20 23 22.5 21" stroke="var(--ink)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8 38 Q20 27 32 38" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 사진이 올 자리. 프리뷰에는 실제 미디어가 없으므로 연필로 그린 틀이 온다. */
export function PhotoFrame({ ratio = '4 / 5', label }: { ratio?: string; label?: string }) {
  return (
    <div className="photo-frame flex w-full items-center justify-center" style={{ aspectRatio: ratio }}>
      <span className="print text-[11px] tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        {label ?? '사진'}
      </span>
    </div>
  );
}
