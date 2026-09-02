import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { InkRing, Stamp, Bookmark, PaperCard, FoldDivider, PaperSkeleton } from '@/components/paper';

/**
 * 종이 컴포넌트가 지켜야 하는 것.
 *
 * 대부분은 "이렇게 보인다"가 아니라 "이건 절대 없다"이다. 이 앱이 인스타그램을 닮아갈수록
 * 관찰·경쟁 기능의 유입 압력이 커지므로, 없어야 할 것을 세는 쪽이 값을 한다.
 */

const DIR = resolve(process.cwd(), 'src/components/paper');
const sources = readdirSync(DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ name: f, text: readFileSync(resolve(DIR, f), 'utf8') }));

describe('종이 컴포넌트는 토큰만 쓴다', () => {
  it('전수를 훑는다', () => {
    expect(sources.length).toBeGreaterThanOrEqual(6);
  });

  it('색을 하드코딩하지 않는다', () => {
    // 하드코딩된 색은 light에서 맞고 dark에서 틀린 두 번째 사본을 만든다.
    const offenders = sources
      .filter(({ text }) => /#[0-9a-fA-F]{3,8}\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, '')))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it('7단계 밖의 글자 크기를 쓰지 않는다', () => {
    const OFF_SCALE = /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b|\btext-\[[^\]]*(?:px|rem|em)\]/;
    const offenders = sources.filter(({ text }) => OFF_SCALE.test(text)).map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});

describe('InkRing — 링은 상태를 그리되 아무것도 알리지 않는다', () => {
  it('세 상태를 모두 그린다', () => {
    for (const state of ['unread', 'read', 'idle'] as const) {
      const { container, unmount } = render(<InkRing state={state}><span>아바타</span></InkRing>);
      expect(container.querySelector('svg path')).toBeTruthy();
      unmount();
    }
  });

  it('미읽음 링이 더 진하게 그려진다', () => {
    const { container: unread } = render(<InkRing state="unread"><i /></InkRing>);
    const { container: read } = render(<InkRing state="read"><i /></InkRing>);
    const w = (c: Element) => Number(c.querySelector('path')?.getAttribute('stroke-width'));
    expect(w(unread)).toBeGreaterThan(w(read));
  });

  it('idle이어도 자리를 비우지 않는다', () => {
    // 사라지면 "없는 것"이 되고 남아 있으면 "아직 오지 않은 것"이 된다.
    const { container } = render(<InkRing state="idle"><i /></InkRing>);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('상태를 셀 수 있게 드러낸다', () => {
    // 링이 셋이 되는 순간 정렬이 필요해지고 정렬이 있으면 알고리즘이 생긴다. 세어야 한다.
    const { container } = render(<InkRing state="unread"><i /></InkRing>);
    expect(container.querySelector('[data-ink-ring="unread"]')).toBeTruthy();
  });

  it('장식용 svg를 스크린리더에 읽히지 않는다', () => {
    const { container } = render(<InkRing state="unread"><i /></InkRing>);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Stamp — 반응은 있고 개수는 없다', () => {
  it('props에 개수가 없다', () => {
    // 세는 순간 경쟁이 된다. 타입 수준에서 자리를 두지 않는 것이 §16의 구현이다.
    const source = sources.find(({ name }) => name === 'Stamp.tsx')!.text;
    const props = source.slice(source.indexOf('export function Stamp('), source.indexOf('}: {') + 400);
    expect(props).not.toMatch(/\bcount\b|\bcounts\b|\btotal\b/);
  });

  it('두 종류뿐이다', () => {
    const source = sources.find(({ name }) => name === 'Stamp.tsx')!.text;
    const kinds = source.match(/export type StampKind = ([^;]+);/)?.[1] ?? '';
    expect(kinds.split('|').map((s) => s.trim())).toEqual(["'empathy'", "'comfort'"]);
  });

  it('누르면 알리고, 상태를 보조기술에 노출한다', async () => {
    const onToggle = vi.fn();
    render(<Stamp kind="empathy" pressed={false} onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: '공감' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('비활성일 때 이유를 말한다', () => {
    // 이유 없이 죽어 있는 컨트롤은 고장으로 읽힌다.
    render(<Stamp kind="comfort" pressed={false} onToggle={() => {}} disabled disabledReason="연결이 끊겼어요" />);
    expect(screen.getByRole('button', { name: '토닥이기 — 연결이 끊겼어요' })).toBeDisabled();
  });
});

describe('Bookmark — 이따 이야기하기', () => {
  it('표시와 해제가 다른 이름으로 읽힌다', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Bookmark marked={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));
    expect(onToggle).toHaveBeenCalled();
    rerender(<Bookmark marked onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: '이따 이야기하기 표시 해제' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('이미 존칭이 붙은 상대 이름을 중복해 읽지 않는다', () => {
    render(
      <Bookmark
        marked={false}
        partnerMarked
        partnerName="예성님"
        onToggle={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: '예성님이 표시했어요. 나도 이따 이야기하기' }))
      .toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /예성님님/ })).not.toBeInTheDocument();
  });
});

describe('PaperCard · FoldDivider · PaperSkeleton', () => {
  it('PaperCard는 테두리를 그리지 않는다', () => {
    // 전체화면 안의 테두리는 화면 속 액자가 된다.
    const { container } = render(<PaperCard>글</PaperCard>);
    expect(container.firstElementChild?.className).not.toMatch(/\bborder\b/);
  });

  it('FoldDivider는 separator 하나다', () => {
    render(<FoldDivider />);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('PaperSkeleton은 무엇을 기다리는지 말한다', () => {
    render(<PaperSkeleton label="상대방의 하루를 불러오는 중" />);
    expect(screen.getByText('상대방의 하루를 불러오는 중')).toBeTruthy();
  });

  it('PaperSkeleton은 반짝이지 않는다', () => {
    // shimmer는 유리의 문법이다. 종이는 빛나지 않는다.
    const source = sources.find(({ name }) => name === 'PaperSkeleton.tsx')!.text;
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/animate-pulse|shimmer/);
  });
});
