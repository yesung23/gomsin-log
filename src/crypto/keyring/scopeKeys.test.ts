import { describe, expect, it } from 'vitest';
import { uuidToBytes } from '@/crypto/bytes';
import { KEY_DOMAIN, RECIPIENT_KIND } from '@/crypto/domains';
import { generateEphemeralAgreement } from '@/crypto/suite';
import {
  provisionScopeKeyToRecipient,
  sealScopeKeyForRecipient,
} from '@/crypto/keyring/scopeKeys';
import {
  addEnrolledDevice,
  createTestAccount,
  deriveWith,
  signWith,
} from '@/crypto/testing/virtualAccount';

describe('scope-key provisioning trust boundary', () => {
  it('rejects a GLK2 envelope whose exact scope does not match the requested scope', async () => {
    const account = await createTestAccount({ grantedDomains: ['couple'] });
    const sender = account.devices[0];
    const recipient = await addEnrolledDevice(account, sender, { grantedDomains: ['couple'] });
    const scopeKey = new Uint8Array(32).fill(9);
    const actual = {
      domain: KEY_DOMAIN.couple,
      scopeKeyId: uuidToBytes('11111111-1111-4111-8111-111111111111'),
      ownerUserId: account.userId,
      scopeId: uuidToBytes('22222222-2222-4222-8222-222222222222'),
      epoch: 1n,
    } as const;
    const wrongScope = {
      ...actual,
      scopeId: uuidToBytes('33333333-3333-4333-8333-333333333333'),
    };
    const ownEnvelope = await sealScopeKeyForRecipient({
      scopeKey,
      recipientKemSpki: sender.kem.spki,
      recipientId: sender.deviceId,
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: sender.deviceId,
      senderSigSpki: sender.sig.spki,
      sign: (message) => signWith(sender.sig, message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header: actual,
      nowMs: 1n,
    });

    await expect(provisionScopeKeyToRecipient({
      ownEnvelope,
      ownKemSpki: sender.kem.spki,
      ownEnvelopeSenderSigSpki: sender.sig.spki,
      deriveSecret: (peer) => deriveWith(sender.kem, peer),
      recipientKemSpki: recipient.kem.spki,
      recipientId: recipient.deviceId,
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: sender.deviceId,
      senderSigSpki: sender.sig.spki,
      sign: (message) => signWith(sender.sig, message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header: wrongScope,
      nowMs: 2n,
    })).rejects.toThrow(/E_SCOPE_ID_MISMATCH/);
  });

  it('rejects a couple re-wrap whose requested owner is not the canonical transcript owner', async () => {
    const account = await createTestAccount({ grantedDomains: ['couple'] });
    const sender = account.devices[0];
    const recipient = await addEnrolledDevice(account, sender, { grantedDomains: ['couple'] });
    const header = {
      domain: KEY_DOMAIN.couple,
      scopeKeyId: uuidToBytes('11111111-1111-4111-8111-111111111111'),
      ownerUserId: uuidToBytes('22222222-2222-4222-8222-222222222222'),
      scopeId: uuidToBytes('33333333-3333-4333-8333-333333333333'),
      epoch: 1n,
    } as const;
    const ownEnvelope = await sealScopeKeyForRecipient({
      scopeKey: new Uint8Array(32).fill(7),
      recipientKemSpki: sender.kem.spki,
      recipientId: sender.deviceId,
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: sender.deviceId,
      senderSigSpki: sender.sig.spki,
      sign: (message) => signWith(sender.sig, message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header,
      nowMs: 1n,
    });
    await expect(provisionScopeKeyToRecipient({
      ownEnvelope,
      ownKemSpki: sender.kem.spki,
      ownEnvelopeSenderSigSpki: sender.sig.spki,
      deriveSecret: (peer) => deriveWith(sender.kem, peer),
      recipientKemSpki: recipient.kem.spki,
      recipientId: recipient.deviceId,
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: sender.deviceId,
      senderSigSpki: sender.sig.spki,
      sign: (message) => signWith(sender.sig, message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header: { ...header, ownerUserId: uuidToBytes('44444444-4444-4444-8444-444444444444') },
      nowMs: 2n,
    })).rejects.toThrow(/E_OWNER_MISMATCH/);
  });
});
