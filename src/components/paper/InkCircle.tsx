import type { ReactNode } from 'react';

/**
 * 손으로 그린 원 — 스토리 링과 아바타.
 *
 * 인스타의 스토리 링이 갖는 **자리와 크기**를 그대로 쓴다. 바뀌는 것은 그것이 무엇으로
 * 그려졌는가뿐이다: 그라디언트 대신 펜으로 그은 원.
 *
 * 완벽한 원은 인쇄된 도형으로 읽힌다. 시작점과 끝점이 살짝 어긋난 원이 사람이 그은 선으로
 * 읽히므로 호를 두 조각으로 나눠 끝을 조금 벌린다. 어긋남은 고정값이라 렌더마다 흔들리지
 * 않는다 -- 난수로 주면 스크롤할 때마다 링이 다시 그려져 화면이 떨린다.
 */
export function InkCircle({
  size = 64,
  ring = 'none',
  children,
}: {
  size?: number;
  /** `new` 아직 안 본 것(잉크) · `seen` 본 것(연필) · `none` 링 없음 */
  ring?: 'new' | 'seen' | 'none';
  children?: ReactNode;
}) {
  const r = size / 2 - 2;
  const stroke = ring === 'new' ? 'var(--ink-accent)' : 'var(--ink-faint)';
  return (
    <span
      className="relative inline-flex items-center justify-center"
      /*
        링의 상태를 **읽을 수 있게** 내놓는다.

        `new` 와 `seen` 의 차이는 획의 색과 굵기뿐이라 밖에서는 픽셀을 재는 수밖에
        없었다. 링이 곰신·군화의 1차 행동을 가리키는 유일한 신호이므로, 그 신호가
        테스트에서 보이지 않으면 조용히 꺼져도 아무도 모른다.
      */
      data-ring={ring}
      style={{ width: size, height: size }}
    >
      {ring !== 'none' ? (
        <svg
          className="absolute inset-0"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          <path
            d={`M ${size / 2} ${size / 2 - r}
                A ${r} ${r} 0 1 1 ${size / 2 - 0.7} ${size / 2 - r}
                A ${r * 1.02} ${r * 0.98} 0 0 1 ${size / 2 + 1.6} ${size / 2 - r + 1}`}
            fill="none"
            stroke={stroke}
            strokeWidth={ring === 'new' ? 2.4 : 1.4}
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      <span
        className="flex items-center justify-center overflow-hidden rounded-full"
        style={{
          width: size - (ring === 'none' ? 0 : 11),
          height: size - (ring === 'none' ? 0 : 11),
          background: 'var(--paper)',
          border: 'var(--stroke-thin) solid var(--ink-faint)',
        }}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * 손으로 그린 얼굴 — 아바타 자리의 기본값.
 *
 * 사진을 올리지 않은 사람에게 회색 실루엣을 주면 그 자리가 "비어 있음"으로 읽힌다. 펜으로
 * 그린 얼굴은 채워진 자리로 읽히고, 이 앱의 나머지와 같은 손으로 그려졌다.
 *
 * `tone` 은 두 사람을 구별하기 위한 머리 모양 차이일 뿐 역할이나 성별을 뜻하지 않는다.
 */
export function PenFace({ size = 40, tone = 'a' }: { size?: number; tone?: 'a' | 'b' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" fill="none">
      <circle cx="20" cy="17" r="9" stroke="var(--ink)" strokeWidth="var(--stroke)" />
      {tone === 'a' ? (
        <path d="M11 14 Q20 4 29 14" stroke="var(--ink)" strokeWidth="var(--stroke)" strokeLinecap="round" />
      ) : (
        <path d="M11 15 Q20 6 29 15 L29 16 L11 16 Z" stroke="var(--ink)" strokeWidth="var(--stroke)" strokeLinejoin="round" />
      )}
      <circle cx="17" cy="17" r="0.9" fill="var(--ink)" />
      <circle cx="23" cy="17" r="0.9" fill="var(--ink)" />
      <path d="M17.5 21 Q20 23 22.5 21" stroke="var(--ink)" strokeWidth="var(--stroke-thin)" strokeLinecap="round" />
      <path d="M8 38 Q20 27 32 38" stroke="var(--ink)" strokeWidth="var(--stroke)" strokeLinecap="round" />
    </svg>
  );
}
