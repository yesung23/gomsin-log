import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useMediaAttachment(
  attachment: Attachment,
  coupleId: string | undefined,
  recordId: string,
): MediaAttachmentState {
  const [url, setUrl] = useState(attachment.url);
  const [unavailable, setUnavailable] = useState(attachment.urlUnavailable);
  const [refreshing, setRefreshing] = useState(false);
  /** URLs already retried, so a second failure of the same URL gives up. */
  const retried = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  // A fresh fetch (realtime patch, reload, navigation) supersedes local state.
  useEffect(() => {
    setUrl(attachment.url);
    setUnavailable(attachment.urlUnavailable);
  }, [attachment.url, attachment.urlUnavailable]);

  const reportLoadFailure = useCallback(() => {
    const failedUrl = url;
    // Without a storage path there is nothing to re-sign: a demo-mode blob URL
    // or a legacy attachment saved before paths were durable.
    if (!failedUrl || !attachment.path || !coupleId) return;
    if (retried.current.has(failedUrl)) return;
    retried.current.add(failedUrl);
    setRefreshing(true);
    void (async () => {
      try {
        const [signed] = await resolveAttachmentUrls([attachment], coupleId, recordId);
        if (!mounted.current) return;
        if (signed?.url && signed.url !== failedUrl) {
          setUrl(signed.url);
          setUnavailable(undefined);
          return;
        }
        // Re-signing produced nothing usable, so the file really is unreachable.
        setUrl(undefined);
        setUnavailable(signed?.urlUnavailable ?? 'unknown');
      } catch {
        if (!mounted.current) return;
        setUrl(undefined);
        setUnavailable('unknown');
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    })();
  }, [attachment, coupleId, recordId, url]);

  return { url, unavailable, refreshing, reportLoadFailure };
}
