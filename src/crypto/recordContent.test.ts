import { describe, expect, it } from 'vitest';

import { utf8 } from './bytes';
import { KEY_DOMAIN } from './domains';
import { FIELD_ID, GLE1_HEADER_LENGTH, GLE1_OFFSET, OBJECT_TYPE, decodeHeader } from './gle1';
import {
  RECORD_DOCUMENT_VERSION,
  decodeRecordDocument,
  domainForRecord,
  encodeRecordDocument,
  openRecordContent,
  recordAad,
  scopeIdForRecord,
  sealRecordContent,
  type RecordContentDocument,
} from './recordContent';
import { AES_KEY_BYTES, importAesKey } from './suite';

const OWNER = '11111111-2222-4333-8444-555555555555';
const PARTNER = '99999999-2222-4333-8444-555555555555';
const COUPLE = 'aaaaaaaa-2222-4333-8444-555555555555';
const RECORD = 'bbbbbbbb-2222-4333-8444-555555555555';

async function key(seed: number): Promise<CryptoKey> {
  return importAesKey(new Uint8Array(AES_KEY_BYTES).fill(seed), ['encrypt', 'decrypt']);
}

const document: RecordContentDocument = {
  log: '오늘은 눈이 왔어. 네 생각이 났어.',
  reaction: 'thought_of_you',
  attachments: [{ type: 'photo', name: 'snow.jpg', path: `${COUPLE}/${RECORD}/snow.jpg` }],
  emotionFlow: [{ emotion: 'longing', source: 'user_confirmed' }],
  time: '21:14',
};

const shared = {
  isPrivate: false,
  recordId: RECORD,
  ownerUserId: OWNER,
  coupleId: COUPLE,
  keyEpoch: 3n,
  contentRevision: 1n,
};

describe('record routing', () => {
  it('routes a private record to the personal domain and a shared one to the couple domain', () => {
    expect(domainForRecord(true)).toBe('personal');
    expect(domainForRecord(false)).toBe('couple');
  });

  it('never routes a record to the health domain', () => {
    // HRK must never stand in for PMK or CSK. The type makes it unrepresentable;
    // this pins the runtime values too, because the DB refuses `health` outright.
    expect(['personal', 'couple']).toContain(domainForRecord(true));
    expect(['personal', 'couple']).toContain(domainForRecord(false));
  });

  it('scopes a private record to the author and a shared one to the couple', () => {
    expect(scopeIdForRecord(true, OWNER, COUPLE)).toBe(OWNER);
    expect(scopeIdForRecord(false, OWNER, COUPLE)).toBe(COUPLE);
  });

  it('binds the record object type and one field id into the AAD', () => {
    const aad = recordAad(shared);
    expect(aad.objectType).toBe(OBJECT_TYPE.dailyRecord);
    expect(aad.fieldId).toBe(FIELD_ID.logText);
    expect(aad.domain).toBe(KEY_DOMAIN.couple);
  });

  it('uses the personal domain and the owner scope for a private record AAD', () => {
    const aad = recordAad({ ...shared, isPrivate: true });
    expect(aad.domain).toBe(KEY_DOMAIN.personal);
    expect(aad.scopeId).toEqual(recordAad({ ...shared, isPrivate: true }).ownerUserId);
  });
});

describe('the content document', () => {
  it('round-trips every protected field', () => {
    expect(decodeRecordDocument(encodeRecordDocument(document))).toEqual(document);
  });

  it('omits absent fields rather than encoding null', () => {
    const encoded = new TextDecoder().decode(encodeRecordDocument({ log: '짧게' }));
    expect(encoded).not.toContain('reaction');
    expect(encoded).not.toContain('time');
    expect(encoded).not.toContain('null');
  });

  it('is byte-identical regardless of key insertion order', () => {
    const a = encodeRecordDocument({ log: 'x', time: '01:00', reaction: 'good' });
    const b = encodeRecordDocument({ reaction: 'good', time: '01:00', log: 'x' });
    expect(a).toEqual(b);
  });

  it('refuses a document from a newer version instead of dropping its fields', () => {
    const future = utf8(JSON.stringify({ v: RECORD_DOCUMENT_VERSION + 1, log: 'x' }));
    expect(() => decodeRecordDocument(future)).toThrow(/E_DOCUMENT_VERSION/);
  });

  it('refuses malformed input', () => {
    expect(() => decodeRecordDocument(utf8('not json'))).toThrow(/E_DOCUMENT_MALFORMED/);
    expect(() => decodeRecordDocument(utf8('[]'))).toThrow(/E_DOCUMENT_MALFORMED/);
    expect(() => decodeRecordDocument(utf8(JSON.stringify({ v: 1 })))).toThrow(/E_DOCUMENT_MALFORMED/);
  });
});

describe('sealing and opening a record', () => {
  it('round-trips under the right key', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document });
    await expect(openRecordContent({ ...shared, scopeKey, envelope })).resolves.toEqual(document);
  });

  it('writes the routed domain and epoch into the envelope header', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document });
    const header = decodeHeader(envelope);
    // Migration 039 reads exactly these two header fields back and compares them
    // to the routing columns, so the header must genuinely carry them.
    expect(header.domain).toBe(KEY_DOMAIN.couple);
    expect(header.keyEpoch).toBe(3n);
    expect(envelope[GLE1_OFFSET.domain]).toBe(KEY_DOMAIN.couple);
  });

  it('produces an envelope of the length migration 039 requires', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document: { log: '' } });
    // 92-byte header + tag, so the shortest possible record is 108 bytes and the
    // column CHECK in 039 is satisfiable rather than a floor nothing can meet.
    expect(envelope.length).toBeGreaterThanOrEqual(GLE1_HEADER_LENGTH + 16);
    expect(envelope.length).toBeGreaterThanOrEqual(108);
  });

  it('cannot be opened with a different scope key', async () => {
    const envelope = await sealRecordContent({ ...shared, scopeKey: await key(7), document });
    await expect(openRecordContent({ ...shared, scopeKey: await key(8), envelope })).rejects.toThrow();
  });

  it('cannot be moved onto another record id', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document });
    await expect(openRecordContent({
      ...shared, scopeKey, envelope, recordId: '00000000-2222-4333-8444-555555555555',
    })).rejects.toThrow();
  });

  it('cannot be moved to another couple', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document });
    await expect(openRecordContent({
      ...shared, scopeKey, envelope, coupleId: '00000000-2222-4333-8444-555555555555',
    })).rejects.toThrow();
  });

  it('cannot be moved to another owner', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document });
    await expect(openRecordContent({ ...shared, scopeKey, envelope, ownerUserId: PARTNER }))
      .rejects.toThrow();
  });

  it('cannot be replayed at an older revision', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, contentRevision: 4n, document });
    await expect(openRecordContent({ ...shared, scopeKey, envelope, contentRevision: 3n }))
      .rejects.toThrow();
  });

  it('cannot be reinterpreted as a private record', async () => {
    // A shared record's ciphertext must not authenticate as a private one: the
    // domain and the scope both change, and both are bound.
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document });
    await expect(openRecordContent({ ...shared, scopeKey, envelope, isPrivate: true }))
      .rejects.toThrow();
  });

  it('cannot be opened under a different epoch', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document });
    await expect(openRecordContent({ ...shared, scopeKey, envelope, keyEpoch: 4n }))
      .rejects.toThrow();
  });

  it('leaves no plaintext in the envelope bytes', async () => {
    const scopeKey = await key(7);
    const envelope = await sealRecordContent({ ...shared, scopeKey, document });
    const asText = new TextDecoder('utf-8', { fatal: false }).decode(envelope);
    expect(asText).not.toContain('눈이 왔어');
    expect(asText).not.toContain('thought_of_you');
    expect(asText).not.toContain('snow.jpg');
    expect(asText).not.toContain('21:14');
    expect(asText).not.toContain('longing');
  });
});
