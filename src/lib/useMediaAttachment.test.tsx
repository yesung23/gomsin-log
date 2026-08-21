import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    type: 'voice',
    name: '음성기록-1.webm',
    url: FIRST,
    path: `${COUPLE}/${RECORD}/voice.webm`,
    ...overrides,
  };
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

beforeEach(() => {
  resolveAttachmentUrls.mockReset();
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
