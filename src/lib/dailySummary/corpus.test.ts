import { describe, it, expect } from 'vitest';
import type { DailyRecord } from '@/types';
import { selectDailySummaryCorpus, isPersistedRecord } from '@/lib/dailySummary/corpus';
import { deterministicSummaryLines } from '@/lib/dailySummary/rules';

/**
 * 무엇이 모델에 들어갈 수 있는가.
 *
 * 이 파일의 대부분은 **부정 테스트**다. 성공 경로 하나가 통과하는 것은 "코퍼스가 만들어진다"만
 * 증명하고, 이 기능에서 실제로 위험한 것은 들어가서는 안 될 기록이 들어가는 쪽이다. 그래서
 * 제외 규칙마다 하나씩 세운다.
 */

const TODAY = '2026-08-22';
const ME = 'viewer-user-id';
const PARTNER = 'partner-user-id';

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'r1',
    userId: PARTNER,
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '오늘 시험 끝났어',
    isPrivate: false,
    createdAt: '2026-08-22T00:00:00.000Z',
    ...over,
  } as DailyRecord;
}

function select(records: DailyRecord[], over: Partial<Parameters<typeof selectDailySummaryCorpus>[0]> = {}) {
  return selectDailySummaryCorpus({
    records,
    viewerUserId: ME,
    partnerUserId: PARTNER,
    todayStr: TODAY,
    coupleConnected: true,
    coupleStatus: 'active',
    ...over,
  });
}

/** 두 개 이상이어야 표지가 생기므로 기본 코퍼스는 항상 두 개 이상으로 만든다. */
function twoPartnerRecords(): DailyRecord[] {
  return [record({ id: 'a' }), record({ id: 'b', time: '13:00', log: '점심 먹었어' })];
}

describe('코퍼스는 상대의 오늘 공유 기록만 담는다', () => {
  it('시간순으로, 원본 id를 그대로 들고 나온다', () => {
    const result = select([
      record({ id: 'late', time: '18:00' }),
      record({ id: 'early', time: '07:00' }),
      record({ id: 'noon', time: '12:00' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map((r) => r.id)).toEqual(['early', 'noon', 'late']);
  });

  it('같은 시각이면 id로 안정 정렬한다', () => {
    const result = select([
      record({ id: 'b', time: '09:00' }),
      record({ id: 'a', time: '09:00' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('임의의 상한 없이 오늘의 모든 적격 기록을 시간순으로 담는다 (0/1/5/6/8/9개)', () => {
    const records = Array.from({ length: 9 }, (_, i) => record({ id: `r${i}`, time: `0${i}:00` }));
    const result = select(records);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(9);
    expect(result.records.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']);

    const result8 = select(records.slice(0, 8));
    expect(result8.ok).toBe(true);
    if (result8.ok) expect(result8.records).toHaveLength(8);

    const result6 = select(records.slice(0, 6));
    expect(result6.ok).toBe(true);
    if (result6.ok) expect(result6.records).toHaveLength(6);

    const result5 = select(records.slice(0, 5));
    expect(result5.ok).toBe(true);
    if (result5.ok) expect(result5.records).toHaveLength(5);
  });
});

describe('코퍼스에 들어갈 수 없는 것', () => {
  it('내가 쓴 기록', () => {
    const result = select([
      ...twoPartnerRecords(),
      record({ id: 'mine', userId: ME, log: '내가 쓴 것' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map((r) => r.id)).not.toContain('mine');
  });

  it('현재 파트너가 아닌 제3자·전 파트너 기록', () => {
    const result = select([
      ...twoPartnerRecords(),
      record({ id: 'unrelated', userId: 'unrelated-user' }),
      record({ id: 'former', userId: 'former-partner' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map((r) => r.id)).toEqual(['a', 'b']);

    // 현재 파트너 기록이 하나도 없으면 제3자 두 개만으로 코퍼스를 만들지 못한다.
    expect(select([
      record({ id: 'x', userId: 'unrelated-user' }),
      record({ id: 'y', userId: 'unrelated-user', time: '13:00' }),
    ])).toEqual({ ok: false, rejection: 'too_few_moments' });
  });

  it('비공개 기록', () => {
    const result = select([
      ...twoPartnerRecords(),
      record({ id: 'secret', isPrivate: true, log: '나에게만' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map((r) => r.id)).not.toContain('secret');
  });

  it('이 기기가 열 수 없는 기록', () => {
    // 읽지 못한 내용을 다듬는 것은 서사를 지어내는 것이다.
    for (const reason of ['key_unavailable', 'undecryptable'] as const) {
      const result = select([
        ...twoPartnerRecords(),
        record({ id: `locked-${reason}`, contentUnavailable: reason }),
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.records.map((r) => r.id)).not.toContain(`locked-${reason}`);
    }
  });

  it('저장되지 않은 기록 (draft·outbox 모양)', () => {
    // `createdAt` 또는 `userId`가 없으면 서버 행이 아니다.
    const result = select([
      ...twoPartnerRecords(),
      record({ id: 'draft', createdAt: undefined as unknown as string }),
      record({ id: 'queued', userId: undefined }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map((r) => r.id)).not.toContain('draft');
    expect(result.records.map((r) => r.id)).not.toContain('queued');
  });

  it('다른 날짜가 섞여 있으면 아무것도 담지 않는다', () => {
    // 오늘 것만 골라내면 화면의 목록과 다듬어진 목록이 어긋난다.
    const result = select([...twoPartnerRecords(), record({ id: 'yesterday', date: '2026-08-21' })]);
    expect(result).toEqual({ ok: false, rejection: 'multi_day' });
  });
});

describe('판정할 수 없으면 코퍼스를 만들지 않는다', () => {
  it('커플이 active가 아니면', () => {
    expect(select(twoPartnerRecords(), { coupleConnected: false }))
      .toEqual({ ok: false, rejection: 'couple_not_active' });
    expect(select(twoPartnerRecords(), { coupleStatus: 'pending' }))
      .toEqual({ ok: false, rejection: 'couple_not_active' });
    expect(select(twoPartnerRecords(), { coupleStatus: 'disconnected' }))
      .toEqual({ ok: false, rejection: 'couple_not_active' });
    expect(select(twoPartnerRecords(), { coupleStatus: undefined }))
      .toEqual({ ok: false, rejection: 'couple_not_active' });
  });

  it('viewer의 userId가 없으면 -- 역할로 작성자를 추측하지 않는다', () => {
    expect(select(twoPartnerRecords(), { viewerUserId: undefined }))
      .toEqual({ ok: false, rejection: 'identity_unresolved' });
    expect(select(twoPartnerRecords(), { viewerUserId: '' }))
      .toEqual({ ok: false, rejection: 'identity_unresolved' });
  });

  it('active membership에서 확인한 partner userId가 없거나 viewer와 같으면', () => {
    expect(select(twoPartnerRecords(), { partnerUserId: undefined }))
      .toEqual({ ok: false, rejection: 'identity_unresolved' });
    expect(select(twoPartnerRecords(), { partnerUserId: '' }))
      .toEqual({ ok: false, rejection: 'identity_unresolved' });
    expect(select(twoPartnerRecords(), { partnerUserId: ME }))
      .toEqual({ ok: false, rejection: 'identity_unresolved' });
  });

  it('오늘 날짜를 모르면', () => {
    expect(select(twoPartnerRecords(), { todayStr: '' }))
      .toEqual({ ok: false, rejection: 'identity_unresolved' });
  });

  it('순간이 하나 이하면 -- 표지 자체가 없다', () => {
    expect(select([record({ id: 'only' })]))
      .toEqual({ ok: false, rejection: 'too_few_moments' });
    expect(select([])).toEqual({ ok: false, rejection: 'too_few_moments' });
    // 상대 기록 하나 + 내 기록 하나도 상대 것 하나뿐이다.
    expect(select([record({ id: 'theirs' }), record({ id: 'mine', userId: ME })]))
      .toEqual({ ok: false, rejection: 'too_few_moments' });
  });
});

describe('isPersistedRecord', () => {
  it('id·userId·createdAt 세 값을 모두 요구한다', () => {
    expect(isPersistedRecord(record())).toBe(true);
    expect(isPersistedRecord(record({ id: '' }))).toBe(false);
    expect(isPersistedRecord(record({ userId: undefined }))).toBe(false);
    expect(isPersistedRecord(record({ createdAt: '' }))).toBe(false);
  });
});

describe('규칙 결과는 원본 매핑을 그대로 들고 있다', () => {
  it('줄마다 정확한 recordId와 표시용 시각을 갖는다', () => {
    const result = select(twoPartnerRecords());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = deterministicSummaryLines(result.records);
    expect(lines.map((line) => line.recordId)).toEqual(['a', 'b']);
    expect(lines.map((line) => line.time)).toEqual(['09:00', '13:00']);
    expect(lines.map((line) => line.text)).toEqual(['오늘 시험 끝났어', '점심 먹었어']);
  });

  it('본문이 없으면 첨부 종류를 사실대로 말한다 (감정을 단정하지 않는다)', () => {
    const lines = deterministicSummaryLines([
      record({ id: 'p', log: '', attachments: [{ type: 'photo', url: 'x' }] } as Partial<DailyRecord> as DailyRecord),
    ]);
    expect(lines[0].text).toBe('사진을 남겼어요');
    expect(lines[0].text).not.toMatch(/좋|슬프|힘들|기뻤|평온|아팠/);
  });
});
