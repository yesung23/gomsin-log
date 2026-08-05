import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STATE, LocalStorageRepository } from '@/lib/store';
import { resolveMemoOwnership } from '@/lib/insights';
import type { AppState, DailyRecord } from '@/types';

/**
 * 로컬 저장 계층 회귀 테스트.
 *  - 나만의 메모가 기기에 실제로 영속되는가
 *  - 다른 계정이 같은 기기를 쓸 때 메모가 격리되는가
 *  - 비공개 기록 본문이 localStorage에 평문으로 남지 않는가
 *  - 소스에 예시(가짜) 날짜가 되살아나지 않았는가
 */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  raw(key: string) {
    return this.map.get(key);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
}

const STORE_KEY = 'gomsinlog.state.v2';
let storage: MemoryStorage;

function stateWith(over: Partial<AppState>): AppState {
  return { ...DEFAULT_STATE, ...over };
}

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
});

describe('나만의 메모 영속성', () => {
  it('저장한 메모가 다시 불러올 때 유지된다', async () => {
    const repo = new LocalStorageRepository();
    await repo.saveState(stateWith({ myMemo: '면회 준비물: 편지, 간식', myMemoOwnerId: 'user-a' }));

    const loaded = await repo.loadState();
    expect(loaded?.myMemo).toBe('면회 준비물: 편지, 간식');
    expect(loaded?.myMemoOwnerId).toBe('user-a');
  });

  it('메모는 소유자 id와 함께 저장된다', async () => {
    const repo = new LocalStorageRepository();
    await repo.saveState(stateWith({ myMemo: '메모', myMemoOwnerId: 'user-a' }));
    const raw = JSON.parse(storage.raw(STORE_KEY) as string);
    expect(raw.myMemo).toBe('메모');
    expect(raw.myMemoOwnerId).toBe('user-a');
  });

  it('저장된 값이 없으면 null을 반환한다', async () => {
    const repo = new LocalStorageRepository();
    expect(await repo.loadState()).toBeNull();
  });

  it('레거시 v1 키는 불러올 때 제거된다', async () => {
    storage.setItem('gomsinlog.state.v1', JSON.stringify({ myMemo: 'v1 메모' }));
    const repo = new LocalStorageRepository();
    await repo.loadState();
    expect(storage.getItem('gomsinlog.state.v1')).toBeNull();
  });

  it('깨진 JSON이 저장돼 있어도 예외를 던지지 않는다', async () => {
    storage.setItem(STORE_KEY, '{not json');
    const repo = new LocalStorageRepository();
    await expect(repo.loadState()).resolves.toBeNull();
  });
});

describe('메모 사용자별 격리 (같은 기기, 다른 계정)', () => {
  it('A가 남긴 메모는 B가 로그인하면 보이지 않는다', async () => {
    const repo = new LocalStorageRepository();
    // 사용자 A가 메모를 남기고 기기에 저장
    await repo.saveState(stateWith({ myMemo: 'A의 비밀 메모', myMemoOwnerId: 'user-a' }));

    // 같은 기기에서 사용자 B가 로그인 → 하이드레이션 후 소유자 확인
    const loaded = await repo.loadState();
    const resolved = resolveMemoOwnership(loaded as AppState, 'user-b');

    expect(resolved.myMemo).toBe('');
    expect(resolved.myMemoOwnerId).toBe('user-b');
  });

  it('A가 다시 로그인하면 A의 메모는 그대로 남아 있다', async () => {
    const repo = new LocalStorageRepository();
    await repo.saveState(stateWith({ myMemo: 'A의 메모', myMemoOwnerId: 'user-a' }));

    const loaded = await repo.loadState();
    const resolved = resolveMemoOwnership(loaded as AppState, 'user-a');

    expect(resolved.myMemo).toBe('A의 메모');
  });

  it('B의 메모를 저장하면 A의 메모는 기기에서 사라진다', async () => {
    const repo = new LocalStorageRepository();
    await repo.saveState(stateWith({ myMemo: 'A의 메모', myMemoOwnerId: 'user-a' }));

    const loaded = (await repo.loadState()) as AppState;
    const forB = { ...loaded, ...resolveMemoOwnership(loaded, 'user-b') };
    await repo.saveState(forB);

    const reloaded = await repo.loadState();
    expect(reloaded?.myMemo).toBe('');
    expect(reloaded?.myMemoOwnerId).toBe('user-b');
    expect(storage.raw(STORE_KEY)).not.toContain('A의 메모');
  });
});

describe('비공개 기록 마스킹', () => {
  const privateRecord: DailyRecord = {
    id: 'p1',
    date: '2026-08-05',
    time: '23:00',
    authorRole: 'gomsin',
    log: '아무에게도 말 못한 이야기',
    isPrivate: true,
    createdAt: '2026-08-05T23:00:00.000Z',
    attachments: [{ type: 'photo', name: 'secret.jpg', url: 'https://example.test/secret.jpg' }],
    emotionFlow: [
      { sequence: 1, group: 'sadness', displayLabel: '슬픔', source: 'user_confirmed' },
    ],
  };

  const sharedRecord: DailyRecord = {
    id: 's1',
    date: '2026-08-05',
    time: '09:00',
    authorRole: 'gomsin',
    log: '공유해도 되는 이야기',
    isPrivate: false,
    createdAt: '2026-08-05T09:00:00.000Z',
  };

  it('비공개 기록의 본문·첨부·감정은 localStorage에 남지 않는다', async () => {
    const repo = new LocalStorageRepository();
    await repo.saveState(stateWith({ records: [privateRecord, sharedRecord] }));

    const raw = storage.raw(STORE_KEY) as string;
    expect(raw).not.toContain('아무에게도 말 못한 이야기');
    expect(raw).not.toContain('secret.jpg');
    expect(raw).not.toContain('슬픔');
    // 공유 기록은 그대로 캐시된다
    expect(raw).toContain('공유해도 되는 이야기');
  });

  it('비공개 기록의 식별 정보(날짜·시간·작성자)는 유지된다', async () => {
    const repo = new LocalStorageRepository();
    await repo.saveState(stateWith({ records: [privateRecord] }));

    const loaded = await repo.loadState();
    const cached = loaded?.records.find((r) => r.id === 'p1');
    expect(cached).toMatchObject({
      id: 'p1',
      date: '2026-08-05',
      time: '23:00',
      isPrivate: true,
      authorRole: 'gomsin',
    });
    expect(cached?.log).toBeUndefined();
    expect(cached?.attachments).toBeUndefined();
  });
});

describe('예시(가짜) 날짜 회귀 방지', () => {
  const FAKE_DATES = ['2024-02-14', '2025-03-10', '2026-09-09', '2024-12-24'];
  const SRC = join(process.cwd(), 'src');

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : [];
    });
  }

  it('제거한 예시 날짜 리터럴이 소스에 다시 등장하지 않는다', () => {
    const offenders: string[] = [];
    for (const filePath of walk(SRC)) {
      const content = readFileSync(filePath, 'utf8');
      for (const fake of FAKE_DATES) {
        if (content.includes(fake)) {
          offenders.push(`${filePath.replace(process.cwd() + '/', '')} → ${fake}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('기본 상태에는 어떤 날짜 문자열도 들어 있지 않다', () => {
    const serialized = JSON.stringify({
      couple: DEFAULT_STATE.profile.couple,
      military: DEFAULT_STATE.profile.military,
    });
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
