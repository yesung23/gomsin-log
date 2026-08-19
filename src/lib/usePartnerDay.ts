import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DailyRecord } from '@/types';
import { useStore } from '@/lib/useStore';
import { localToday, toLocalDateString } from '@/lib/utils';
import {
  acknowledgePartnerDayRecords,
  projectPartnerDay,
  readPartnerDayCheckpointStatus,
  writePartnerDayCheckpoint,
  type PartnerDayCheckpoint,
  type PartnerDayContext,
  type PartnerDayProjection,
} from '@/lib/partnerDay';

/**
 * The partner-day surface, wired to the store, storage and the confirm button.
 *
 * Exists so that the identity triple this feature keeps getting wrong is
 * assembled exactly once. `userId`, `coupleId`, `viewer` and `todayStr` are built
 * here, in one closure, and the SAME values drive eligibility, the surface, and
 * the storage key. When the widgets each did this themselves they diverged:
 * `partnerDay.ts` was given `profile.id` as the privacy identity while the
 * storage key used `authenticatedUser.id`, and the two are not always the same
 * value.
 *
 * Two widgets read this. Only the one with the confirm button writes CONFIRMED.
 */

export interface UsePartnerDayOptions {
  /**
   * Whether this caller may persist the discovery/first-contact result.
   *
   * Not an authorization boundary -- both transitions are additive and idempotent,
   * so a second writer could only ever write the same thing. It keeps ONE owner
   * for the receipt, which is what makes a storage write easy to reason about
   * when the same screen mounts two readers of it.
   */
  persist?: boolean;
}

export interface UsePartnerDayResult {
  /** `OUTSTANDING ∩ eligible(today)`, oldest first. */
  surface: DailyRecord[];
  /** The viewer's local date the surface was computed against. */
  todayStr: string;
  /**
   * Confirm the given records. THE only path to CONFIRMED.
   *
   * Returns `false` when nothing was consumed or the receipt could not be
   * written, in which case no state advances and the records stay on screen.
   */
  acknowledge: (records: DailyRecord[]) => boolean;
}

export function usePartnerDay(options: UsePartnerDayOptions = {}): UsePartnerDayResult {
  const { persist = false } = options;
  const { state, sharedSyncStatus } = useStore();
  const { profile } = state;

  /*
   * ONE identity, built once, used for everything below.
   *
   * The storage identity and the privacy identity are deliberately the same
   * `userId`. `authenticatedUser.id` is preferred because that is the account
   * whose receipt this is; `profile.id` is the fallback for a profile that has
   * not been reconciled with a session yet.
   */
  const userId = state.authenticatedUser?.id || profile.id || '';
  const coupleId = profile.couple.coupleId || '';
  const todayStr = toLocalDateString(localToday());

  const context = useMemo<PartnerDayContext>(() => ({
    userId,
    coupleId,
    viewer: { userId, role: profile.role },
    todayStr,
  }), [userId, coupleId, profile.role, todayStr]);

  /*
   * The stored receipt, read once per mount, along with whether its `null` (if
   * any) means genuine absence or corrupt bytes -- `projectPartnerDay` must not
   * treat those alike. See `readPartnerDayCheckpointStatus`.
   *
   * `WidgetDashboard` keys every widget by `userId:coupleId`, so an account change
   * or a relink remounts this hook and re-reads under the new identity. Without
   * that key a stale in-memory receipt outlived the identity it belonged to and
   * suppressed the new relationship's unseen records.
   */
  const [receipt, setReceipt] = useState<{
    stored: PartnerDayCheckpoint | null;
    corrupt: boolean;
  }>(() => {
    const status = readPartnerDayCheckpointStatus(context);
    return { stored: status.checkpoint, corrupt: status.corrupt };
  });

  const projection = useMemo<PartnerDayProjection>(
    () => projectPartnerDay(context, state.records, receipt.stored, receipt.corrupt),
    [context, state.records, receipt],
  );

  /*
   * Persist what this device now knows.
   *
   * This writes OUTSTANDING and KNOWN only -- it cannot write CONFIRMED, because
   * `projectPartnerDay` never produces one. So an effect firing on mount, on a
   * re-render, or on a sync makes records MORE reachable and never less, which is
   * the property that makes it safe for an effect to run this at all. That holds
   * for `recovery` too: it is still additive-only relative to the empty state a
   * corrupt receipt leaves behind, it is simply unbounded by date.
   *
   * Held back while the shared workspace is unconfirmed: `records` is then hidden
   * for authorization reasons rather than empty, and a receipt written from that
   * moment would be a claim about data this device was not being shown.
   *
   * On a failed write nothing advances. `receipt` keeps its old value -- `corrupt`
   * included -- the screen keeps rendering `projection.surface`, and the next
   * change to records, identity or date recomputes and tries again.
   *
   * `corrupt` is cleared to `false` here, in the SAME update as capturing the
   * recovered checkpoint. It has to be: `receipt.stored` becomes a real, valid v2
   * checkpoint the moment this write succeeds, but if `corrupt` stayed `true`
   * `projectPartnerDay` would discard that checkpoint again on the very next
   * projection (`effectiveStored = corrupt ? null : stored`) and re-run recovery
   * against a stale `true`, silently dropping anything confirmed in between.
   */
  useEffect(() => {
    if (!persist) return;
    if (!projection.changed) return;
    if (sharedSyncStatus === 'unavailable') return;
    if (writePartnerDayCheckpoint(context, projection.checkpoint)) {
      setReceipt({ stored: projection.checkpoint, corrupt: false });
    }
  }, [persist, projection, context, sharedSyncStatus]);

  /**
   * The confirm button's handler, and the only writer of CONFIRMED in the app.
   *
   * Acknowledges against `projection.checkpoint` rather than `receipt.stored`, so
   * a record discovered OR recovered by this same computation can be confirmed in
   * the same press even if its OUTSTANDING entry has not reached disk yet.
   */
  const acknowledge = useCallback((records: DailyRecord[]): boolean => {
    const next = acknowledgePartnerDayRecords(projection.checkpoint, records);
    // Nothing consumed: no receipt to write, nothing to advance.
    if (!next) return false;
    // A receipt that could not be stored must not be treated as stored. The
    // records stay on screen, and a reload agrees with the screen.
    if (!writePartnerDayCheckpoint(context, next)) return false;
    // `next` is itself a fresh, valid v2 checkpoint -- clear `corrupt` for the
    // same reason the persist effect above does.
    setReceipt({ stored: next, corrupt: false });
    return true;
  }, [projection, context]);

  return { surface: projection.surface, todayStr, acknowledge };
}
