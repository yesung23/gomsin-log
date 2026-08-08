/**
 * Static fixtures for the design preview.
 *
 * No Supabase client, no store, no network. Changing anything here cannot affect
 * production data.
 */

export type ScreenState = 'normal' | 'empty' | 'loading' | 'error' | 'long';

/** Why a briefing item earned one of the three slots. Drives the reason badge. */
export type BriefingReason = 'must_talk' | 'hard' | 'thought_of_you' | 'happened' | 'decision';

export type BriefingItem = {
  reason: BriefingReason;
  when: string;
  excerpt: string;
};

export type Moment = {
  time: string;
  kind: 'text' | 'photo' | 'voice' | 'video';
  body: string;
  duration?: string;
  privateOnly?: boolean;
};

export const REASON_LABEL: Record<BriefingReason, string> = {
  must_talk: '꼭 얘기',
  hard: '힘들었어',
  thought_of_you: '네 생각났어',
  happened: '이런 일이',
  decision: '결정 필요',
};

export const BRIEFING_ITEMS: BriefingItem[] = [
  {
    reason: 'must_talk',
    when: '오늘 18:40',
    excerpt: '팀 과제가 갑자기 바뀌었어. 내일까지 다시 써야 해.',
  },
  {
    reason: 'hard',
    when: '오늘 12:10',
    excerpt: '점심 먹다가 갑자기 네 생각나서 좀 울컥했어.',
  },
  {
    reason: 'decision',
    when: '8/20 제주도',
    excerpt: '숙소 후보 두 곳 중에 골라야 해. 둘 다 취소 마감이 모레야.',
  },
];

export const BRIEFING_ITEMS_LONG: BriefingItem[] = [
  {
    reason: 'must_talk',
    when: '오늘 18:40',
    excerpt:
      '팀 과제가 갑자기 바뀌어서 처음부터 다시 써야 하는데 조교님이 내일 오전까지 초안을 달라고 하셔서 밤을 새워야 할 것 같아. 아까 도서관에서 자리 잡고 있다가 공지 보고 좀 멍했어.',
  },
  {
    reason: 'hard',
    when: '오늘 12:10',
    excerpt:
      '점심 먹다가 갑자기 네 생각나서 좀 울컥했는데 같이 있던 애들한테 티 내기 싫어서 그냥 웃고 넘겼어. 별일 아닌데 왜 그랬는지 나도 모르겠어.',
  },
  {
    reason: 'decision',
    when: '8/20 제주도',
    excerpt:
      '숙소 후보 두 곳 중에 골라야 하는데 하나는 바다 보이는 대신 좀 멀고 하나는 시내라 편한데 창이 없어. 둘 다 취소 마감이 모레라서 통화할 때 정하자.',
  },
];

export const MOOD_LINE = '오후에 많이 지쳤다고 했어요.';
export const MOOD_LINE_LONG =
  '오후부터 계속 지친 상태였고, 저녁에는 조금 울컥했다고 직접 남겼어요. 단정하지 말고 먼저 어땠는지 물어봐 주세요.';

export const FIRST_QUESTION = '과제 바뀐 뒤엔 좀 괜찮아졌어?';
export const FIRST_QUESTION_LONG =
  '과제 바뀐 뒤엔 좀 괜찮아졌어? 오늘 점심때 울컥했다고 했는데 그 얘기부터 들어도 될까?';

export const MOMENTS: Moment[] = [
  { time: '09:20', kind: 'photo', body: '출근길에 비 왔어' },
  { time: '12:10', kind: 'voice', body: '점심 먹다가…', duration: '0:14' },
  { time: '15:05', kind: 'text', body: '오늘 도서관 자리 잡았다' },
  { time: '18:40', kind: 'text', body: '팀 과제가 갑자기 바뀌었어' },
  { time: '20:05', kind: 'text', body: '이건 나만 볼래', privateOnly: true },
];

export const MOMENTS_LONG: Moment[] = [
  {
    time: '09:20',
    kind: 'photo',
    body: '출근길에 비가 엄청 왔는데 우산을 안 가져와서 결국 편의점에서 하나 샀어. 이번 달에 벌써 세 번째야.',
  },
  {
    time: '12:10',
    kind: 'voice',
    body: '점심 먹다가 갑자기 네 생각나서 목소리 남겨 뒀어. 별 내용은 없어.',
    duration: '1:42',
  },
  {
    time: '18:40',
    kind: 'text',
    body: '팀 과제가 갑자기 바뀌어서 처음부터 다시 써야 하는데 조교님이 내일 오전까지 초안을 달라고 하셔서 밤을 새워야 할 것 같아.',
  },
];

export const SERVICE = { dday: 142, percent: 68, branch: '육군' };

/*
 * The shipped widget (`TodayLogWidget`, 오늘의 타임라인) renders `r.log` -- the
 * user's own sentence -- with the confirmed emotion beneath it. This fixture
 * used to carry only `time` and `who`, so the harness had nothing to print and
 * printed a generated title (`내가 남긴 순간`) instead. DESIGN_V2 Authentic over
 * synthetic forbids exactly that, so a reviewer reading the old captures would
 * have failed the screen for a defect that exists only in the harness.
 */
export const GOMSIN_TODAY = [
  { time: '14:20', who: '나' as const, log: '팀 과제가 갑자기 바뀌었어', emotion: '힘들었어' },
  { time: '18:10', who: '현우' as const, log: '오늘 훈련 끝!', emotion: '좋았어' },
  { time: '20:05', who: '나' as const, log: '자기 전에 목소리 듣고 싶다' },
];

export const LONG_NAME = '민지야사랑해영원히';
