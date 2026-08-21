import { useState } from 'react';
import { Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';

/**
 * 연락 가능 시간 — the window a person is willing to be reached in.
 *
 * ## Why this became editable, and visible to both roles
 *
 * It used to render for 군화 only, read-only, described as feeding "briefing
 * recommendations". Two of those three are now wrong.
 *
 * Migration 048 sends each recipient's notification inside THEIR OWN declared
 * window. PRODUCT_V3 §14.3 is explicit that the send time comes from hours the
 * user typed in and never from a learned access pattern -- so this value is no
 * longer a hint, it is the only thing standing between someone and a 03:00
 * notification. A 곰신 who could not see it had no control over when the app
 * reaches them, and a value nobody can edit is a preference in name only.
 *
 * ## The question differs by role even though the field does not
 *
 * For 군화 it describes a constraint: there are hours when a phone is reachable
 * and hours when it is not. For 곰신 it is a preference -- they can look whenever
 * they like, so what this decides is when the app may interrupt them.
 *
 * ## What it promises
 *
 * Nothing outside the window, at most once a day, no content in the payload.
 * Each is enforced elsewhere -- the cap and the window inside
 * `push_delivery_candidates()`, the body as a constant in the sender -- so the
 * copy here describes a guarantee rather than making one.
 */
export function ContactHoursSection() {
  const { state, updateProfile } = useStore();
  const isOffline = !useOnlineStatus();
  const { contact, role } = state.profile;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    weekdayStart: contact.weekdayStart,
    weekdayEnd: contact.weekdayEnd,
    weekendStart: contact.weekendStart,
    weekendEnd: contact.weekendEnd,
  });

  const save = async () => {
    // Same guard shape as the reveal card and call mode. The button is disabled
    // too, but `disabled` is applied on the next render and a guard here is what
    // actually holds -- a lesson from a mutation that survived a disabled-only
    // check earlier in this branch.
    if (saving) return;
    /*
      An end before a start is not a window, it is silence. The database would
      accept it and `push_delivery_candidates()` would simply never match, so the
      person would stop receiving notifications with nothing on screen to explain
      why. Refused here, where it can be explained.
    */
    if (draft.weekdayEnd <= draft.weekdayStart || draft.weekendEnd <= draft.weekendStart) {
      toast.error('끝나는 시간이 시작 시간보다 늦어야 해요.');
      return;
    }
    /*
      Named, the way the call screen and the reveal card name it.

      Without this the failure surfaces as "잠시 후 다시 시도해 주세요", which is
      true of a great many things and tells someone with no signal nothing they
      can act on. `serverErrorCopy` exists because this app kept reporting causes
      it had not established; reporting one it HAS is the other half of that.
    */
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }

    setSaving(true);
    try {
      const ok = await updateProfile({ contact: { ...contact, ...draft } });
      if (!ok) {
        toast.error('시간을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      toast.success('알림 받을 시간을 바꿨어요.');
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    startKey: 'weekdayStart' | 'weekendStart',
    endKey: 'weekdayEnd' | 'weekendEnd',
  ) => (
    <div>
      <label className="text-caption font-semibold text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="time"
          aria-label={`${label} 시작`}
          value={draft[startKey]}
          onChange={(event) => setDraft((d) => ({ ...d, [startKey]: event.target.value }))}
          className="flex-1 h-11 px-3 rounded-control bg-background border border-border text-body outline-none"
        />
        <span aria-hidden="true">~</span>
        <input
          type="time"
          aria-label={`${label} 끝`}
          value={draft[endKey]}
          onChange={(event) => setDraft((d) => ({ ...d, [endKey]: event.target.value }))}
          className="flex-1 h-11 px-3 rounded-control bg-background border border-border text-body outline-none"
        />
      </div>
    </div>
  );

  return (
    <section
      data-testid="contact-hours"
      className="rounded-surface bg-card border border-border p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-label font-bold text-foreground">
          <Clock size={16} className="text-coral" aria-hidden="true" />
          <span>알림 받을 시간</span>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => { setDraft({ ...contact }); setEditing(true); }}
            className="press-response-row min-h-11 px-2 -mr-2 rounded-control text-caption font-bold text-coral-strong"
          >
            바꾸기
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          {field('평일', 'weekdayStart', 'weekdayEnd')}
          {field('주말', 'weekendStart', 'weekendEnd')}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="press-response-row flex-1 min-h-11 rounded-control bg-muted text-label font-bold text-muted-foreground disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || isOffline}
              title={isOffline ? OFFLINE_READONLY_MESSAGE : undefined}
              className="press-response flex-1 min-h-11 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-body text-foreground tabular-nums">
            평일 {contact.weekdayStart} ~ {contact.weekdayEnd}
            <span className="text-muted-foreground"> · </span>
            주말 {contact.weekendStart} ~ {contact.weekendEnd}
          </p>
          <p className="text-caption text-muted-foreground break-keep leading-relaxed">
            {role === 'soldier'
              ? '이 시간에만 알림을 보내드려요. 하루에 한 번을 넘지 않고, 알림에는 기록 내용이 담기지 않아요.'
              : '이 시간 밖에서는 알리지 않아요. 하루에 한 번을 넘지 않고, 알림에는 기록 내용이 담기지 않아요.'}
          </p>
        </div>
      )}
    </section>
  );
}
