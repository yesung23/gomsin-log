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
      title: '오늘은 몸이 힘들어요',
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
      to: '/saved',
    });
  });

  it('gently offers one-line recording only when there is no higher-priority need', () => {
    expect(selectHomeFocus({
      ...quietState,
      hasOwnRecordToday: false,
    })).toMatchObject({
      kind: 'compose',
      to: '/compose',
    });
  });

  it('stays quiet when today is already connected and recorded', () => {
    expect(selectHomeFocus(quietState)).toBeNull();
  });
});
