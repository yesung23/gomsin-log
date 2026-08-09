import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Attachment } from '@/types';

/**
 * Bug condition:
 *   isBugCondition(tree) = a voice or video attachment is rendered without any
 *                          element that can play it
 *                       OR an attachment whose signed URL has expired stays
 *                          broken with no recovery.
 *
 * Measured on the unfixed tree: `git grep -E "<(audio|video)[ >]" src` returned
 * NOTHING. The app records audio with `MediaRecorder`
 * (`TodayLogWidget.tsx` handleStartRecording), accepts video through
 * `MEDIA_ACCEPT`, uploads both to the private Storage bucket and signs URLs for
 * them -- and then rendered them as a filename chip with a mic or film icon and
 * no player. A 곰신 could record a voice note that their 군화 could never hear.
 *
 * Second half of the condition: `SIGNED_URL_TTL_SECONDS` is 3600
 * (`src/lib/records.ts:295`) and URLs are signed once, at fetch time, then held
 * in React state. An hour into a session every attachment URL is refused by
 * Storage. Nothing re-signed them.
 *
 * Nothing caught either half: no test asserted that media is playable, and the
 * suite is blind to a URL that is syntactically fine and semantically dead.
 */

const resolveAttachmentUrls = vi.fn<
  (attachments: Attachment[], coupleId: string, recordId: string) => Promise<Attachment[]>
>();

vi.mock('@/lib/records', () => ({
  resolveAttachmentUrls: (...args: Parameters<typeof resolveAttachmentUrls>) =>
    resolveAttachmentUrls(...args),
}));

const { AttachmentMedia } = await import('@/components/AttachmentMedia');

const COUPLE = 'couple-1';
const RECORD = 'rec-1';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    type: 'voice',
    name: '음성기록-1.webm',
    url: 'https://example.supabase.co/signed/voice?token=first',
    path: `${COUPLE}/${RECORD}/voice.webm`,
    ...overrides,
  };
}

function renderOne(att: Attachment, coupleId: string = COUPLE) {
  return render(
    <AttachmentMedia
      attachment={att}
      coupleId={coupleId}
      recordId={RECORD}
      variant="detail"
    />,
  );
}

beforeEach(() => {
  resolveAttachmentUrls.mockReset();
});

describe('a recorded voice note can actually be heard', () => {
  it('renders an <audio> element with controls pointed at the signed URL', () => {
    const { container } = renderOne(attachment());

    const audio = container.querySelector('audio');
    expect(audio, 'a voice attachment must render an audio element').not.toBeNull();
    expect(audio).toHaveAttribute('src', 'https://example.supabase.co/signed/voice?token=first');
    expect(audio).toHaveAttribute('controls');
    // Native controls are keyboard operable; the name is what a screen reader
    // announces for them.
    expect(audio).toHaveAttribute('aria-label', '음성기록-1.webm 음성 기록');
    // A timeline of clips must not each pull their whole payload on render.
    expect(audio).toHaveAttribute('preload', 'metadata');
  });

  it('still shows the file name next to the player', () => {
    renderOne(attachment());
    expect(screen.getByText('음성기록-1.webm')).toBeInTheDocument();
  });
});

describe('a video attachment can actually be watched', () => {
  it('renders a <video> element with controls and playsInline', () => {
    const { container } = renderOne(attachment({
      type: 'video',
      name: 'clip.mp4',
      url: 'https://example.supabase.co/signed/video?token=first',
    }));

    const video = container.querySelector('video');
    expect(video, 'a video attachment must render a video element').not.toBeNull();
    expect(video).toHaveAttribute('controls');
    // Without playsInline, iOS Safari hijacks the tap into a fullscreen player.
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('aria-label', 'clip.mp4 동영상');
  });
});

describe('PRESERVATION: the behaviours that already worked', () => {
  it('a photo still renders as an <img> with the file name as alt text', () => {
    const { container } = renderOne(attachment({
      type: 'photo',
      name: 'photo.jpg',
      url: 'https://example.supabase.co/signed/photo?token=first',
    }));

    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.supabase.co/signed/photo?token=first');
    expect(img).toHaveAttribute('alt', 'photo.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('an attachment that could not be signed still explains itself, and renders no player', () => {
    const { container } = renderOne(attachment({ url: undefined, urlUnavailable: 'forbidden' }));

    expect(screen.getByText(/이 파일을 열 수 없어요/)).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    // The name is still shown, so the user knows which file is affected.
    expect(screen.getByText('음성기록-1.webm')).toBeInTheDocument();
  });

  it('an attachment with neither URL nor reason renders the plain chip, not an error', () => {
    renderOne(attachment({ url: undefined, urlUnavailable: undefined }));

    expect(screen.getByText('음성기록-1.webm')).toBeInTheDocument();
    expect(screen.queryByText(/이 파일을 열 수 없어요/)).not.toBeInTheDocument();
  });
});

describe('an expired signed URL recovers instead of staying broken', () => {
  it('re-signs once when the media element reports a load failure', async () => {
    resolveAttachmentUrls.mockResolvedValue([
      attachment({ url: 'https://example.supabase.co/signed/voice?token=second' }),
    ]);
    const { container } = renderOne(attachment());

    fireEvent.error(container.querySelector('audio')!);

    await waitFor(() => {
      expect(container.querySelector('audio')).toHaveAttribute(
        'src',
        'https://example.supabase.co/signed/voice?token=second',
      );
    });
    expect(resolveAttachmentUrls).toHaveBeenCalledTimes(1);
    // Signing goes through the same path the initial fetch used, scoped to this
    // couple and record, so the Storage SELECT policy still decides.
    expect(resolveAttachmentUrls.mock.calls[0][1]).toBe(COUPLE);
    expect(resolveAttachmentUrls.mock.calls[0][2]).toBe(RECORD);
  });

  it('does not loop: a repeated failure of the SAME url re-signs only once', async () => {
    resolveAttachmentUrls.mockResolvedValue([
      attachment({ url: 'https://example.supabase.co/signed/voice?token=second' }),
    ]);
    const { container } = renderOne(attachment());

    fireEvent.error(container.querySelector('audio')!);
    fireEvent.error(container.querySelector('audio')!);
    fireEvent.error(container.querySelector('audio')!);

    await waitFor(() => {
      expect(container.querySelector('audio')).toHaveAttribute(
        'src',
        'https://example.supabase.co/signed/voice?token=second',
      );
    });
    expect(resolveAttachmentUrls).toHaveBeenCalledTimes(1);
  });

  it('gives up honestly when re-signing produces nothing usable', async () => {
    resolveAttachmentUrls.mockResolvedValue([
      attachment({ url: undefined, urlUnavailable: 'forbidden' }),
    ]);
    const { container } = renderOne(attachment());

    fireEvent.error(container.querySelector('audio')!);

    await waitFor(() => {
      expect(screen.getByText(/이 파일을 열 수 없어요/)).toBeInTheDocument();
    });
    expect(container.querySelector('audio')).toBeNull();
  });

  it('says nothing it does not know when re-signing throws', async () => {
    resolveAttachmentUrls.mockRejectedValue(new Error('network down'));
    const { container } = renderOne(attachment());

    fireEvent.error(container.querySelector('audio')!);

    await waitFor(() => {
      expect(screen.getByText(/이 파일을 열 수 없어요/)).toBeInTheDocument();
    });
    // `unknown` copy, not a fabricated "check your internet connection".
    expect(screen.getByText(/이 파일을 열 수 없어요/).textContent)
      .not.toContain('인터넷 연결');
  });

  it('does not try to re-sign a temporary blob URL that has no storage path', () => {
    const { container } = renderOne(attachment({
      path: undefined,
      url: 'blob:http://localhost/abc',
    }));

    fireEvent.error(container.querySelector('audio')!);

    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
  });

  it('does not try to re-sign before a couple space exists', () => {
    // Rendered without `coupleId` on purpose: `renderOne`'s default would supply
    // one, and a default parameter is not overridden by an explicit `undefined`.
    const { container } = render(
      <AttachmentMedia attachment={attachment()} recordId={RECORD} variant="detail" />,
    );

    fireEvent.error(container.querySelector('audio')!);

    expect(resolveAttachmentUrls).not.toHaveBeenCalled();
  });
});
