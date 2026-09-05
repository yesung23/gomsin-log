import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect, useState } from 'react';
import type { Attachment, DailyRecord } from '@/types';

/**
 * The media layer's safety rules, which are not visual even though the change
 * that introduced them was.
 *
 * Bug conditions this file states as assertions:
 *
 *   1. An attachment ends up with a `<button>` ancestor. `<video controls>` and
 *      `<audio controls>` inside a button is invalid HTML, and a card-level
 *      handler swallows every tap meant for the transport. This is the exact
 *      defect `src/pages/keyboardOperableCards.test.tsx` was written for; it
 *      checks the timeline, and these check the components directly so a future
 *      caller cannot reintroduce it somewhere that file does not look.
 *
 *   2. A voice memo is placed in the swipeable set, so swiping to the next photo
 *      silences the thing the person actually recorded.
 *
 *   3. The archive grid renders a partner's private photo. The grid takes
 *      whatever records it is handed, so the contract that it is handed only
 *      viewer-permitted ones has to be stated somewhere.
 */

const resolveAttachmentUrls = vi.fn();
vi.mock('@/lib/records', () => ({
  resolveAttachmentUrls: (...args: unknown[]) => resolveAttachmentUrls(...args),
}));

const { RecordMediaGallery } = await import('@/components/media/RecordMediaGallery');
const { MediaArchiveGrid } = await import('@/components/media/MediaArchiveGrid');

const COUPLE = 'couple-1';
const RECORD = 'rec-1';

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const originalScrollTo = window.scrollTo;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});
afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  window.scrollTo = originalScrollTo;
});
beforeEach(() => {
  resolveAttachmentUrls.mockReset();
});

function photo(name: string): Attachment {
  return {
    type: 'photo',
    name,
    url: `https://example.supabase.co/signed/${name}?token=t`,
    path: `${COUPLE}/${RECORD}/${name}`,
  };
}

function photoWithThumbnail(name = 'thumb-photo.jpg'): Attachment {
  return {
    type: 'photo',
    name,
    url: 'https://media.test/master.jpg',
    path: `${COUPLE}/${RECORD}/33333333-3333-4333-8333-333333333333.jpg`,
    photoRendition: {
      sourceRevision: '55555555-5555-4555-8555-555555555555',
      screenMaster: {
        mediaObjectId: '33333333-3333-4333-8333-333333333333',
        widthPx: 2048, heightPx: 1536, byteSize: 900_000,
        sha256: 'a'.repeat(64), mimeType: 'image/jpeg',
      },
      thumbnail: {
        mediaObjectId: '44444444-4444-4444-8444-444444444444',
        widthPx: 640, heightPx: 480, byteSize: 90_000,
        sha256: 'b'.repeat(64), mimeType: 'image/jpeg',
        path: `${COUPLE}/${RECORD}/44444444-4444-4444-8444-444444444444.jpg`,
        url: 'https://media.test/thumbnail.jpg',
      },
    },
  };
}

function voice(name = '음성-1.webm'): Attachment {
  return {
    type: 'voice',
    name,
    url: `https://example.supabase.co/signed/${name}?token=t`,
    path: `${COUPLE}/${RECORD}/${name}`,
  };
}

function video(name = '영상-1.mp4'): Attachment {
  return {
    type: 'video',
    name,
    url: `https://example.supabase.co/signed/${name}?token=t`,
    path: `${COUPLE}/${RECORD}/${name}`,
  };
}

function renderGallery(attachments: Attachment[]) {
  return render(
    <RecordMediaGallery attachments={attachments} coupleId={COUPLE} recordId={RECORD} />,
  );
}

describe('a player is never nested inside a button', () => {
  it('keeps a single photo out of any button ancestor', () => {
    const { container } = renderGallery([photo('a.jpg')]);
    const attachment = container.querySelector('[data-testid="record-attachment"]');
    expect(attachment).not.toBeNull();
    expect(attachment!.closest('button')).toBeNull();
  });

  it('keeps every photo of a carousel out of any button ancestor', () => {
    const { container } = renderGallery([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
    const attachments = [...container.querySelectorAll('[data-testid="record-attachment"]')];
    expect(attachments).toHaveLength(3);
    for (const attachment of attachments) {
      expect(attachment.closest('button')).toBeNull();
    }
  });

  it('keeps video and voice out of any button ancestor', () => {
    const { container } = renderGallery([video(), voice()]);
    for (const attachment of container.querySelectorAll('[data-testid="record-attachment"]')) {
      expect(attachment.closest('button')).toBeNull();
    }
    expect(container.querySelector('video')).not.toBeNull();
    expect(container.querySelector('audio')).not.toBeNull();
  });
});

describe('the expand affordance is offered only where it cannot eat a transport tap', () => {
  it('offers it on a photo', async () => {
    renderGallery([photo('노을.jpg')]);
    expect(await screen.findByRole('button', { name: '노을.jpg 크게 보기' })).toBeInTheDocument();
  });

  it('does not offer it on a video, whose own play control owns that surface', () => {
    renderGallery([video('훈련.mp4')]);
    expect(screen.queryByRole('button', { name: /크게 보기/ })).not.toBeInTheDocument();
  });

  it('does not offer it on a voice memo, which has no frame to enlarge', () => {
    renderGallery([voice()]);
    expect(screen.queryByRole('button', { name: /크게 보기/ })).not.toBeInTheDocument();
  });
});

describe('voice is not part of the swipeable set', () => {
  it('carousels the photos and leaves the voice memo outside it', () => {
    const { container } = renderGallery([photo('a.jpg'), photo('b.jpg'), voice()]);

    const carousel = container.querySelector('[data-testid="record-media-carousel"]');
    expect(carousel, 'two photos should be swipeable').not.toBeNull();

    const inCarousel = [...carousel!.querySelectorAll('[data-attachment-type]')].map((node) =>
      node.getAttribute('data-attachment-type'),
    );
    expect(inCarousel).toEqual(['photo', 'photo']);

    // The voice player exists, just not inside the carousel.
    expect(container.querySelector('audio')).not.toBeNull();
    expect(carousel!.querySelector('audio')).toBeNull();
  });

  it('gives every slide a definite width, which Astryx does not', () => {
    /*
     * Astryx wraps each carousel child in `flex-shrink: 0` with NO width, so a
     * slide is sized by its content. A photo whose frame says `w-full` then
     * resolves 100% against a parent that has no width and collapses -- and
     * `AspectRatio` needs "an ancestor with a definite width" to derive height at
     * all. jsdom computes no layout, so this is asserted as the declaration
     * rather than as a measurement; the rendered result belongs to Playwright.
     */
    const { container } = renderGallery([photo('a.jpg'), photo('b.jpg')]);

    const track = container.querySelector('[data-testid="record-media-carousel"]')!;
    expect(track.closest('.\\@container'), 'slides need a container to size against').not.toBeNull();

    const frames = [...track.querySelectorAll('[data-testid="record-attachment"]')];
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.className).toContain('w-[100cqw]');
      expect(frame.className).not.toContain('w-full');
    }
  });

  it('leaves a lone photo on w-full, which has a real parent to fill', () => {
    const { container } = renderGallery([photo('a.jpg')]);
    const frame = container.querySelector('[data-testid="record-attachment"]')!;
    expect(frame.className).toContain('w-full');
    expect(frame.className).not.toContain('cqw');
  });

  it('does not build a carousel for a single photo', () => {
    const { container } = renderGallery([photo('a.jpg')]);
    expect(container.querySelector('[data-testid="record-media-carousel"]')).toBeNull();
  });

  it('does not build a carousel for one photo plus one voice memo', () => {
    // Two attachments, one visual: there is nothing to swipe between.
    const { container } = renderGallery([photo('a.jpg'), voice()]);
    expect(container.querySelector('[data-testid="record-media-carousel"]')).toBeNull();
  });

  it('renders nothing at all when there are no attachments', () => {
    const { container } = renderGallery([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the archive grid', () => {
  function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
    return {
      id: 'rec-1',
      date: '2026-08-20',
      time: '10:00',
      authorRole: 'gomsin',
      log: '',
      isPrivate: false,
      createdAt: '2026-08-20T01:00:00.000Z',
      ...overrides,
    };
  }

  it('shows an empty state rather than a bare grid when nothing has a frame', () => {
    render(
      <MediaArchiveGrid
        records={[record({ attachments: [voice()] })]}
        coupleId={COUPLE}
        emptyDescription="이번 달에 남긴 사진이 아직 없어요."
      />,
    );
    expect(screen.getByText('아직 사진이 없어요')).toBeInTheDocument();
  });

  it('orders newest first, so the most recent photo is top-left', async () => {
    render(
      <MediaArchiveGrid
        records={[
          record({ id: 'old', date: '2026-08-18', time: '09:00', attachments: [photo('old.jpg')] }),
          record({ id: 'new', date: '2026-08-20', time: '21:00', attachments: [photo('new.jpg')] }),
        ]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );

    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    const labels = screen.getAllByRole('button').map((node) => node.getAttribute('aria-label'));
    expect(labels[0]).toContain('new.jpg');
    expect(labels[1]).toContain('old.jpg');
  });

  it("marks the viewer's own private photo instead of dropping it", async () => {
    /*
     * A partner's private record never reaches this component -- the caller
     * filters with `visibleRecordsForViewer` first. What DOES reach it is the
     * viewer's own private photo, and silently omitting that from their own
     * archive would read as data loss rather than as privacy.
     */
    const { container } = render(
      <MediaArchiveGrid
        records={[record({ isPrivate: true, attachments: [photo('mine.jpg')] })]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );
    expect(await screen.findByRole('button', { name: /mine\.jpg/ })).toBeInTheDocument();
    // The lock marker is decorative; the record is still reachable.
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('leaves voice out of the grid, which is a wall of frames', () => {
    render(
      <MediaArchiveGrid
        records={[record({ attachments: [photo('a.jpg'), voice()] })]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('loads only the thumbnail before expansion and gives the lightbox the exact master', async () => {
    resolveAttachmentUrls.mockResolvedValueOnce([
      { ...photoWithThumbnail(), url: 'https://media.test/fresh-master.jpg' },
    ]);
    const { container } = render(
      <MediaArchiveGrid
        records={[record({ attachments: [photoWithThumbnail()] })]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );

    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://media.test/thumbnail.jpg');
    expect(container.querySelector('dialog')).toBeNull();

    screen.getByRole('button', { name: /thumb-photo\.jpg 크게 보기/ }).click();

    await waitFor(() => expect(container.querySelector('dialog img')).not.toBeNull());
    expect(resolveAttachmentUrls).toHaveBeenCalledWith(
      [photoWithThumbnail()],
      COUPLE,
      RECORD,
    );
    expect(container.querySelector('dialog img')).toHaveAttribute('src', 'https://media.test/fresh-master.jpg');
  });

  it('does not request master bytes while a closed thumbnail transport failure is handled', async () => {
    resolveAttachmentUrls.mockResolvedValueOnce([{
      type: 'photo',
      name: 'thumb-photo.jpg',
      path: photoWithThumbnail().photoRendition!.thumbnail.path,
      urlUnavailable: 'unreachable',
    }]);
    const { container } = render(
      <MediaArchiveGrid
        records={[record({ attachments: [photoWithThumbnail()] })]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );

    fireEvent.error(container.querySelector('img')!);

    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(resolveAttachmentUrls).toHaveBeenCalledWith(
      [{
        type: 'photo',
        name: 'thumb-photo.jpg',
        path: photoWithThumbnail().photoRendition!.thumbnail.path,
        url: 'https://media.test/thumbnail.jpg',
        urlUnavailable: undefined,
      }],
      COUPLE,
      RECORD,
    );
    expect(container.querySelector('[src="https://media.test/master.jpg"]')).toBeNull();
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('freshly signs the exact clicked master after a transient initial master failure', async () => {
    const transient = photoWithThumbnail();
    transient.url = undefined;
    transient.urlUnavailable = 'unreachable';
    resolveAttachmentUrls.mockResolvedValueOnce([
      { ...transient, url: 'https://media.test/recovered-master.jpg', urlUnavailable: undefined },
    ]);
    const { container } = render(
      <MediaArchiveGrid
        records={[record({ attachments: [transient] })]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );

    screen.getByRole('button', { name: /thumb-photo\.jpg 크게 보기/ }).click();

    await waitFor(() => expect(container.querySelector('dialog img')).not.toBeNull());
    expect(resolveAttachmentUrls).toHaveBeenCalledWith([transient], COUPLE, RECORD);
    expect(container.querySelector('dialog img')).toHaveAttribute(
      'src',
      'https://media.test/recovered-master.jpg',
    );
  });

  it.each(['server', 'unreachable'] as const)(
    'does not turn a fetch metadata authority failure into a master-signing retry: %s',
    (reason) => {
      const blocked: Attachment = {
        type: 'photo',
        name: 'blocked-photo.jpg',
        path: `${COUPLE}/${RECORD}/33333333-3333-4333-8333-333333333333.jpg`,
        urlUnavailable: reason,
        photoMetadataUnavailable: reason,
      };
      resolveAttachmentUrls.mockResolvedValueOnce([{
        ...blocked,
        url: 'https://media.test/signer-would-succeed.jpg',
        urlUnavailable: undefined,
      }]);
      const { container } = render(
        <MediaArchiveGrid
          records={[record({ attachments: [blocked] })]}
          coupleId={COUPLE}
          emptyDescription=""
        />,
      );

      screen.getByRole('button', { name: /blocked-photo\.jpg 크게 보기/ }).click();

      expect(resolveAttachmentUrls).not.toHaveBeenCalled();
      expect(container.querySelector('dialog')).toBeNull();
    },
  );

  it('removes an open cached master before paint when authority refresh denies the source', async () => {
    const allowed = photoWithThumbnail();
    const blocked: Attachment = {
      type: 'photo',
      name: allowed.name,
      path: allowed.path,
      urlUnavailable: 'forbidden',
      photoMetadataUnavailable: 'forbidden',
    };
    const beforePaintSources: string[] = [];

    function AuthorityRefreshHarness() {
      const [denied, setDenied] = useState(false);
      useLayoutEffect(() => {
        if (denied) {
          beforePaintSources.push(
            document.querySelector('dialog img')?.getAttribute('src') ?? 'none',
          );
        }
      }, [denied]);
      return (
        <>
          <button type="button" onClick={() => setDenied(true)}>deny current source</button>
          <MediaArchiveGrid
            records={[record({ attachments: [denied ? blocked : allowed] })]}
            coupleId={COUPLE}
            emptyDescription=""
          />
        </>
      );
    }

    resolveAttachmentUrls.mockResolvedValueOnce([{
      ...allowed,
      url: 'https://media.test/fresh-master-before-denial.jpg',
    }]);
    const { container } = render(<AuthorityRefreshHarness />);
    screen.getByRole('button', { name: /thumb-photo\.jpg 크게 보기/ }).click();
    await waitFor(() => expect(container.querySelector('dialog img')).toHaveAttribute(
      'src',
      'https://media.test/fresh-master-before-denial.jpg',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'deny current source' }));

    expect(beforePaintSources).toEqual(['none']);
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('does not open the second item when fresh signing of the first clicked master fails', async () => {
    const first = photoWithThumbnail('first.jpg');
    first.url = undefined;
    first.urlUnavailable = 'unreachable';
    const second = photo('second.jpg');
    resolveAttachmentUrls.mockResolvedValueOnce([
      { ...first, url: undefined, urlUnavailable: 'unreachable' },
    ]);
    const { container } = render(
      <MediaArchiveGrid
        records={[record({ attachments: [first, second] })]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );

    screen.getByRole('button', { name: /first\.jpg 크게 보기/ }).click();

    await waitFor(() => expect(resolveAttachmentUrls).toHaveBeenCalledWith([first], COUPLE, RECORD));
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('does not retry an authoritative master permission denial on click', () => {
    const denied = photoWithThumbnail();
    denied.url = undefined;
    denied.urlUnavailable = 'forbidden';
    render(
      <MediaArchiveGrid
        records={[record({ attachments: [denied] })]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );

    screen.getByRole('button', { name: /thumb-photo\.jpg 크게 보기/ }).click();

    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('does not open an adjacent photo when the tapped master is unavailable', () => {
    const unavailable = photo('unavailable.jpg');
    unavailable.url = undefined;
    unavailable.urlUnavailable = 'forbidden';
    render(
      <MediaArchiveGrid
        records={[record({ attachments: [unavailable, photo('available.jpg')] })]}
        coupleId={COUPLE}
        emptyDescription=""
      />,
    );

    screen.getByRole('button', { name: /unavailable\.jpg 크게 보기/ }).click();

    expect(document.querySelector('dialog')).toBeNull();
  });
});
