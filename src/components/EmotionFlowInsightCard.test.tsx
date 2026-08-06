import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EmotionFlowInsightCard } from '@/components/EmotionFlowInsightCard';
import type { EmotionFlowItem, EmotionGroup } from '@/types';

function confirmed(
  group: EmotionGroup,
  sequence: number,
  displayLabel: string,
  overrides: Partial<EmotionFlowItem> = {},
): EmotionFlowItem {
  return {
    id: `${group}-${sequence}`,
    group,
    sequence,
    displayLabel,
    source: 'user_confirmed',
    visibility: 'shared',
    ...overrides,
  };
}

describe('EmotionFlowInsightCard', () => {
  it('renders nothing for an empty array', () => {
    const { container } = render(<EmotionFlowInsightCard items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for undefined items', () => {
    const { container } = render(<EmotionFlowInsightCard items={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when only rule suggestions are present', () => {
    const { container } = render(
      <EmotionFlowInsightCard
        items={[
          confirmed('joy', 1, '기쁨', { source: 'rule_suggested' }),
          confirmed('sadness', 2, '슬픔', { source: 'rule_suggested' }),
        ]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the ordered labels and the summary as text', () => {
    const { container } = render(
      <EmotionFlowInsightCard
        items={[
          confirmed('sadness', 1, '슬픔'),
          confirmed('uncertain', 2, '모르겠음'),
          confirmed('joy', 3, '기쁨'),
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('마음의 흐름');
    expect(text).toContain('슬픔 → 모르겠음 → 기쁨');
    expect(text).toContain('마음이 조금씩 편해지는 쪽으로 움직였어요.');
  });

  it('exposes the summary as the group label for assistive tech', () => {
    const { container } = render(
      <EmotionFlowInsightCard items={[confirmed('joy', 1, '기쁨')]} />,
    );
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('aria-label')).toContain('기쁨');
  });

  it('renders the largest-transition line when there are at least two points', () => {
    const { container } = render(
      <EmotionFlowInsightCard
        items={[confirmed('joy', 1, '기쁨'), confirmed('sadness', 2, '슬픔')]}
      />,
    );
    expect(container.textContent).toContain('가장 큰 변화: 기쁨 → 슬픔');
  });

  it('omits the largest-transition line for a single point', () => {
    const { container } = render(
      <EmotionFlowInsightCard items={[confirmed('joy', 1, '기쁨')]} />,
    );
    expect(container.textContent).not.toContain('가장 큰 변화');
  });

  it('draws exactly one polyline with one coordinate pair per point', () => {
    const { container } = render(
      <EmotionFlowInsightCard
        items={[
          confirmed('sadness', 1, '슬픔'),
          confirmed('calm', 2, '평온'),
          confirmed('joy', 3, '기쁨'),
        ]}
      />,
    );
    const polylines = container.querySelectorAll('polyline');
    expect(polylines).toHaveLength(1);
    const pairs = (polylines[0].getAttribute('points') ?? '').trim().split(/\s+/);
    expect(pairs).toHaveLength(3);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
  });

  it('keeps the sparkline presentational and fluid-width', () => {
    const { container } = render(
      <EmotionFlowInsightCard items={[confirmed('joy', 1, '기쁨')]} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('presentation');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 40');
    expect(svg.getAttribute('width')).toBeNull();
  });

  it('shows the non-persistence notice in the composer variant', () => {
    const { container } = render(
      <EmotionFlowInsightCard
        items={[confirmed('joy', 1, '기쁨'), confirmed('calm', 2, '평온')]}
        variant="composer"
      />,
    );
    expect(container.textContent).toContain('저장되지 않아요');
  });

  it('omits the non-persistence notice in the detail variant', () => {
    const { container } = render(
      <EmotionFlowInsightCard
        items={[confirmed('joy', 1, '기쁨'), confirmed('calm', 2, '평온')]}
        variant="detail"
      />,
    );
    expect(container.textContent).not.toContain('저장되지 않아요');
  });

  it('never renders matchedText', () => {
    const secret = '오늘 사수한테 혼났다';
    const { container } = render(
      <EmotionFlowInsightCard
        items={[
          confirmed('anger', 1, '분노', { matchedText: secret }),
          confirmed('calm', 2, '평온'),
        ]}
      />,
    );
    expect(container.textContent).not.toContain(secret);
    expect(container.innerHTML).not.toContain(secret);
  });
});
