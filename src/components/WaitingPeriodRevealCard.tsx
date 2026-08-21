import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { buildRevealOffer } from '@/lib/waitingPeriodReveal';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';

/**
 * PRODUCT_V3 §7.6 — "연결 전에 남긴 기록을 보여줄까요?"
 *
 * Entries written before the partner joined are private, and they stay private
 * unless the author says otherwise. This is the asking.
 *
 * ## Three things it must not do
 *
 * 1. **Reveal anything on its own.** Nothing here writes until a specific record
 *    is chosen. Closing the card, ignoring it, or never seeing it all leave every
 *    entry exactly as private as it was.
 *
 * 2. **Select by default.** The list starts with nothing chosen. A pre-ticked box
 *    is a decision made on someone's behalf, which is the shape §7.6 and §13 both
 *    rule out.
 *
 * 3. **Tell the partner it exists.** The whole card is author-only and reads no
 *    partner state. Even the count is never sent anywhere: a partner learning
 *    "there are seven entries you have not been shown" would know both that a
 *    waiting period happened and roughly how much was written in it.
 *
 * ## Why it disappears after a week
 *
 * `buildRevealOffer` bounds the offer by the join time, so "ask once" needs no
 * stored flag. See that module for why not storing one matters.
 *
 * When it stops appearing the records are unchanged: still private, still
 * turnable over one at a time from the record itself. The window bounds the
 * unprompted question, not the ability to answer it.
 */
export function WaitingPeriodRevealCard() {
  const { state, updateRecord } = useStore();
  const isOffline = !useOnlineStatus();
  const { profile } = state;

  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);

  const offer = useMemo(
    () => buildRevealOffer({
      records: state.records,
      viewerUserId: profile.id,
      partnerJoinedAt: profile.couple.partnerJoinedAt,
    }),
    [state.records, profile.id, profile.couple.partnerJoinedAt],
  );

  if (!offer.offered || dismissed) return null;

  const toggle = (recordId: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  const reveal = async () => {
    if (chosen.size === 0 || saving) return;
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }

    setSaving(true);
    try {
      /*
        One write per record, and a partial failure is reported as one.

        Turning over five entries and having two fail is not "it didn't work" --
        three are now visible to the partner, and saying otherwise would leave
        someone believing an entry is private when it is not. That is the exact
        error §7.6 exists to prevent, arriving through the mechanism meant to
        prevent it.
      */
      const results = await Promise.all(
        [...chosen].map(async (recordId) => ({
          recordId,
          ok: (await updateRecord(recordId, { isPrivate: false })).ok,
        })),
      );

      const failed = results.filter((result) => !result.ok);
      const revealed = results.length - failed.length;

      if (failed.length === 0) {
        toast.success(`${revealed}개를 보여주기로 했어요.`);
        setDismissed(true);
        return;
      }
      if (revealed > 0) {
        toast.warning(`${revealed}개는 보여주게 됐고, ${failed.length}개는 실패했어요. 남은 건 그대로 나만 볼 수 있어요.`);
        setChosen(new Set(failed.map((result) => result.recordId)));
        return;
      }
      toast.error('보여주지 못했어요. 기록은 그대로 나만 볼 수 있어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="waiting-period-reveal"
      aria-labelledby="waiting-reveal-heading"
      className="rounded-surface bg-card border border-coral/30 p-4 space-y-3"
    >
      <div className="space-y-1">
        <h3 id="waiting-reveal-heading" className="text-label font-bold text-foreground flex items-center gap-1.5">
          <Lock size={14} className="text-coral" aria-hidden="true" />
          연결 전에 남긴 기록이 있어요
        </h3>
        <p className="text-caption text-muted-foreground break-keep leading-relaxed">
          {profile.couple.partnerName || '상대방'}님이 오기 전에 쓴 {offer.candidates.length}개예요.
          지금은 나만 볼 수 있어요. 보여주고 싶은 것만 골라 주세요.
        </p>
      </div>

      <ul className="space-y-1">
        {offer.candidates.map((candidate) => {
          const picked = chosen.has(candidate.recordId);
          return (
            <li key={candidate.recordId}>
              <label
                className={`press-response-row flex items-start gap-2.5 min-h-11 px-2 -mx-2 rounded-control cursor-pointer ${
                  picked ? 'bg-coral/5' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={picked}
                  onChange={() => toggle(candidate.recordId)}
                  aria-label={`${candidate.date} ${candidate.time} 기록 보여주기`}
                  className="mt-1 h-4 w-4 accent-coral shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-foreground break-keep line-clamp-2">
                    {candidate.preview}
                  </span>
                  <span className="block text-caption text-muted-foreground tabular-nums mt-0.5">
                    {candidate.date} {candidate.time}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          data-testid="waiting-period-keep"
          onClick={() => setDismissed(true)}
          disabled={saving}
          className="press-response-row flex-1 min-h-11 rounded-control bg-muted text-label font-bold text-muted-foreground disabled:opacity-50"
        >
          그대로 둘게요
        </button>
        <button
          type="button"
          data-testid="waiting-period-reveal-confirm"
          onClick={() => void reveal()}
          disabled={chosen.size === 0 || saving || isOffline}
          title={isOffline ? OFFLINE_READONLY_MESSAGE : undefined}
          className="press-response flex-1 min-h-11 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold disabled:opacity-50"
        >
          {saving ? '보여주는 중...' : `고른 ${chosen.size}개 보여주기`}
        </button>
      </div>
    </section>
  );
}
