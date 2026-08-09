import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clearAllAvatars,
  clearAvatar,
  prepareAvatarFile,
  readAvatar,
  writeAvatar,
} from '@/lib/avatarImage';

/**
 * Avatar photos are the first thing this app stores that is a picture OF someone,
 * so the tests that matter are the ones about it not outliving its welcome.
 *
 * Kept out of `AppState` on purpose: `saveState` persists a four-key
 * device-preference whitelist for an authenticated user, and `themeTokens`-style
 * tests assert that list exactly. Image data in there would break the guarantee the
 * whitelist exists to give. The price of the separation is that the purge has to
 * clear these keys explicitly, which is what most of this file checks.
 */

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('avatar storage is per user and per slot', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a value for one user and slot', () => {
    writeAvatar('user-a', 'couple', 'data:image/jpeg;base64,AAA');
    expect(readAvatar('user-a', 'couple')).toBe('data:image/jpeg;base64,AAA');
  });

  it('never leaks one account\'s photo into another', () => {
    // The failure this prevents: signing in as someone else on a shared device and
    // finding the previous person's face already on 마이.
    writeAvatar('user-a', 'me', 'data:image/jpeg;base64,AAA');
    expect(readAvatar('user-b', 'me')).toBeNull();
  });

  it('keeps the two slots independent', () => {
    writeAvatar('user-a', 'couple', 'data:image/jpeg;base64,CCC');
    writeAvatar('user-a', 'me', 'data:image/jpeg;base64,MMM');
    expect(readAvatar('user-a', 'couple')).toBe('data:image/jpeg;base64,CCC');
    expect(readAvatar('user-a', 'me')).toBe('data:image/jpeg;base64,MMM');
    clearAvatar('user-a', 'couple');
    expect(readAvatar('user-a', 'couple')).toBeNull();
    expect(readAvatar('user-a', 'me')).toBe('data:image/jpeg;base64,MMM');
  });

  it('does nothing at all without a user id, rather than using a shared key', () => {
    expect(writeAvatar(undefined, 'me', 'data:image/jpeg;base64,AAA')).toBe(false);
    expect(readAvatar(undefined, 'me')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('reports a failed write instead of pretending it saved', () => {
    /*
     * A full quota is the realistic cause -- a data URL is the largest thing this
     * app writes to storage -- and the UI shows a different message for it, so the
     * boolean has to be honest rather than optimistic.
     *
     * Spied on `Object.getPrototypeOf(localStorage)`, not on the global
     * `Storage.prototype`. Under Node 26 the global `localStorage` is Node's own
     * implementation, and its prototype is a DIFFERENT `Storage` object from the one
     * jsdom exposes as a global -- so a `Storage.prototype` spy never intercepts the
     * call and the test would pass while asserting nothing.
     */
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const setItem = vi.spyOn(proto, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(writeAvatar('user-a', 'me', 'data:image/jpeg;base64,AAA')).toBe(false);
    setItem.mockRestore();
  });

  it('survives storage being unreadable, because an avatar is decoration', () => {
    // Private-mode Safari throws on read. Same prototype reason as above.
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const getItem = vi.spyOn(proto, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readAvatar('user-a', 'me')).toBeNull();
    getItem.mockRestore();
  });
});

describe('the purge reaches avatars, including a previous account\'s', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears every stored avatar for every user on the device', () => {
    /*
     * Iterating the keyspace rather than deleting two known keys is the whole point:
     * a purge runs on sign-out and on account deletion, and at that moment the id
     * still holding a photo may belong to an account that is already gone from
     * state. Deleting `avatar.me.<currentUser>` would leave the other one behind.
     */
    writeAvatar('user-a', 'me', 'data:image/jpeg;base64,AAA');
    writeAvatar('user-a', 'couple', 'data:image/jpeg;base64,BBB');
    writeAvatar('user-b', 'me', 'data:image/jpeg;base64,CCC');
    localStorage.setItem('gomsinlog.state.v2', '{"theme":"dark"}');

    clearAllAvatars();

    expect(readAvatar('user-a', 'me')).toBeNull();
    expect(readAvatar('user-a', 'couple')).toBeNull();
    expect(readAvatar('user-b', 'me')).toBeNull();
    // Unrelated keys are not collateral damage.
    expect(localStorage.getItem('gomsinlog.state.v2')).toBe('{"theme":"dark"}');
  });

  it('is actually wired into the store purge, not merely exported', () => {
    // The regression this catches is a silent one: the module keeps working, and a
    // face simply outlives the account. Asserted at the call site because there is
    // no observable behaviour to test from outside the store.
    const store = read('src/lib/store.tsx');
    expect(store).toContain('clearAllAvatars()');
    expect(store).toContain("from '@/lib/avatarImage'");
  });

  it('stores under its own key prefix, outside the persisted store blob', () => {
    writeAvatar('user-a', 'me', 'data:image/jpeg;base64,AAA');
    const keys = Object.keys(localStorage);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^gomsinlog\.avatar\./);
    // Must not be inside the store key, whose contents are whitelisted.
    expect(keys[0]).not.toBe('gomsinlog.state.v2');
  });
});

describe('an image is validated before it is decoded', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a type no browser canvas can decode', async () => {
    // HEIC is the common one: iPhone default, and `drawImage` cannot read it.
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.heic', { type: 'image/heic' });
    const result = await prepareAvatarFile(file);
    expect(result).toEqual({ error: expect.stringContaining('형식') });
  });

  it('rejects an oversized original before touching the main thread', async () => {
    /*
     * Checked by `size` rather than after decode, deliberately: a 40 MB photo stalls
     * the main thread during decode, so the guard has to come first to be useful.
     */
    const big = new File([new Uint8Array(13 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    const result = await prepareAvatarFile(big);
    expect(result).toEqual({ error: expect.stringContaining('12MB') });
  });

  it('reports a decode failure as a readable message, not a thrown error', async () => {
    /*
     * jsdom neither loads nor fails an image: assigning `src` fires nothing, so the
     * promise in `loadImage` would hang forever and this test would time out rather
     * than fail. So `onerror` is driven directly, which is exactly what a corrupt
     * file does in a browser.
     */
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_value: string) {
        // Fires on assignment, the same order a browser uses for a corrupt file.
        // A plain class rather than a spy on `globalThis.Image`: `HTMLImageElement`
        // getters reject a `this` that is not a real element, so calling
        // `this.onerror` on a spied instance throws out of band.
        queueMicrotask(() => this.onerror?.());
      }
    }
    const OriginalImage = globalThis.Image;
    globalThis.Image = FailingImage as unknown as typeof Image;

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    const result = await prepareAvatarFile(file);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('사진');
    globalThis.Image = OriginalImage;
  });
});

describe('the module documents why the photo is not uploaded', () => {
  it('names the storage-policy constraint rather than leaving it to be rediscovered', () => {
    /*
     * This is the decision most likely to be reopened -- "why is it not synced?" --
     * and the answer is a specific policy shape, not a preference: migration 007
     * scopes `couple-media` to `coupleId/recordId` and its INSERT policy requires a
     * matching `daily_records` row, which an avatar has none of.
     */
    const source = read('src/lib/avatarImage.ts');
    expect(source).toContain('couple-media');
    expect(source).toContain('daily_records');
    expect(source).toMatch(/does not sync/i);
  });
});
