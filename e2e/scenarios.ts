import type { RecordRow, Scenario } from './fixtures/mockBackend';

export const TODAY = new Date().toISOString().slice(0, 10);

export const SHARED_LOG = '공개기록입니다';
export const PRIVATE_LOG = '비공개기록입니다';
export const PARTNER_LOG = '파트너가남긴기록';

export function record(over: Partial<RecordRow> & { id: string; user_id: string }): RecordRow {
  return {
    couple_id: 'couple-1',
    record_date: TODAY,
    record_time: '10:00',
    log_text: '기록',
    is_private: false,
    attachments: [],
    emotion_flow: [],
    created_at: `${TODAY}T10:00:00Z`,
    ...over,
  };
}

const RECORDS: RecordRow[] = [
  record({ id: 'rec-shared', user_id: 'user-creator', log_text: SHARED_LOG, record_time: '10:00' }),
  record({
    id: 'rec-private',
    user_id: 'user-creator',
    log_text: PRIVATE_LOG,
    record_time: '11:00',
    is_private: true,
    // An author-only emotion item: the partner's EmoFlow must never see it, and
    // the row itself must never reach them.
    emotion_flow: [
      { id: 'f1', group: 'longing', displayLabel: '그리움', sequence: 1, source: 'user_confirmed', visibility: 'author_only' },
    ],
  }),
  record({ id: 'rec-partner', user_id: 'user-partner', log_text: PARTNER_LOG, record_time: '12:00' }),
];

/** Creator, connected to a partner. */
export const CREATOR: Scenario = {
  userId: 'user-creator',
  displayName: '춘향',
  role: 'gomsin',
  coupleId: 'couple-1',
  partnerPresent: true,
  partnerName: '몽룡',
  records: RECORDS,
};

/** The invited partner, same couple, opposite role. */
export const PARTNER: Scenario = {
  ...CREATOR,
  userId: 'user-partner',
  displayName: '몽룡',
  role: 'soldier',
  partnerName: '춘향',
};

/** Creator who has made a space but whose partner has not joined yet. */
export const CREATOR_PENDING: Scenario = {
  ...CREATOR,
  partnerPresent: false,
  partnerName: undefined,
  invitationActive: true,
  records: [],
};

/** A signed-in account with no couple space at all. */
export const NO_SPACE: Scenario = {
  userId: 'user-solo',
  displayName: '홍길동',
  role: 'gomsin',
  coupleId: null,
  partnerPresent: false,
  records: [],
};
