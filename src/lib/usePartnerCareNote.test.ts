import { describe, it, expect } from 'vitest';
import { selectPartnerCareNote } from '@/lib/usePartnerCareNote';
import { signalsFrom } from '@/lib/cycleSupportLabels';
import type { CycleSupportSignal } from '@/types';

const TODAY = '2026-08-23';
const NOW = '2026-08-23T09:00:00.000Z';
const ME = 'user-mine';
const THEM = 'user-theirs';

const signal = (over: Partial<CycleSupportSignal> = {}): CycleSupportSignal => ({
  id: 'sig-1',
  coupleId: 'couple-1',
  ownerId: THEM,
  kind: 'feeling_unwell',
  sharedForDate: TODAY,
  expiresAt: '2026-08-24T00:00:00.000Z',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe('홈 쪽지에 뜨는 것은 상대가 오늘 보낸 살아 있는 신호뿐이다', () => {
  it('상대가 오늘 보낸 것은 뜬다', () => {
    expect(selectPartnerCareNote([signal()], ME, TODAY, NOW)?.kind).toBe('feeling_unwell');
  });

  /*
    이것이 빠지면 **내가 보낸 것이 내 홈에 상대의 쪽지처럼 뜬다.** 내가 오늘 힘들다고
    보낸 말이 상대가 한 말로 읽히는 것이라, 조용히 틀리는 종류의 결함이다.
  */
  it('내가 보낸 것은 내 쪽지가 아니다', () => {
    expect(selectPartnerCareNote([signal({ ownerId: ME })], ME, TODAY, NOW)).toBeNull();
  });

  it('지난 날의 것은 오늘 걸려 있지 않는다', () => {
    expect(selectPartnerCareNote([signal({ sharedForDate: '2026-08-22' })], ME, TODAY, NOW)).toBeNull();
  });

  it('만료된 것은 뜨지 않는다', () => {
    expect(selectPartnerCareNote(
      [signal({ expiresAt: '2026-08-23T08:00:00.000Z' })], ME, TODAY, NOW,
    )).toBeNull();
  });

  /* 거둬들인 말은 남지 않는다. 취소가 화면에 반영되지 않으면 취소가 아니다. */
  it('상대가 거둬들인 것은 사라진다', () => {
    expect(selectPartnerCareNote([signal({ revokedAt: NOW })], ME, TODAY, NOW)).toBeNull();
  });

  it('아무것도 없으면 아무것도 없다', () => {
    expect(selectPartnerCareNote([], ME, TODAY, NOW)).toBeNull();
  });

  /* 로그인 전에는 누구의 것도 아니다. `ownerId !== undefined` 는 언제나 참이므로,
     이 가드가 없으면 로그아웃 직후 한 프레임 동안 남의 쪽지가 뜬다. */
  it('내가 누구인지 모르면 아무것도 고르지 않는다', () => {
    expect(selectPartnerCareNote([signal()], undefined, TODAY, NOW)).toBeNull();
  });

  it('여럿이면 오늘 살아 있는 것 중 하나를 고른다', () => {
    const picked = selectPartnerCareNote(
      [signal({ id: 'old', sharedForDate: '2026-08-01' }), signal({ id: 'now', kind: 'resting' })],
      ME, TODAY, NOW,
    );
    expect(picked?.id).toBe('now');
  });
});

describe('어느 쪽 신호인지 가르는 판정은 한 곳이 소유한다', () => {
  it('내 것과 상대 것을 정확히 갈라 낸다', () => {
    const both = [signal({ id: 'theirs' }), signal({ id: 'mine', ownerId: ME })];
    expect(signalsFrom(both, ME, 'mine').map((one) => one.id)).toEqual(['mine']);
    expect(signalsFrom(both, ME, 'partner').map((one) => one.id)).toEqual(['theirs']);
  });

  /*
    부호가 뒤집히면 **내가 보낸 말이 상대가 한 말로 화면에 뜬다.** 세 자리에 흩어져
    있던 판정이라 하나를 고칠 때 나머지를 같이 보게 되지 않았다.
  */
  it('두 쪽이 서로를 겹치지 않는다', () => {
    const both = [signal({ id: 'theirs' }), signal({ id: 'mine', ownerId: ME })];
    const mine = signalsFrom(both, ME, 'mine').map((one) => one.id);
    const partner = signalsFrom(both, ME, 'partner').map((one) => one.id);
    expect(mine.filter((id) => partner.includes(id))).toEqual([]);
    expect([...mine, ...partner].sort()).toEqual(['mine', 'theirs']);
  });

  it('내가 누구인지 모르면 어느 쪽도 아니다', () => {
    expect(signalsFrom([signal()], undefined, 'mine')).toEqual([]);
    expect(signalsFrom([signal()], undefined, 'partner')).toEqual([]);
  });
});
