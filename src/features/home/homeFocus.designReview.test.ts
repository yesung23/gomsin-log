import { describe, expect, it } from 'vitest';
import { selectHomeFocus } from '@/features/home/homeFocus';

const quietState = {
  partnerName: '예성',
  careKind: null,
  hasPartnerDay: false,
  hasTalkAboutMarks: false,
  hasOwnRecordToday: true,
} as const;

describe('Home current-need priority', () => {
  it('puts an explicitly shared care note before every other available action', () => {
    expect(selectHomeFocus({
      ...quietState,
      careKind: 'feeling_unwell',
      hasPartnerDay: true,
      hasTalkAboutMarks: true,
      hasOwnRecordToday: false,
    })).toMatchObject({
      kind: 'care',
      title: '예성: 오늘은 몸이 힘들어요',
      actionLabel: '보기',
      to: '/me',
    });
  });

  it('puts the partner day before saved conversation prompts', () => {
    expect(selectHomeFocus({
      ...quietState,
      hasPartnerDay: true,
      hasTalkAboutMarks: true,
      hasOwnRecordToday: false,
    })).toMatchObject({
      kind: 'partner-day',
      title: '예성의 오늘',
      actionLabel: '이어 보기',
      to: '/story/partner',
    });
  });

  it('surfaces saved conversation prompts before asking for another record', () => {
    expect(selectHomeFocus({
      ...quietState,
      hasTalkAboutMarks: true,
      hasOwnRecordToday: false,
    })).toMatchObject({
      kind: 'talk-about',
      title: '이따 이야기할 것',
      actionLabel: '모아보기',
      to: '/saved',
    });
  });

  it('gently offers one-line recording only when there is no higher-priority need', () => {
    expect(selectHomeFocus({
      ...quietState,
      hasOwnRecordToday: false,
    })).toMatchObject({
      kind: 'compose',
      title: '오늘 한 줄 남기기',
      actionLabel: '쓰기',
      to: '/compose',
    });
  });

  it('stays quiet when today is already connected and recorded', () => {
    expect(selectHomeFocus(quietState)).toBeNull();
  });
});
