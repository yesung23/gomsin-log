import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PartnerBriefingCard } from './PartnerBriefingCard';
import type { PartnerBriefing } from '@/lib/partnerBriefing/contract';

function createMockBriefing(overrides: Partial<PartnerBriefing> = {}): PartnerBriefing {
  return {
    version: 1,
    sourceCount: 3,
    generation: 'deterministic',
    rangeLabel: '8월 26일',
    overview: {
      text: '총 3개의 기록이 있습니다.',
      sourceRecordIds: ['rec-1', 'rec-2', 'rec-3'],
    },
    days: [
      {
        date: '2026-08-26',
        sections: [
          {
            period: 'morning',
            items: [
              { parts: [{ text: '“아침 먹었어”라고 기록했어요.', sourceRecordId: 'rec-1' }] },
              { parts: [{ text: '사진 1장을 남겼어요.', sourceRecordId: 'rec-2' }] },
            ],
          },
          {
            period: 'evening',
            items: [
              { parts: [{ text: '“오늘 하루 수고했어”라고 기록했어요.', sourceRecordId: 'rec-3' }] },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('PartnerBriefingCard (Phase B2 Gate)', () => {
  const onOpenRecord = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Korean collapsed 10s summary exact', () => {
    const briefing = createMockBriefing();
    render(<PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />);

    // Heading & Count & Range
    expect(screen.getByText('지난 연락 이후')).toBeTruthy();
    expect(screen.getByText('순간 3개')).toBeTruthy();
    expect(screen.getByText('8월 26일')).toBeTruthy();

    // 10s Overview text
    expect(screen.getByText('총 3개의 기록이 있습니다.')).toBeTruthy();

    // Expand control in collapsed state with useId-derived aria-controls
    const expandBtn = screen.getByRole('button', { name: /자세히 보기/i });
    expect(expandBtn).toBeTruthy();
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
    const controlsId = expandBtn.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(controlsId).toContain('details');

    // Initial details absent
    expect(screen.queryByTestId('partner-briefing-details')).toBeNull();
    expect(screen.queryByText('“아침 먹었어”라고 기록했어요.')).toBeNull();
  });

  it('English singular/plural and copy', async () => {
    const user = userEvent.setup();

    // Singular (1 moment)
    const singleBriefing = createMockBriefing({
      sourceCount: 1,
      rangeLabel: 'August 26',
      overview: { text: '1 record in total.', sourceRecordIds: ['rec-1'] },
      days: [
        {
          date: '2026-08-26',
          sections: [
            {
              period: 'morning',
              items: [{ parts: [{ text: 'They wrote: “Had breakfast”', sourceRecordId: 'rec-1' }] }],
            },
          ],
        },
      ],
    });

    const { unmount } = render(
      <PartnerBriefingCard briefing={singleBriefing} locale="en" onOpenRecord={onOpenRecord} />
    );

    expect(screen.getByText('Since you last checked')).toBeTruthy();
    expect(screen.getByText('1 moment')).toBeTruthy();
    expect(screen.getByText('August 26')).toBeTruthy();
    expect(screen.getByText('1 record in total.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /See details/i })).toBeTruthy();
    unmount();

    // Plural (2 moments)
    const pluralBriefing = createMockBriefing({
      sourceCount: 2,
      rangeLabel: 'August 26 – August 27',
      overview: { text: 'Over 2 days: 2 records in total.', sourceRecordIds: ['rec-1', 'rec-2'] },
      days: [
        {
          date: '2026-08-26',
          sections: [
            {
              period: 'morning',
              items: [{ parts: [{ text: 'They wrote: “Good morning”', sourceRecordId: 'rec-1' }] }],
            },
          ],
        },
        {
          date: '2026-08-27',
          sections: [
            {
              period: 'night',
              items: [{ parts: [{ text: 'Shared 1 photo.', sourceRecordId: 'rec-2' }] }],
            },
          ],
        },
      ],
    });

    render(
      <PartnerBriefingCard briefing={pluralBriefing} locale="en" onOpenRecord={onOpenRecord} />
    );

    expect(screen.getByText('2 moments')).toBeTruthy();
    expect(screen.getByText('August 26 – August 27')).toBeTruthy();

    // Expand and verify English period names and collapse button
    const expandBtn = screen.getByRole('button', { name: /See details/i });
    await user.click(expandBtn);

    expect(screen.getByRole('button', { name: /Collapse/i })).toBeTruthy();
    expect(screen.getByText('Morning')).toBeTruthy();
    expect(screen.getByText('Night')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'View original' })).toHaveLength(2);
  });

  it('initial details absent; expand/collapse behavior + aria', async () => {
    const user = userEvent.setup();
    const briefing = createMockBriefing();
    render(<PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />);

    const toggleBtn = screen.getByTestId('partner-briefing-expand');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    const detailsId = toggleBtn.getAttribute('aria-controls')!;
    expect(detailsId).toBeTruthy();
    expect(screen.queryByTestId('partner-briefing-details')).toBeNull();

    // Click expand
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    const details = screen.getByTestId('partner-briefing-details');
    expect(details).toBeTruthy();
    expect(details.getAttribute('id')).toBe(detailsId);
    expect(screen.getByText('접기')).toBeTruthy();

    // Click collapse
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('partner-briefing-details')).toBeNull();
    expect(screen.getByText('자세히 보기')).toBeTruthy();
  });

  it('two cards render with distinct aria-controls IDs and independently control their details element', async () => {
    const user = userEvent.setup();
    const briefing1 = createMockBriefing({ rangeLabel: 'Card 1' });
    const briefing2 = createMockBriefing({ rangeLabel: 'Card 2' });

    render(
      <div>
        <PartnerBriefingCard briefing={briefing1} onOpenRecord={onOpenRecord} />
        <PartnerBriefingCard briefing={briefing2} onOpenRecord={onOpenRecord} />
      </div>
    );

    const expandButtons = screen.getAllByTestId('partner-briefing-expand');
    expect(expandButtons).toHaveLength(2);

    const id1 = expandButtons[0].getAttribute('aria-controls');
    const id2 = expandButtons[1].getAttribute('aria-controls');
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);

    // Expand only card 1
    await user.click(expandButtons[0]);
    expect(expandButtons[0]).toHaveAttribute('aria-expanded', 'true');
    expect(expandButtons[1]).toHaveAttribute('aria-expanded', 'false');

    const details1 = document.getElementById(id1!);
    const details2 = document.getElementById(id2!);
    expect(details1).toBeTruthy();
    expect(details2).toBeNull();

    // Expand card 2 as well
    await user.click(expandButtons[1]);
    expect(expandButtons[1]).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(id2!)).toBeTruthy();

    // Collapse card 1
    await user.click(expandButtons[0]);
    expect(expandButtons[0]).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(id1!)).toBeNull();
    expect(document.getElementById(id2!)).toBeTruthy();
  });

  it('exact 8 items all appear after expand (no 5 cap), in day/period/item order', async () => {
    const user = userEvent.setup();
    const itemsDay1Morning = [
      { parts: [{ text: 'Item 1 - Day 1 Morning 1', sourceRecordId: 'rec-1' }] },
      { parts: [{ text: 'Item 2 - Day 1 Morning 2', sourceRecordId: 'rec-2' }] },
    ];
    const itemsDay1Afternoon = [
      { parts: [{ text: 'Item 3 - Day 1 Afternoon 1', sourceRecordId: 'rec-3' }] },
      { parts: [{ text: 'Item 4 - Day 1 Afternoon 2', sourceRecordId: 'rec-4' }] },
    ];
    const itemsDay2Evening = [
      { parts: [{ text: 'Item 5 - Day 2 Evening 1', sourceRecordId: 'rec-5' }] },
      { parts: [{ text: 'Item 6 - Day 2 Evening 2', sourceRecordId: 'rec-6' }] },
    ];
    const itemsDay2Night = [
      { parts: [{ text: 'Item 7 - Day 2 Night 1', sourceRecordId: 'rec-7' }] },
      { parts: [{ text: 'Item 8 - Day 2 Night 2', sourceRecordId: 'rec-8' }] },
    ];

    const eightItemBriefing: PartnerBriefing = {
      version: 1,
      sourceCount: 8,
      generation: 'hybrid',
      rangeLabel: '8월 26일 ~ 8월 27일',
      overview: {
        text: '2일 동안 총 8개의 기록이 있습니다.',
        sourceRecordIds: ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5', 'rec-6', 'rec-7', 'rec-8'],
      },
      days: [
        {
          date: '2026-08-26',
          sections: [
            { period: 'morning', items: itemsDay1Morning },
            { period: 'afternoon', items: itemsDay1Afternoon },
          ],
        },
        {
          date: '2026-08-27',
          sections: [
            { period: 'evening', items: itemsDay2Evening },
            { period: 'night', items: itemsDay2Night },
          ],
        },
      ],
    };

    render(<PartnerBriefingCard briefing={eightItemBriefing} onOpenRecord={onOpenRecord} />);
    await user.click(screen.getByTestId('partner-briefing-expand'));

    const renderedItems = screen.getAllByRole('button', { name: '원본 보기' });
    expect(renderedItems).toHaveLength(8);

    // Verify exact sequential ordering in DOM
    const details = screen.getByTestId('partner-briefing-details');
    const allItemTexts = Array.from(details.querySelectorAll('li p')).map((p) => p.textContent);
    expect(allItemTexts).toEqual([
      'Item 1 - Day 1 Morning 1',
      'Item 2 - Day 1 Morning 2',
      'Item 3 - Day 1 Afternoon 1',
      'Item 4 - Day 1 Afternoon 2',
      'Item 5 - Day 2 Evening 1',
      'Item 6 - Day 2 Evening 2',
      'Item 7 - Day 2 Night 1',
      'Item 8 - Day 2 Night 2',
    ]);
  });

  it('each expanded original button has aria-describedby pointing to the exact item text element', async () => {
    const user = userEvent.setup();
    const briefing = createMockBriefing();
    render(<PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />);

    await user.click(screen.getByTestId('partner-briefing-expand'));
    const buttons = screen.getAllByRole('button', { name: '원본 보기' });
    expect(buttons).toHaveLength(3);

    // Check item 1
    const descId1 = buttons[0].getAttribute('aria-describedby');
    expect(descId1).toBeTruthy();
    const textEl1 = document.getElementById(descId1!);
    expect(textEl1).toBeTruthy();
    expect(textEl1?.textContent).toBe('“아침 먹었어”라고 기록했어요.');

    // Check item 2
    const descId2 = buttons[1].getAttribute('aria-describedby');
    expect(descId2).toBeTruthy();
    expect(descId2).not.toBe(descId1);
    const textEl2 = document.getElementById(descId2!);
    expect(textEl2).toBeTruthy();
    expect(textEl2?.textContent).toBe('사진 1장을 남겼어요.');

    // Check item 3
    const descId3 = buttons[2].getAttribute('aria-describedby');
    expect(descId3).toBeTruthy();
    expect(descId3).not.toBe(descId1);
    expect(descId3).not.toBe(descId2);
    const textEl3 = document.getElementById(descId3!);
    expect(textEl3).toBeTruthy();
    expect(textEl3?.textContent).toBe('“오늘 하루 수고했어”라고 기록했어요.');
  });

  it('clicking multiple item buttons calls exact corresponding IDs', async () => {
    const user = userEvent.setup();
    const briefing = createMockBriefing();
    render(<PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />);

    await user.click(screen.getByTestId('partner-briefing-expand'));
    const buttons = screen.getAllByRole('button', { name: '원본 보기' });
    expect(buttons).toHaveLength(3);

    // Click 1st item (rec-1)
    await user.click(buttons[0]);
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenLastCalledWith('rec-1');

    // Click 3rd item (rec-3)
    await user.click(buttons[2]);
    expect(onOpenRecord).toHaveBeenCalledTimes(2);
    expect(onOpenRecord).toHaveBeenLastCalledWith('rec-3');

    // Click 2nd item (rec-2)
    await user.click(buttons[1]);
    expect(onOpenRecord).toHaveBeenCalledTimes(3);
    expect(onOpenRecord).toHaveBeenLastCalledWith('rec-2');
  });

  it('render/expand/collapse alone calls no original callback', async () => {
    const user = userEvent.setup();
    const briefing = createMockBriefing();
    render(<PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />);

    expect(onOpenRecord).not.toHaveBeenCalled();

    const toggleBtn = screen.getByTestId('partner-briefing-expand');
    await user.click(toggleBtn);
    expect(onOpenRecord).not.toHaveBeenCalled();

    await user.click(toggleBtn);
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it('all interactive controls class includes min-h-11 or equivalent 44px', async () => {
    const user = userEvent.setup();
    const briefing = createMockBriefing();
    render(<PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />);

    // Collapsed check
    const collapsedButtons = screen.getAllByRole('button');
    for (const btn of collapsedButtons) {
      expect(btn.className).toContain('min-h-11');
    }

    // Expanded check
    await user.click(screen.getByTestId('partner-briefing-expand'));
    const expandedButtons = screen.getAllByRole('button');
    expect(expandedButtons.length).toBeGreaterThan(1);
    for (const btn of expandedButtons) {
      expect(btn.className).toContain('min-h-11');
    }
  });

  it('fixed copy has zero military-specific terms', async () => {
    const user = userEvent.setup();
    const briefing: PartnerBriefing = {
      version: 1,
      sourceCount: 4,
      generation: 'deterministic',
      rangeLabel: '8월 26일',
      overview: { text: '총 4개의 기록이 있습니다.', sourceRecordIds: ['r1', 'r2', 'r3', 'r4'] },
      days: [
        {
          date: '2026-08-26',
          sections: [
            { period: 'morning', items: [{ parts: [{ text: '기록 1', sourceRecordId: 'r1' }] }] },
            { period: 'afternoon', items: [{ parts: [{ text: '기록 2', sourceRecordId: 'r2' }] }] },
            { period: 'evening', items: [{ parts: [{ text: '기록 3', sourceRecordId: 'r3' }] }] },
            { period: 'night', items: [{ parts: [{ text: '기록 4', sourceRecordId: 'r4' }] }] },
          ],
        },
      ],
    };

    const { container, unmount } = render(
      <PartnerBriefingCard briefing={briefing} locale="ko" onOpenRecord={onOpenRecord} />
    );
    await user.click(screen.getByTestId('partner-briefing-expand'));

    const militaryRegex = /군대|군화|곰신|복무|전역/;
    expect(container.textContent).not.toMatch(militaryRegex);
    unmount();

    // Check EN locale as well
    const { container: containerEn } = render(
      <PartnerBriefingCard briefing={briefing} locale="en" onOpenRecord={onOpenRecord} />
    );
    await user.click(screen.getByTestId('partner-briefing-expand'));
    expect(containerEn.textContent).not.toMatch(militaryRegex);
  });

  it('multi-day representability and item text unchanged', async () => {
    const user = userEvent.setup();
    const rawText1 = '“오늘 날씨가 너무 좋아서 산책했어!”라고 기록했어요.';
    const rawText2 = '동영상 1개, 음성 2개를 남겼어요.';
    const rawText3 = '“맛있는 저녁 먹고 들어가는 길이야.”라고 기록했어요.';

    const multiDayBriefing: PartnerBriefing = {
      version: 1,
      sourceCount: 3,
      generation: 'hybrid',
      rangeLabel: '8월 25일 ~ 8월 26일',
      overview: {
        text: '2일 동안 총 3개의 기록 (동영상 1개, 음성 2개)이 있습니다.',
        sourceRecordIds: ['rec-a', 'rec-b', 'rec-c'],
      },
      days: [
        {
          date: '2026-08-25',
          sections: [
            { period: 'afternoon', items: [{ parts: [{ text: rawText1, sourceRecordId: 'rec-a' }] }] },
          ],
        },
        {
          date: '2026-08-26',
          sections: [
            { period: 'morning', items: [{ parts: [{ text: rawText2, sourceRecordId: 'rec-b' }] }] },
            { period: 'night', items: [{ parts: [{ text: rawText3, sourceRecordId: 'rec-c' }] }] },
          ],
        },
      ],
    };

    render(<PartnerBriefingCard briefing={multiDayBriefing} onOpenRecord={onOpenRecord} />);
    await user.click(screen.getByTestId('partner-briefing-expand'));

    expect(screen.getByText('8월 25일')).toBeTruthy();
    expect(screen.getByText('8월 26일')).toBeTruthy();
    expect(screen.getByText(rawText1)).toBeTruthy();
    expect(screen.getByText(rawText2)).toBeTruthy();
    expect(screen.getByText(rawText3)).toBeTruthy();
  });

  it('sourceRecordId is not exposed as visible text/data attribute', async () => {
    const user = userEvent.setup();
    const secretId = 'secret-record-id-xyz-987';
    const briefing: PartnerBriefing = {
      version: 1,
      sourceCount: 1,
      generation: 'deterministic',
      rangeLabel: '8월 26일',
      overview: { text: '기록이 있습니다.', sourceRecordIds: [secretId] },
      days: [
        {
          date: '2026-08-26',
          sections: [
            {
              period: 'morning',
              items: [{ parts: [{ text: '테스트 기록', sourceRecordId: secretId }] }],
            },
          ],
        },
      ],
    };

    const { container } = render(
      <PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />
    );
    await user.click(screen.getByTestId('partner-briefing-expand'));

    // Verify secretId does not appear in text content
    expect(container.textContent).not.toContain(secretId);

    // Verify secretId does not appear in HTML attributes
    expect(container.innerHTML).not.toContain(secretId);
  });

  it('handles empty briefing with 0 days gracefully', () => {
    const emptyBriefing: PartnerBriefing = {
      version: 1,
      sourceCount: 0,
      generation: 'deterministic',
      rangeLabel: '',
      overview: { text: '', sourceRecordIds: [] },
      days: [],
    };

    render(<PartnerBriefingCard briefing={emptyBriefing} onOpenRecord={onOpenRecord} />);

    expect(screen.getByText('지난 연락 이후')).toBeTruthy();
    expect(screen.getByText('순간 0개')).toBeTruthy();
    expect(screen.queryByTestId('partner-briefing-expand')).toBeNull();
  });

  it('one compressed item containing at least 2 parts renders all parts grouped in one summary paragraph and each button opens its exact corresponding source', async () => {
    const user = userEvent.setup();
    const briefing: PartnerBriefing = {
      version: 1,
      sourceCount: 2,
      generation: 'on_device',
      rangeLabel: '8월 26일',
      overview: {
        text: '총 2개의 기록이 있습니다.',
        sourceRecordIds: ['rec-part-1', 'rec-part-2'],
      },
      days: [
        {
          date: '2026-08-26',
          sections: [
            {
              period: 'morning',
              items: [
                {
                  parts: [
                    { text: '“아침 점호 완료했어”라고 기록했어요.', sourceRecordId: 'rec-part-1' },
                    { text: '“식사 맛있게 했어”라고 기록했어요.', sourceRecordId: 'rec-part-2' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    render(<PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />);
    await user.click(screen.getByTestId('partner-briefing-expand'));

    // Exactly one summary paragraph for this multi-part item
    const summaries = screen.getAllByTestId('partner-briefing-summary');
    expect(summaries).toHaveLength(1);

    // Both parts are rendered
    expect(screen.getByText('“아침 점호 완료했어”라고 기록했어요.')).toBeTruthy();
    expect(screen.getByText('“식사 맛있게 했어”라고 기록했어요.')).toBeTruthy();

    const buttons = screen.getAllByRole('button', { name: '원본 보기' });
    expect(buttons).toHaveLength(2);

    // Check aria-describedby for both buttons
    const descId1 = buttons[0].getAttribute('aria-describedby');
    const descId2 = buttons[1].getAttribute('aria-describedby');
    expect(descId1).toBeTruthy();
    expect(descId2).toBeTruthy();
    expect(descId1).not.toBe(descId2);
    expect(document.getElementById(descId1!)?.textContent).toBe('“아침 점호 완료했어”라고 기록했어요.');
    expect(document.getElementById(descId2!)?.textContent).toBe('“식사 맛있게 했어”라고 기록했어요.');

    // Click 1st part button -> opens rec-part-1
    await user.click(buttons[0]);
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenLastCalledWith('rec-part-1');

    // Click 2nd part button -> opens rec-part-2
    await user.click(buttons[1]);
    expect(onOpenRecord).toHaveBeenCalledTimes(2);
    expect(onOpenRecord).toHaveBeenLastCalledWith('rec-part-2');
  });

  it('progressively renders 300 source parts while keeping the initial DOM bounded and every exact original reachable', async () => {
    const user = userEvent.setup();
    const count = 300;
    const parts = Array.from({ length: count }, (_, i) => ({
      text: `기록 ${i + 1}번째 내용`,
      sourceRecordId: `rec-${i + 1}`,
    }));

    // Group into 75 items with 4 parts each
    const items = [];
    for (let i = 0; i < count; i += 4) {
      items.push({ parts: parts.slice(i, i + 4) });
    }

    const largeBriefing: PartnerBriefing = {
      version: 1,
      sourceCount: count,
      generation: 'on_device',
      rangeLabel: '8월 26일',
      overview: {
        text: `총 ${count}개의 기록이 있습니다.`,
        sourceRecordIds: parts.map((p) => p.sourceRecordId),
      },
      days: [
        {
          date: '2026-08-26',
          sections: [
            {
              period: 'afternoon',
              items,
            },
          ],
        },
      ],
    };

    render(<PartnerBriefingCard briefing={largeBriefing} onOpenRecord={onOpenRecord} />);
    const expandButton = screen.getByTestId('partner-briefing-expand');
    expect(expandButton.className).toContain('min-h-11');
    await user.click(expandButton);

    // Initial 20 compressed groups × 4 parts = 80 exact-original buttons and 20 summary paragraphs
    expect(screen.getAllByTestId('partner-briefing-summary')).toHaveLength(20);
    let viewButtons = screen.getAllByRole('button', { name: '원본 보기' });
    expect(viewButtons).toHaveLength(80);

    const firstShowMore = screen.getByRole('button', { name: '55개 더 보기' });
    expect(firstShowMore.className).toContain('min-h-11');

    await user.click(viewButtons[0]);
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenLastCalledWith('rec-1');

    // Each press reveals 20 more groups and does not navigate by itself.
    await user.click(firstShowMore);
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('partner-briefing-summary')).toHaveLength(40);
    expect(screen.getAllByRole('button', { name: '원본 보기' })).toHaveLength(160);
    expect(screen.getByRole('button', { name: '35개 더 보기' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '35개 더 보기' }));
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('partner-briefing-summary')).toHaveLength(60);
    expect(screen.getAllByRole('button', { name: '원본 보기' })).toHaveLength(240);
    expect(screen.getByRole('button', { name: '15개 더 보기' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '15개 더 보기' }));
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('partner-briefing-summary')).toHaveLength(75);

    viewButtons = screen.getAllByRole('button', { name: '원본 보기' });
    expect(viewButtons).toHaveLength(300);
    expect(screen.queryByTestId('partner-briefing-show-more')).toBeNull();

    await user.click(viewButtons[299]);
    expect(onOpenRecord).toHaveBeenCalledTimes(2);
    expect(onOpenRecord).toHaveBeenLastCalledWith('rec-300');

    // Collapse/re-expand resets the details DOM to the first 20 groups.
    await user.click(expandButton);
    expect(onOpenRecord).toHaveBeenCalledTimes(2);
    await user.click(expandButton);
    expect(onOpenRecord).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('button', { name: '원본 보기' })).toHaveLength(80);
    expect(screen.getAllByTestId('partner-briefing-summary')).toHaveLength(20);
    expect(screen.getByRole('button', { name: '55개 더 보기' })).toBeTruthy();
  });

  it('shows the remaining group count in the English show-more label matching the expansion unit', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 21 }, (_, groupIdx) => ({
      parts: Array.from({ length: 2 }, (_, partIdx) => ({
        text: `Group ${groupIdx + 1}, part ${partIdx + 1}`,
        sourceRecordId: `rec-${groupIdx + 1}-${partIdx + 1}`,
      })),
    }));

    const briefing = createMockBriefing({
      sourceCount: 42,
      overview: {
        text: '42 records in total.',
        sourceRecordIds: items.flatMap((item) => item.parts.map((part) => part.sourceRecordId)),
      },
      days: [
        {
          date: '2026-08-26',
          sections: [{ period: 'morning', items }],
        },
      ],
    });

    render(
      <PartnerBriefingCard briefing={briefing} locale="en" onOpenRecord={onOpenRecord} />
    );
    await user.click(screen.getByTestId('partner-briefing-expand'));

    const showMore = screen.getByRole('button', { name: 'Show 1 more' });
    expect(showMore.className).toContain('min-h-11');
    expect(screen.getAllByRole('button', { name: 'View original' })).toHaveLength(40);

    await user.click(showMore);
    expect(onOpenRecord).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'View original' })).toHaveLength(42);
    expect(screen.queryByTestId('partner-briefing-show-more')).toBeNull();
  });

  it('reproduces Terra P2 item 3: show-more label uses group unit matching expansion step rather than overstating with part count', async () => {
    const user = userEvent.setup();
    // 25 groups with 3 parts each = 75 source parts total
    const items = Array.from({ length: 25 }, (_, groupIdx) => ({
      parts: Array.from({ length: 3 }, (_, partIdx) => ({
        text: `Group ${groupIdx + 1}, part ${partIdx + 1}`,
        sourceRecordId: `rec-${groupIdx + 1}-${partIdx + 1}`,
      })),
    }));

    const briefing = createMockBriefing({
      sourceCount: 75,
      overview: {
        text: '75 records in total.',
        sourceRecordIds: items.flatMap((item) => item.parts.map((part) => part.sourceRecordId)),
      },
      days: [
        {
          date: '2026-08-26',
          sections: [{ period: 'morning', items }],
        },
      ],
    });

    render(<PartnerBriefingCard briefing={briefing} locale="ko" onOpenRecord={onOpenRecord} />);
    await user.click(screen.getByTestId('partner-briefing-expand'));

    expect(screen.queryByRole('button', { name: '15개 더 보기' })).toBeNull();
    const showMore = screen.getByRole('button', { name: '5개 더 보기' });
    expect(showMore).toBeTruthy();
    expect(showMore.className).toContain('min-h-11');

    // Expanding reveals all remaining groups and allows opening exact original
    await user.click(showMore);
    expect(screen.getAllByTestId('partner-briefing-summary')).toHaveLength(25);
    const allButtons = screen.getAllByRole('button', { name: '원본 보기' });
    expect(allButtons).toHaveLength(75);
    expect(screen.queryByTestId('partner-briefing-show-more')).toBeNull();
  });
  /*
    A day can carry two sections with the SAME period.

    `night` spans both ends of the clock, so 00:30 and 22:30 are separate contiguous runs
    with `morning` between them. The section list used to be keyed by `section.period`,
    which gives React two children keyed "night" in one list -- duplicate keys, a console
    error, and DOM reuse across two sections that hold different records.
  */
  it('renders repeated periods in a day without duplicate React keys', async () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      const briefing = createMockBriefing({
        sourceCount: 3,
        overview: {
          text: '총 3개의 기록이 있습니다.',
          sourceRecordIds: ['rec-0030', 'rec-0900', 'rec-2230'],
        },
        days: [
          {
            date: '2026-08-26',
            sections: [
              {
                period: 'night',
                items: [{ parts: [{ text: '새벽 근무 교대', sourceRecordId: 'rec-0030' }] }],
              },
              {
                period: 'morning',
                items: [{ parts: [{ text: '오전 점호 완료', sourceRecordId: 'rec-0900' }] }],
              },
              {
                period: 'night',
                items: [{ parts: [{ text: '늦은 밤 점검', sourceRecordId: 'rec-2230' }] }],
              },
            ],
          },
        ],
      });

      render(<PartnerBriefingCard briefing={briefing} onOpenRecord={onOpenRecord} />);
      await userEvent.click(screen.getByTestId('partner-briefing-expand'));

      const keyWarnings = errors.filter((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('same key')),
      );
      expect(keyWarnings).toEqual([]);

      // All three records are shown, each still opening its own exact original.
      expect(screen.getByText('새벽 근무 교대')).toBeTruthy();
      expect(screen.getByText('오전 점호 완료')).toBeTruthy();
      expect(screen.getByText('늦은 밤 점검')).toBeTruthy();

      const openButtons = screen.getAllByRole('button', { name: '원본 보기' });
      expect(openButtons).toHaveLength(3);
      await userEvent.click(openButtons[2]);
      expect(onOpenRecord).toHaveBeenCalledWith('rec-2230');
    } finally {
      console.error = originalError;
    }
  });

});
