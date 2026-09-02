import { CYCLE_SUPPORT_LABEL } from '@/lib/cycleSupportLabels';
import type { CycleSupportKind } from '@/types';

export type HomeFocusKind = 'care' | 'partner-day' | 'talk-about' | 'compose';

export interface HomeFocus {
  kind: HomeFocusKind;
  eyebrow: string;
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
      eyebrow: `${partnerName}의 오늘 쪽지`,
      title: CYCLE_SUPPORT_LABEL[careKind],
      actionLabel: '쪽지 보기',
      to: '/me',
    };
  }

  if (hasPartnerDay) {
    return {
      kind: 'partner-day',
      eyebrow: '상대의 오늘',
      title: `${partnerName}의 하루를 이어서 볼 수 있어요`,
      actionLabel: '보러 가기',
      to: '/story/partner',
    };
  }

  if (hasTalkAboutMarks) {
    return {
      kind: 'talk-about',
      eyebrow: '이따 이야기하기',
      title: '모아둔 이야기를 통화 전에 가볍게 훑어보세요',
      actionLabel: '모아보기',
      to: '/saved',
    };
  }

  if (!hasOwnRecordToday) {
    return {
      kind: 'compose',
      eyebrow: '오늘의 한 줄',
      title: '오늘 있었던 일을 가볍게 남겨볼까요',
      actionLabel: '남기기',
      to: '/compose',
    };
  }

  return null;
}
