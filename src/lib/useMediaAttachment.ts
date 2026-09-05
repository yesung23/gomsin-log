import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { resolveAttachmentUrls } from '@/lib/records';
import type { Attachment, ServerErrorKind } from '@/types';

/**
 * Own one attachment's viewable URL, including recovery when it stops working.
 *
 * Signed URLs live for `SIGNED_URL_TTL_SECONDS` (1 hour). A record fetched on a
 * cold load carries URLs signed at that moment, and this app is a PWA people
 * leave open: an hour later every `<img>`, `<audio>` and `<video>` in the
 * timeline points at a URL Storage now refuses. Nothing re-signed them, so media
 * simply stopped loading with no explanation and no way back short of a full
 * reload.
 *
 * A media element reports that as an `error` event, which is the only reliable
 * signal available on the client -- the expiry instant is not knowable from the
 * URL. So: on the first failure, re-sign once through the same path the initial
 * fetch used, and hand back the fresh URL. Signing uses the caller's own token,
 * so the Storage SELECT policy still decides what may be viewed; this can widen
 * nothing.
 *
 * Deliberately at most ONE automatic retry per URL. A genuine refusal (the
 * partner's private file, a revoked membership, a deleted object) would
 * otherwise become an unbounded request loop against Storage.
 */
export type MediaAttachmentState = {
  /** The URL to hand the media element, or `undefined` when there is none. */
  url?: string;
  /** Why there is no URL, when signing was attempted and refused. */
  unavailable?: ServerErrorKind;
  /** A re-sign is in flight, so the surface can avoid flashing an error. */
  refreshing: boolean;
  /**
   * Report that the media element failed to load `url`. Triggers the single
   * automatic re-sign. Safe to call repeatedly; only the first attempt per URL
   * reaches the network.
   */
  reportLoadFailure: () => void;
};

export type MediaAttachmentVariant = 'master' | 'thumbnail';

type ActiveMediaSource = {
  kind: MediaAttachmentVariant;
  attachment: Attachment;
};

function initialMediaSource(
  attachment: Attachment,
  variant: MediaAttachmentVariant,
): ActiveMediaSource {
  if (attachment.photoMetadataUnavailable) {
    return {
      kind: 'master',
      attachment: {
        ...attachment,
        url: undefined,
        urlUnavailable: attachment.photoMetadataUnavailable,
      },
    };
  }
  const thumbnail = variant === 'thumbnail' ? attachment.photoRendition?.thumbnail : undefined;
  if (!thumbnail) return { kind: 'master', attachment };
  const thumbnailAttachment: Attachment = {
    type: 'photo',
    name: attachment.name,
    path: thumbnail.path,
    url: thumbnail.url,
    urlUnavailable: thumbnail.urlUnavailable,
  };
  return { kind: 'thumbnail', attachment: thumbnailAttachment };
}

export function useMediaAttachment(
  attachment: Attachment,
  coupleId: string | undefined,
  recordId: string,
  variant: MediaAttachmentVariant = 'master',
): MediaAttachmentState {
  const initialSource = initialMediaSource(attachment, variant);
  const [url, setUrl] = useState(initialSource.attachment.url);
  const [unavailable, setUnavailable] = useState(initialSource.attachment.urlUnavailable);
  const [sourceKind, setSourceKind] = useState(initialSource.kind);
  const [refreshing, setRefreshing] = useState(false);
  /** URLs already retried, so a second failure of the same URL gives up. */
  const retried = useRef(new Set<string>());
  const mounted = useRef(true);
  const generation = useRef(0);
  const sourceKey = JSON.stringify([
    coupleId,
    recordId,
    variant,
    attachment.type,
    attachment.path,
    attachment.url,
    attachment.urlUnavailable,
    attachment.photoMetadataUnavailable,
    attachment.photoRendition?.sourceRevision,
    attachment.photoRendition?.screenMaster.mediaObjectId,
    attachment.photoRendition?.thumbnail.mediaObjectId,
    attachment.photoRendition?.thumbnail.path,
    attachment.photoRendition?.thumbnail.url,
    attachment.photoRendition?.thumbnail.urlUnavailable,
  ]);
  const activeKey = useRef(sourceKey);

  // Invalidate old work before paint, including StrictMode setup/cleanup replay.
  // Neither an old success nor failure may replace a newer source/denial.
  useLayoutEffect(() => {
    mounted.current = true;
    activeKey.current = sourceKey;
    generation.current += 1;
    retried.current.clear();
    setUrl(initialSource.attachment.url);
    setUnavailable(initialSource.attachment.urlUnavailable);
    setSourceKind(initialSource.kind);
    setRefreshing(false);
    return () => { mounted.current = false; generation.current += 1; };
  }, [sourceKey, initialSource.attachment.url, initialSource.attachment.urlUnavailable, initialSource.kind]);

  const reportLoadFailure = useCallback(() => {
    if (!mounted.current || activeKey.current !== sourceKey) return;
    // Metadata is the authority for a contract-v1 plaintext photo pair. Storage
    // signing can refresh transport URLs, but it cannot overrule that authority.
    if (attachment.photoMetadataUnavailable) return;
    const failedUrl = url;
    const currentSource = sourceKind === 'thumbnail' && attachment.photoRendition
      ? {
          type: 'photo' as const,
          name: attachment.name,
          path: attachment.photoRendition.thumbnail.path,
          url,
          urlUnavailable: unavailable,
        }
      : { ...attachment, url, urlUnavailable: unavailable };
    // Without a storage path there is nothing to re-sign: a temporary local blob
    // URL or a legacy attachment saved before paths were durable.
    if (!failedUrl || !currentSource.path || !coupleId) return;
    if (retried.current.has(failedUrl)) return;
    retried.current.add(failedUrl);
    const requestGeneration = generation.current;
    const isCurrent = () => mounted.current && generation.current === requestGeneration;
    setRefreshing(true);
    void (async () => {
      try {
        const [signed] = await resolveAttachmentUrls([currentSource], coupleId, recordId);
        if (!isCurrent()) return;
        if (signed?.url && signed.url !== failedUrl) {
          setUrl(signed.url);
          setUnavailable(undefined);
          return;
        }
        // Re-signing produced nothing usable, so the file really is unreachable.
        setUrl(undefined);
        setUnavailable(signed?.urlUnavailable ?? 'unknown');
      } catch {
        if (!isCurrent()) return;
        setUrl(undefined);
        setUnavailable('unknown');
      } finally {
        if (isCurrent()) setRefreshing(false);
      }
    })();
  }, [attachment, coupleId, recordId, sourceKey, sourceKind, unavailable, url]);

  // Render the new props immediately; do not hand a previous source URL to an
  // <img> for even the commit preceding the layout-effect state reset.
  return activeKey.current === sourceKey
    ? { url, unavailable, refreshing, reportLoadFailure }
    : {
        url: initialSource.attachment.url,
        unavailable: initialSource.attachment.urlUnavailable,
        refreshing: false,
        reportLoadFailure,
      };
}
