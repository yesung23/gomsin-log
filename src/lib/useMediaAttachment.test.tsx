import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import type { Attachment } from '@/types';

/**
 * Bug condition:
 *   isBugCondition(hook) = an attachment whose signed URL has expired stays broken
 *                          with no recovery, OR a refusal becomes a request loop.
 *
 * `SIGNED_URL_TTL_SECONDS` is 3600 and URLs are signed once, at fetch time, then
 * held in React state. This app is a PWA people leave open: an hour into a session
 * every attachment URL is refused by Storage, and nothing re-signed them.
 *
 * ## Why this suite lives here and not on a component
 *
 * These behaviours used to be pinned through `AttachmentMedia`, a component that
 * had already fallen out of every production path -- so the only coverage of the
 * recovery logic was reached through dead code, while the three components that
 * actually ship it (`RecordMediaGallery`, `MediaArchiveGrid`, `MonthGrid`) had
 * none. Deleting that component as scheduled would have silently taken the
 * coverage with it. Testing the hook directly is what all three share.
 */

const resolveAttachmentUrls = vi.fn<
  (attachments: Attachment[], coupleId: string, recordId: string) => Promise<Attachment[]>
>();

vi.mock('@/lib/records', () => ({
  resolveAttachmentUrls: (...args: Parameters<typeof resolveAttachmentUrls>) =>
    resolveAttachmentUrls(...args),
}));

const { useMediaAttachment } = await import('@/lib/useMediaAttachment');

const COUPLE = 'couple-1';
const RECORD = 'rec-1';
const FIRST = 'https://example.supabase.co/signed/voice?token=first';
const SECOND = 'https://example.supabase.co/signed/voice?token=second';
const THUMBNAIL = 'https://example.supabase.co/signed/thumb?token=first';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    type: 'voice',
    name: '음성기록-1.webm',
    url: FIRST,
    path: `${COUPLE}/${RECORD}/voice.webm`,
    ...overrides,
  };
}

function photoWithThumbnail(overrides: Partial<Attachment> = {}): Attachment {
  return attachment({
    type: 'photo',
    name: '사진.jpg',
    path: `${COUPLE}/${RECORD}/33333333-3333-4333-8333-333333333333.jpg`,
    url: FIRST,
    photoRendition: {
      sourceRevision: '55555555-5555-4555-8555-555555555555',
      screenMaster: {
        mediaObjectId: '33333333-3333-4333-8333-333333333333',
        widthPx: 2048,
        heightPx: 1536,
        byteSize: 900_000,
        sha256: 'a'.repeat(64),
        mimeType: 'image/jpeg',
      },
      thumbnail: {
        mediaObjectId: '44444444-4444-4444-8444-444444444444',
        widthPx: 640,
        heightPx: 480,
        byteSize: 90_000,
        sha256: 'b'.repeat(64),
        mimeType: 'image/jpeg',
        path: `${COUPLE}/${RECORD}/44444444-4444-4444-8444-444444444444.jpg`,
        url: THUMBNAIL,
      },
    },
    ...overrides,
  });
}

/*
  `coupleId` is NOT a defaulted parameter. A default is not overridden by an
  explicit `undefined`, so the "no couple space yet" case below would silently
  render with a couple id and assert nothing.
*/
function renderOne(att: Attachment = attachment(), coupleId?: string) {
  return renderHook(
    ({ a, c }: { a: Attachment; c: string | undefined }) => useMediaAttachment(a, c, RECORD),
    { initialProps: { a: att, c: coupleId } },
  );
}

function renderThumbnail(att: Attachment = photoWithThumbnail(), coupleId?: string) {
  return renderHook(
    ({ a, c }: { a: Attachment; c: string | undefined }) =>
      useMediaAttachment(a, c, RECORD, 'thumbnail'),
    { initialProps: { a: att, c: coupleId } },
  );
}

beforeEach(() => {
  resolveAttachmentUrls.mockReset();
});

describe('the explicit thumbnail variant', () => {
  it('uses the authorized thumbnail URL while the default variant stays on master', () => {
    const thumbnail = renderThumbnail(photoWithThumbnail(), COUPLE);
    const master = renderOne(photoWithThumbnail(), COUPLE);

    expect(thumbnail.result.current.url).toBe(THUMBNAIL);
    expect(master.result.current.url).toBe(FIRST);
  });

  it.each([
    'auth_expired',
    'forbidden',
    'not_found',
    'offline',
    'unreachable',
    'server',
    'unknown',
  ] as const)('blocks both variants when metadata authority is unavailable: %s', (reason) => {
    const blocked = photoWithThumbnail({
      photoMetadataUnavailable: reason,
      urlUnavailable: reason,
    });
    const thumbnail = renderThumbnail(blocked, COUPLE);
    const master = renderOne(blocked, COUPLE);

    expect(thumbnail.result.current).toMatchObject({ url: undefined, unavailable: reason });
    expect(master.result.current).toMatchObject({ url: undefined, unavailable: reason });
    act(() => thumbnail.result.current.reportLoadFailure());
    act(() => master.result.current.reportLoadFailure());
    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
  });

  it('does not expose master bytes after a thumbnail transport failure', async () => {
    resolveAttachmentUrls.mockResolvedValueOnce([{
      type: 'photo',
      name: '사진.jpg',
      path: `${COUPLE}/${RECORD}/44444444-4444-4444-8444-444444444444.jpg`,
      urlUnavailable: 'unreachable',
    }]);
    const { result } = renderThumbnail(photoWithThumbnail(), COUPLE);

    act(() => result.current.reportLoadFailure());

    await waitFor(() => expect(result.current.unavailable).toBe('unreachable'));
    expect(result.current.url).toBeUndefined();
    expect(resolveAttachmentUrls).toHaveBeenCalledTimes(1);
  });

  it('does not expose the master URL after a thumbnail permission denial', async () => {
    resolveAttachmentUrls.mockResolvedValueOnce([{
      type: 'photo',
      name: '사진.jpg',
      path: `${COUPLE}/${RECORD}/44444444-4444-4444-8444-444444444444.jpg`,
      urlUnavailable: 'forbidden',
    }]);
    const { result } = renderThumbnail(photoWithThumbnail(), COUPLE);

    act(() => result.current.reportLoadFailure());

    await waitFor(() => expect(result.current.unavailable).toBe('forbidden'));
    expect(result.current.url).toBeUndefined();
  });

  it('rejects a late response from an older source revision', async () => {
    let finish!: (value: Attachment[]) => void;
    resolveAttachmentUrls.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderThumbnail(photoWithThumbnail(), COUPLE);
    act(() => result.current.reportLoadFailure());
    const newer = photoWithThumbnail({
      photoRendition: {
        ...photoWithThumbnail().photoRendition!,
        sourceRevision: '77777777-7777-4777-8777-777777777777',
        thumbnail: {
          ...photoWithThumbnail().photoRendition!.thumbnail,
          url: 'https://example.test/new-generation-thumbnail',
        },
      },
    });

    rerender({ a: newer, c: COUPLE });
    await act(async () => finish([{
      type: 'photo', name: '사진.jpg', path: photoWithThumbnail().photoRendition!.thumbnail.path,
      url: 'https://example.test/stale-thumbnail',
    }]));

    expect(result.current.url).toBe('https://example.test/new-generation-thumbnail');
  });

  it('clears a stale thumbnail on denied refresh and bypasses hook retry', async () => {
    const { result, rerender } = renderThumbnail(photoWithThumbnail(), COUPLE);
    expect(result.current.url).toBe(THUMBNAIL);

    rerender({
      a: photoWithThumbnail({
        url: undefined,
        urlUnavailable: 'forbidden',
        photoRendition: undefined,
      }),
      c: COUPLE,
    });

    expect(result.current.url).toBeUndefined();
    expect(result.current.unavailable).toBe('forbidden');
    act(() => result.current.reportLoadFailure());
    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
  });
});

describe('an expired signed URL recovers instead of staying broken', () => {
  it('re-signs once on the first reported failure and hands back the fresh URL', async () => {
    resolveAttachmentUrls.mockResolvedValue([attachment({ url: SECOND })]);
    const { result } = renderOne(attachment(), COUPLE);

    act(() => result.current.reportLoadFailure());

    await waitFor(() => expect(result.current.url).toBe(SECOND));
    expect(resolveAttachmentUrls).toHaveBeenCalledTimes(1);
    // Signing goes through the same path the initial fetch used, scoped to this
    // couple and record, so the Storage SELECT policy still decides what is viewable.
    expect(resolveAttachmentUrls.mock.calls[0][1]).toBe(COUPLE);
    expect(resolveAttachmentUrls.mock.calls[0][2]).toBe(RECORD);
    expect(result.current.unavailable).toBeUndefined();
  });

  it('does not loop: repeated failures of the SAME url re-sign only once', async () => {
    resolveAttachmentUrls.mockResolvedValue([attachment({ url: SECOND })]);
    const { result } = renderOne(attachment(), COUPLE);

    act(() => {
      result.current.reportLoadFailure();
      result.current.reportLoadFailure();
      result.current.reportLoadFailure();
    });

    await waitFor(() => expect(result.current.url).toBe(SECOND));
    expect(resolveAttachmentUrls).toHaveBeenCalledTimes(1);
  });

  it('gives up honestly when re-signing produces nothing usable', async () => {
    resolveAttachmentUrls.mockResolvedValue([
      attachment({ url: undefined, urlUnavailable: 'forbidden' }),
    ]);
    const { result } = renderOne(attachment(), COUPLE);

    act(() => result.current.reportLoadFailure());

    await waitFor(() => expect(result.current.unavailable).toBe('forbidden'));
    expect(result.current.url).toBeUndefined();
  });

  it('treats an unchanged URL as a real refusal rather than a fresh signature', async () => {
    // Storage handing back the same URL means nothing was renewed. Keeping it would
    // leave a dead <audio> src on screen that no further failure will retry, because
    // this URL is already in the retried set.
    resolveAttachmentUrls.mockResolvedValue([attachment({ url: FIRST })]);
    const { result } = renderOne(attachment(), COUPLE);

    act(() => result.current.reportLoadFailure());

    await waitFor(() => expect(result.current.url).toBeUndefined());
    expect(result.current.unavailable).toBe('unknown');
  });

  it('says nothing it does not know when re-signing throws', async () => {
    resolveAttachmentUrls.mockRejectedValue(new Error('network down'));
    const { result } = renderOne(attachment(), COUPLE);

    act(() => result.current.reportLoadFailure());

    // `unknown`, never a fabricated offline diagnosis: the request failing tells us
    // the request failed, not why.
    await waitFor(() => expect(result.current.unavailable).toBe('unknown'));
    expect(result.current.url).toBeUndefined();
  });

  it('clears the in-flight flag whichever way the re-sign ends', async () => {
    resolveAttachmentUrls.mockRejectedValue(new Error('network down'));
    const { result } = renderOne(attachment(), COUPLE);

    act(() => result.current.reportLoadFailure());

    await waitFor(() => expect(result.current.unavailable).toBe('unknown'));
    // A stuck `refreshing` would leave the surface showing a spinner forever.
    expect(result.current.refreshing).toBe(false);
  });
});

describe('what must never reach the network', () => {
  it('does not re-sign a temporary blob URL, which has no storage path', () => {
    const { result } = renderOne(
      attachment({ path: undefined, url: 'blob:http://localhost/abc' }),
      COUPLE,
    );

    act(() => result.current.reportLoadFailure());

    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
  });

  it('does not re-sign before a couple space exists', () => {
    const { result } = renderOne(attachment());

    act(() => result.current.reportLoadFailure());

    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
  });

  it('does not re-sign when there is no URL to have failed', () => {
    const { result } = renderOne(attachment({ url: undefined }), COUPLE);

    act(() => result.current.reportLoadFailure());

    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
  });
});

describe('a fresh fetch supersedes locally recovered state', () => {
  it('adopts a newly signed URL arriving from the store', async () => {
    // Realtime patch, reload or navigation re-signs everything. The hook must not
    // keep showing its own older recovery in preference to that.
    const { result, rerender } = renderOne(attachment(), COUPLE);
    expect(result.current.url).toBe(FIRST);

    rerender({ a: attachment({ url: SECOND }), c: COUPLE });

    await waitFor(() => expect(result.current.url).toBe(SECOND));
  });

  it('adopts an unavailability decided upstream', async () => {
    const { result, rerender } = renderOne(attachment(), COUPLE);

    rerender({ a: attachment({ url: undefined, urlUnavailable: 'forbidden' }), c: COUPLE });

    await waitFor(() => expect(result.current.unavailable).toBe('forbidden'));
    expect(result.current.url).toBeUndefined();
  });
});

describe('late recovery cannot cross a source or authorization boundary', () => {
  function pendingRecovery() {
    let complete!: (value: Attachment[]) => void;
    resolveAttachmentUrls.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    return (value: Attachment[]) => act(async () => { complete(value); });
  }

  it('does not install an earlier photo after the attachment changes', async () => {
    const complete = pendingRecovery();
    const { result, rerender } = renderOne(attachment(), COUPLE);
    act(() => result.current.reportLoadFailure());
    const next = attachment({ path: `${COUPLE}/${RECORD}/next.jpg`, url: 'https://example.test/next' });
    rerender({ a: next, c: COUPLE });
    await complete([attachment({ url: SECOND })]);
    expect(result.current.url).toBe(next.url);
    expect(result.current.refreshing).toBe(false);
  });

  it('does not revive a photo denied by a newer authorization result', async () => {
    const complete = pendingRecovery();
    const { result, rerender } = renderOne(attachment(), COUPLE);
    act(() => result.current.reportLoadFailure());
    rerender({ a: attachment({ url: undefined, urlUnavailable: 'forbidden' }), c: undefined });
    await complete([attachment({ url: SECOND })]);
    expect(result.current.url).toBeUndefined();
    expect(result.current.unavailable).toBe('forbidden');
  });

  it('does not overwrite a newer store signature for the same attachment', async () => {
    const complete = pendingRecovery();
    const { result, rerender } = renderOne(attachment(), COUPLE);
    act(() => result.current.reportLoadFailure());
    const fresh = 'https://example.test/newer-signature';
    rerender({ a: attachment({ url: fresh }), c: COUPLE });
    await complete([attachment({ url: SECOND })]);
    expect(result.current.url).toBe(fresh);
  });

  it('recovers after StrictMode effect cleanup and setup replay', async () => {
    resolveAttachmentUrls.mockResolvedValue([attachment({ url: SECOND })]);
    const { result } = renderHook(() => useMediaAttachment(attachment(), COUPLE, RECORD), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    act(() => result.current.reportLoadFailure());
    await waitFor(() => expect(result.current.url).toBe(SECOND));
    expect(result.current.refreshing).toBe(false);
  });

  it('does not let a stale failure clear a newer request in flight', async () => {
    let failOld!: (error: Error) => void;
    let finishNew!: (value: Attachment[]) => void;
    resolveAttachmentUrls.mockReturnValueOnce(new Promise((_, reject) => { failOld = reject; }));
    resolveAttachmentUrls.mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve; }));
    const { result, rerender } = renderOne(attachment(), COUPLE);
    act(() => result.current.reportLoadFailure());
    const next = attachment({ url: 'https://example.test/next', path: `${COUPLE}/${RECORD}/next.jpg` });
    rerender({ a: next, c: COUPLE });
    act(() => result.current.reportLoadFailure());
    await act(async () => { failOld(new Error('old request failed')); });
    expect(result.current.url).toBe(next.url);
    expect(result.current.unavailable).toBeUndefined();
    expect(result.current.refreshing).toBe(true);
    await act(async () => { finishNew([{ ...next, url: 'https://example.test/next-fresh' }]); });
    expect(result.current.url).toBe('https://example.test/next-fresh');
    expect(result.current.refreshing).toBe(false);
  });

  it('does not reuse a callback retained from a different couple/record', () => {
    const { result, rerender } = renderHook(({ c, r }) => useMediaAttachment(attachment(), c, r), {
      initialProps: { c: COUPLE, r: RECORD },
    });
    const oldReport = result.current.reportLoadFailure;
    rerender({ c: 'other-couple', r: 'other-record' });
    act(() => oldReport());
    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
  });
});
