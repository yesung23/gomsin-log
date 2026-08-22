/**
 * 스티커 그림 — 전부 인라인 SVG.
 *
 * 이미지 파일로 두면 지면마다 열두 개의 요청이 생기고, 오프라인에서 지면이 반쯤 빈 채로
 * 그려진다. CSP의 `img-src`도 건드리지 않는다.
 *
 * 손으로 그린 느낌은 `paper.css`의 `.pen-icon`이 아니라 여기서 직접 만든다 -- 스티커는
 * 아이콘이 아니라 붙이는 물건이라 채워진 면이 있어야 한다. 획 하나로 그린 아이콘과 달리
 * 색이 있는 것이 지면 위에서 스티커로 읽힌다.
 */

/** 스티커 색. 공책 위에서 잉크와 구별되되 튀지 않는 정도. */
const INK = 'var(--ink)';

export function StickerArt({ id, size = 28 }: { id: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true as const,
    // 스티커는 종이 위에 얹힌 것이므로 아주 옅은 그림자를 준다. 없으면 인쇄된 그림이다.
    style: { filter: 'drop-shadow(0.5px 1px 0.5px rgb(0 0 0 / 18%))' },
  };

  switch (id) {
    case 'heart':
      return (
        <svg {...common}>
          <path d="M12 20.5C6 16.5 3 13.4 3 9.8 3 7.1 5 5 7.6 5c1.6 0 3.2.8 4.4 2.3C13.2 5.8 14.8 5 16.4 5 19 5 21 7.1 21 9.8c0 3.6-3 6.7-9 10.7Z" fill="#e8827a" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
    case 'star':
      return (
        <svg {...common}>
          <path d="M12 3.2l2.5 5.4 5.9.7-4.4 4 1.2 5.8L12 16.3 6.8 19.1 8 13.3l-4.4-4 5.9-.7Z" fill="#f0c46a" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
    case 'flower':
      return (
        <svg {...common}>
          <g stroke={INK} strokeWidth="1.1" strokeLinejoin="round">
            {[0, 72, 144, 216, 288].map((angle) => (
              <ellipse key={angle} cx="12" cy="6.6" rx="3.1" ry="4.4" fill="#efa8bd" transform={`rotate(${angle} 12 12)`} />
            ))}
            <circle cx="12" cy="12" r="2.5" fill="#f5e08a" />
          </g>
        </svg>
      );
    case 'cloud':
      return (
        <svg {...common}>
          <path d="M6.6 18C4.1 18 2 16 2 13.6c0-2.2 1.7-4 3.9-4.3C6.6 6.6 9 4.6 11.9 4.6c3.2 0 5.9 2.4 6.3 5.5 2.1.2 3.8 2 3.8 4.1 0 2.3-1.9 3.8-4.2 3.8Z" fill="#bcd3e8" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common}>
          <path d="M20 14.6A8.6 8.6 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6Z" fill="#f0d68a" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...common}>
          <g stroke={INK} strokeWidth="1.1" strokeLinecap="round">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
              <line key={angle} x1="12" y1="2.6" x2="12" y2="5.2" transform={`rotate(${angle} 12 12)`} />
            ))}
            <circle cx="12" cy="12" r="5.2" fill="#f3b95f" />
          </g>
        </svg>
      );
    case 'leaf':
      return (
        <svg {...common}>
          <path d="M20 4C11 4 5 8.4 5 14.6c0 2 .7 3.7 1.9 5C10.7 15.7 14 12.6 19 10.6c-4 2.8-7.2 6-9.8 10.2 1.2.5 2.5.8 3.9.8 4.9 0 7.9-4.4 7.9-11 0-2.6-.4-4.8-1-6.6Z" fill="#a9c69a" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
    case 'ribbon':
      return (
        <svg {...common}>
          <g fill="#e8a0b4" stroke={INK} strokeWidth="1.1" strokeLinejoin="round">
            <path d="M11.4 11.6 4.3 7.2c-.7-.4-1.6.1-1.6.9v7.2c0 .8.9 1.3 1.6.9Z" />
            <path d="M12.6 11.6l7.1-4.4c.7-.4 1.6.1 1.6.9v7.2c0 .8-.9 1.3-1.6.9Z" />
            <circle cx="12" cy="12" r="2.2" />
          </g>
        </svg>
      );
    case 'tape':
      return (
        <svg {...common}>
          <path d="M2.5 8.5 21.5 6l.3 6.4-19 2.6Z" fill="#e6dfc8" fillOpacity="0.85" stroke={INK} strokeWidth="1" strokeLinejoin="round" />
        </svg>
      );
    case 'clip':
      return (
        <svg {...common}>
          <path d="M17 8.4v7.9a4.6 4.6 0 1 1-9.2 0V7.3a3 3 0 1 1 6 0v8.6a1.5 1.5 0 0 1-3 0V8.6" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'stamp':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2.4" fill="none" stroke="#d16a55" strokeWidth="1.8" />
          <path d="M8 12.4l2.6 2.8L16 9.4" fill="none" stroke="#d16a55" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'note':
      return (
        <svg {...common}>
          <path d="M4 4h16v12.5L16.5 20H4Z" fill="#f2e79c" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M20 16.5h-3.5V20" fill="none" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
          <g stroke={INK} strokeWidth="0.9" strokeLinecap="round" opacity="0.65">
            <line x1="7" y1="9" x2="16" y2="9" />
            <line x1="7" y1="12.2" x2="14" y2="12.2" />
          </g>
        </svg>
      );
    default:
      return null;
  }
}
