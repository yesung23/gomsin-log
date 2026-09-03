import { CYCLE_SUPPORT_LABEL } from '@/lib/cycleSupportLabels';
import type { CycleSupportKind } from '@/types';

export type HomeFocusKind = 'care' | 'partner-day' | 'talk-about' | 'compose';

export interface HomeFocus {
  kind: HomeFocusKind;
  title: string;
  actionLabel: string;
  to: '/me' | '/story/partner' | '/saved' | '/compose';
}

interface HomeFocusInput {
  partnerName: string;
  careKind: CycleSupportKind | null;
  hasPartnerDay: boolean;
  hasTalkAboutMarks: boolean;
  hasOwnRecordToday: boolean;
}

/**
 * Choose one current need for Home without changing any underlying state.
 *
 * This is presentation priority only. It does not acknowledge PartnerDay, mark a
 * record as read, alter a talk-about mark, or infer health information. A care
 * note is eligible only after the privacy-scoped hook has returned the explicit
 * signal the partner chose to share.
 */
export function selectHomeFocus({
  partnerName,
  careKind,
  hasPartnerDay,
  hasTalkAboutMarks,
  hasOwnRecordToday,
}: HomeFocusInput): HomeFocus | null {
  if (careKind) {
    return {
      kind: 'care',
      title: `${partnerName}: ${CYCLE_SUPPORT_LABEL[careKind]}`,
      actionLabel: '보기',
      to: '/me',
    };
  }

  if (hasPartnerDay) {
    return {
      kind: 'partner-day',
      title: `${partnerName}의 오늘`,
      actionLabel: '이어 보기',
      to: '/story/partner',
    };
  }

  if (hasTalkAboutMarks) {
    return {
      kind: 'talk-about',
      title: '이따 이야기할 것',
      actionLabel: '모아보기',
      to: '/saved',
    };
  }

  if (!hasOwnRecordToday) {
    return {
      kind: 'compose',
      title: '오늘 한 줄 남기기',
      actionLabel: '쓰기',
      to: '/compose',
    };
  }

  return null;
}
