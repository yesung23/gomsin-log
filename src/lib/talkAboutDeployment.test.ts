import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 기능 하나의 배포 지연이 계정을 인질로 잡지 않는다.
 *
 * 2026-08-22에 실제로 겪은 일: Google 로그인은 정상이었는데 직후 하이드레이션이
 * `talk_about_marks` 조회에서 멈춰 `TALK_ABOUT-SERVER` 화면이 뜨고 **앱 전체에 들어갈 수
 * 없었다.** 원인은 인증이 아니라 038/043이 운영에 적용되지 않아 PostgREST가 `PGRST205`
 * (테이블이 스키마 캐시에 없음)를 준 것이었다.
 *
 * `이따 이야기하기` 표시는 기록 위에 얹히는 **부가 메타데이터**다. 테이블이 스키마에 아예
 * 없으면 그 표시는 누구에게도 존재하지 않으므로 빈 목록은 추측이 아니라 사실이다.
 *
 * ## 이 파일이 지키는 경계
 *
 * 빈 목록으로 낮아지는 것은 **스키마 부재 하나뿐**이다. 권한 거부는 표시가 있는데 못 읽는
 * 것이므로 빈 목록이 곧 거짓말이 되고, 네트워크 실패도 마찬가지다. 예외가 넓어지면
 * 사용자는 자기가 표시해 둔 이야기거리가 사라진 것을 조용히 보게 된다.
 */

const select = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: (...args: unknown[]) => select(...args) }) },
  isSupabaseConfigured: true,
}));
vi.mock('@/lib/accountDeletion', () => ({ serverCallBlockedByPendingDeletion: () => false }));

const { fetchTalkAboutMarksResultFromDB } = await import('@/lib/talkAbout');

/** PostgREST의 체이닝을 흉내 낸다. 마지막 `order()`가 결과를 준다. */
function answers(result: { data: unknown; error: unknown }) {
  const chain = {
    eq: () => chain,
    order: () => Promise.resolve(result),
  };
  select.mockReturnValue(chain);
}

beforeEach(() => {
  select.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('스키마에 테이블이 없으면 실패가 아니라 없음이다', () => {
  it.each([
    ['PGRST205', { code: 'PGRST205', message: "Could not find the table 'public.talk_about_marks' in the schema cache" }],
    ['42P01', { code: '42P01', message: 'relation "talk_about_marks" does not exist' }],
  ])('%s 이면 빈 목록으로 성공한다', async (_label, error) => {
    answers({ data: null, error });
    const result = await fetchTalkAboutMarksResultFromDB('couple-a');
    expect(result.ok).toBe(true);
    expect(result.ok && result.marks).toEqual([]);
    expect(result.ok && result.deployed).toBe(false);
  });

  it('운영자가 무엇을 해야 하는지 로그가 말한다', async () => {
    /*
      `Failed to fetch talk-about marks: [object Object]` 는 읽는 사람에게 아무것도
      말하지 않았다. 배포 상태는 코드로 고칠 수 없으므로 로그가 처방을 담아야 한다.
    */
    answers({ data: null, error: { code: 'PGRST205', message: 'missing' } });
    await fetchTalkAboutMarksResultFromDB('couple-a');
    const logged = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(logged).toContain('038');
    expect(logged).toContain('043');
    expect(logged).toContain('Reload schema');
  });

  it('배포되어 있으면 그 사실도 함께 온다', async () => {
    answers({ data: [], error: null });
    const result = await fetchTalkAboutMarksResultFromDB('couple-a');
    expect(result.ok && result.deployed).toBe(true);
  });
});

describe('예외는 스키마 부재 하나뿐이다', () => {
  it.each([
    ['권한 거부', { code: '42501', message: 'permission denied' }],
    ['만료된 세션', { code: 'PGRST301', message: 'JWT expired' }],
    ['컬럼 없음', { code: 'PGRST204', message: 'column missing' }],
    ['재귀 정책', { code: '42P17', message: 'infinite recursion' }],
    ['알 수 없는 오류', { message: 'boom' }],
  ])('%s 는 여전히 실패다', async (_label, error) => {
    /*
      이 다섯 중 어느 것에서도 "표시가 없다"고 말할 수 없다. 있는데 못 읽는 것이고,
      빈 목록으로 낮추면 사용자는 자기가 표시해 둔 이야기거리가 사라진 것을 보게 된다.
    */
    answers({ data: null, error });
    const result = await fetchTalkAboutMarksResultFromDB('couple-a');
    expect(result.ok).toBe(false);
  });
});

describe('낮아짐이 조용하지 않다', () => {
  it('테이블이 없을 때 성공은 하되 배포되지 않았다고 표시한다', async () => {
    /*
      `{ ok: true, marks: [] }` 만 돌려주면 호출자는 "표시가 없는 커플"과 "기능이 아직
      배포되지 않음"을 구별할 수 없다. 지금 화면은 둘을 같게 그리지만, 그 판단은 호출자가
      할 수 있어야 하고 여기서 사실을 지워 버리면 영영 할 수 없다.
    */
    answers({ data: null, error: { code: 'PGRST205', message: 'missing' } });
    const result = await fetchTalkAboutMarksResultFromDB('couple-a');
    expect(result).toEqual({ ok: true, marks: [], deployed: false });
  });
});
