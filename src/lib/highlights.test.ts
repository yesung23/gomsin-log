import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRpc, mockSupabase } = vi.hoisted(() => {
  const mockRpc = vi.fn();
  return { mockRpc, mockSupabase: { rpc: mockRpc } };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));
vi.mock('@/lib/accountDeletion', () => ({
  serverCallBlockedByPendingDeletion: vi.fn().mockResolvedValue(false),
}));

import { saveCoupleHighlightToDB } from '@/lib/highlights';

describe('couple highlight persistence contract', () => {
  beforeEach(() => mockRpc.mockReset());

  it('sends the selected cover first and never trusts a client couple id', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'highlight-1',
        couple_id: 'couple-1',
        title: '우리의 여름',
        sort_order: 0,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
        couple_highlight_items: [],
      },
      error: null,
    });

    const result = await saveCoupleHighlightToDB({
      coupleId: 'couple-1',
      title: '우리의 여름',
      recordIds: ['record-a', 'record-b'],
      coverRecordId: 'record-b',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.highlight?.coverRecordId).toBe('record-b');
    expect(result.ok && result.highlight?.recordIds).toEqual(['record-b', 'record-a']);
    expect(mockRpc).toHaveBeenCalledWith('save_couple_highlight', {
      p_highlight_id: null,
      p_title: '우리의 여름',
      p_record_ids: ['record-b', 'record-a'],
      p_sort_order: 0,
    });
  });

  it('rejects an unselected cover before any server request', async () => {
    const result = await saveCoupleHighlightToDB({
      coupleId: 'couple-1',
      title: '테스트',
      recordIds: ['record-a'],
      coverRecordId: 'record-b',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
