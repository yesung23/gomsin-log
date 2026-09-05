import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRecordMediaMutationJournalEntry,
  getOrCreateRecordMediaMutationOwnerToken,
  listRecordMediaMutationJournalEntries,
  purgeRecordMediaMutationJournalForUser,
  writeRecordMediaMutationJournalEntry,
} from '@/lib/recordMediaMutationJournal';

const operationA = {
  operationId: 'operation-a',
  recordId: 'record-a',
  userId: 'user-a',
  coupleId: 'couple-a',
};

describe('record media mutation recovery journal', () => {
  beforeEach(() => localStorage.clear());

  it('reuses one opaque owner token across a same-tab refresh', () => {
    sessionStorage.clear();
    expect(getOrCreateRecordMediaMutationOwnerToken(sessionStorage, () => 'tab-a')).toBe('tab-a');
    expect(getOrCreateRecordMediaMutationOwnerToken(sessionStorage, () => 'tab-b')).toBe('tab-a');
  });

  it('durably stores only opaque operation identity and restores it for the same account and owner', () => {
    expect(writeRecordMediaMutationJournalEntry(operationA, 'tab-a', localStorage, 123)).toBe(true);

    expect(listRecordMediaMutationJournalEntries('user-a', 'tab-a', localStorage)).toEqual([{
      version: 1,
      ...operationA,
      ownerToken: 'tab-a',
      createdAtMs: 123,
    }]);
    expect(listRecordMediaMutationJournalEntries('user-a', 'tab-b', localStorage)).toEqual([]);
    expect(JSON.stringify(localStorage)).not.toContain('photo');
  });

  it('does not expose another account and ignores corrupt or identity-mismatched values', () => {
    writeRecordMediaMutationJournalEntry(operationA, 'tab-a', localStorage, 123);
    writeRecordMediaMutationJournalEntry({
      ...operationA,
      operationId: 'operation-b',
      userId: 'user-b',
    }, 'tab-a', localStorage, 124);
    localStorage.setItem('gomsin.record-media-operation.v1.user-a.corrupt', '{bad');
    localStorage.setItem('gomsin.record-media-operation.v1.user-a.mismatch', JSON.stringify({
      version: 1,
      ...operationA,
      operationId: 'different',
      ownerToken: 'tab-a',
      createdAtMs: 125,
    }));

    expect(listRecordMediaMutationJournalEntries('user-a', 'tab-a', localStorage))
      .toEqual([expect.objectContaining({ operationId: 'operation-a' })]);
  });

  it('clears only the exact matching operation identity', () => {
    writeRecordMediaMutationJournalEntry(operationA, 'tab-a', localStorage, 123);
    expect(clearRecordMediaMutationJournalEntry({
      ...operationA,
      recordId: 'wrong-record',
    }, localStorage)).toBe(false);
    expect(listRecordMediaMutationJournalEntries('user-a', 'tab-a', localStorage)).toHaveLength(1);

    expect(clearRecordMediaMutationJournalEntry(operationA, localStorage)).toBe(true);
    expect(listRecordMediaMutationJournalEntries('user-a', 'tab-a', localStorage)).toEqual([]);
  });

  it('purges one account without touching another account journal', () => {
    writeRecordMediaMutationJournalEntry(operationA, 'tab-a', localStorage, 123);
    writeRecordMediaMutationJournalEntry({
      ...operationA,
      operationId: 'operation-b',
      userId: 'user-b',
    }, 'tab-b', localStorage, 124);
    localStorage.setItem('gomsin.record-media-operation.v1.user-a.corrupt', '{bad');

    expect(purgeRecordMediaMutationJournalForUser('user-a', localStorage)).toBe(true);
    expect(listRecordMediaMutationJournalEntries('user-a', 'tab-a', localStorage)).toEqual([]);
    expect(localStorage.getItem('gomsin.record-media-operation.v1.user-a.corrupt')).toBeNull();
    expect(listRecordMediaMutationJournalEntries('user-b', 'tab-b', localStorage)).toHaveLength(1);
  });

  it('fails closed when durable storage cannot confirm the journal write', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    } as Pick<Storage, 'getItem' | 'setItem'>;

    expect(writeRecordMediaMutationJournalEntry(
      operationA,
      'tab-a',
      storage as Storage,
      123,
    )).toBe(false);
  });
});
