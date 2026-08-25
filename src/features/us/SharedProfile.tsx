import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Grid3x3, Image as ImageIcon, Lock, Menu, Plane, Plus, SquarePen, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { buildCoupleStats } from '@/lib/coupleStats';
import { loadThirdSlot } from '@/lib/thirdSlotPreference';
import { PostGrid } from '@/features/us/PostGrid';
import { getPhotoAttachments } from '@/features/us/postTiles';
import { PostComposerSheet } from '@/features/us/PostComposerSheet';
import { ProfileIdentity } from '@/components/ProfileIdentity';
import { AvatarPicker } from '@/components/AvatarPicker';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { InkCircle, PenFace } from '@/components/paper';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import { useMediaAttachment } from '@/lib/useMediaAttachment';
import { renderProfileCaption } from '@/lib/profileCaption';
import { effectiveDischargeDate } from '@/lib/milestones';
import { localToday } from '@/lib/cycle';
import { formatLocalDate } from '@/lib/utils';
import { TRIP_PHASE_ORDER, TRIP_PHASE_PILL, groupTripsByPhase, type TripPhase } from '@/lib/tripPhase';
import type { Attachment, CoupleHighlight, DailyRecord, Trip } from '@/types';

type ProfileTab = 'grid' | 'photo' | 'trip';

export function SharedProfile() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, saveCoupleHighlight, deleteCoupleHighlight, addRecordWithMedia } = useStore();
  const { profile } = state;
  const todayStr = localToday();
  const [tab, setTab] = useState<ProfileTab>('grid');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [editingHighlightId, setEditingHighlightId] = useState<string | null | undefined>(undefined);
  const [highlightTitle, setHighlightTitle] = useState('');
  const [highlightRecordIds, setHighlightRecordIds] = useState<string[]>([]);
  const [highlightCoverId, setHighlightCoverId] = useState<string | undefined>();
  const [isSavingHighlight, setIsSavingHighlight] = useState(false);
  const [composingPost, setComposingPost] = useState(false);
  const [isPublishingPost, setIsPublishingPost] = useState(false);
  const closeHighlightEditor = () => {
    if (!isSavingHighlight) setEditingHighlightId(undefined);
  };

  /**
   * 게시물을 올린다. **새 테이블을 만들지 않는다.**
   *
   * 프로필 격자는 이미 사진이 붙은 기록으로 만들어지므로(`postTiles.ts`), 게시물은 사진이
   * 붙은 기록 하나다. 그래서 기존 `addRecordWithMedia` 를 그대로 쓴다 -- 그 경로가 이미
   * 커플 권한, 보호 게이트, 오프라인 큐, 파일별 실패를 다룬다. 게시물 전용 저장 경로를
   * 새로 만들면 그 네 가지를 처음부터 다시 맞춰야 하고, 하나라도 빠지면 게시물만 권한
   * 검사가 약한 문이 된다.
   *
   * 여행·스토리에서 고른 사진은 이미 서버에 있으므로 다시 올리지 않고 글로 잇는다. 사본을
   * 만들면 원본을 지웠을 때 게시물의 사진이 어떻게 되는지 답할 수 없다.
   */
  const publishPost = async (input: {
    caption: string;
    isPrivate: boolean;
    files: File[];
    reusedRecordIds: string[];
  }) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setIsPublishingPost(true);
    let result: Awaited<ReturnType<typeof addRecordWithMedia>>;
    try {
      result = await addRecordWithMedia({
        date: todayStr,
        time,
        authorRole: profile.role,
        log: input.caption,
        isPrivate: input.isPrivate,
        talkAbout: false,
        emotionFlow: [],
        emotionUpdatedAt: null,
      }, input.files);
    } finally {
      setIsPublishingPost(false);
    }

    if (result.queued) {
      setComposingPost(false);
      toast.success('지금은 보내지 못해 저장해 뒀어요. 연결되면 자동으로 올라가요.');
      return;
    }
    if (!result.ok) {
      toast.error(result.error || '게시물을 올리지 못했어요.');
      return;
    }
    if (result.failedFiles.length > 0) {
      toast.error(`사진 ${result.failedFiles.length}장을 올리지 못했어요.`);
    }
    setComposingPost(false);
    toast.success('게시물을 올렸어요.');
  };

  const sharedRecords = useMemo(
    () => visibleRecordsForViewer(state.records ?? [], { userId: profile.id, role: profile.role })
      .filter((record) => !record.isPrivate),
    [profile.id, profile.role, state.records],
  );
  const sharedEvents = useMemo(
    () => (state.events ?? []).filter((event) => !event.isPrivate),
    [state.events],
  );
  const photoRecords = useMemo(
    () => sharedRecords.filter((record) => getPhotoAttachments(record).length > 0),
    [sharedRecords],
  );
  const selectedPost = selectedPostId
    ? photoRecords.find((record) => record.id === selectedPostId) ?? null
    : null;
  const highlights = state.coupleHighlights ?? [];
  const hasMilitary = Boolean(effectiveDischargeDate(profile.military));
  const stats = useMemo(
    () => buildCoupleStats({
      anniversaryDate: profile.couple.anniversaryDate,
      events: sharedEvents,
      military: profile.military,
      todayStr,
      thirdSlot: loadThirdSlot(profile.id || '', hasMilitary),
    }),
    [hasMilitary, profile.couple.anniversaryDate, profile.id, profile.military, sharedEvents, todayStr],
  );
  const caption = useMemo(
    () => renderProfileCaption({
      template: profile.profileCaption,
      anniversaryDate: profile.couple.anniversaryDate,
      events: sharedEvents,
      military: profile.military,
      todayStr,
    }),
    [profile.couple.anniversaryDate, profile.military, profile.profileCaption, sharedEvents, todayStr],
  );

  const openCreateHighlight = () => {
    setEditingHighlightId(null);
    setHighlightTitle('');
    setHighlightRecordIds([]);
    setHighlightCoverId(undefined);
  };
  const openEditHighlight = (highlight: CoupleHighlight) => {
    const visibleIds = new Set(photoRecords.map((record) => record.id));
    const recordIds = highlight.recordIds.filter((id) => visibleIds.has(id));
    setEditingHighlightId(highlight.id);
    setHighlightTitle(highlight.title);
    setHighlightRecordIds(recordIds);
    setHighlightCoverId(recordIds.includes(highlight.coverRecordId || '') ? highlight.coverRecordId : recordIds[0]);
  };

  /** A photo selected from a story returns to this same editor by record id. */
  useEffect(() => {
    const recordId = searchParams.get('highlightRecord');
    if (!recordId || editingHighlightId !== undefined) return;
    if (!photoRecords.some((record) => record.id === recordId)) return;

    setEditingHighlightId(null);
    setHighlightTitle('');
    setHighlightRecordIds([recordId]);
    setHighlightCoverId(recordId);

    const next = new URLSearchParams(searchParams);
    next.delete('highlightRecord');
    setSearchParams(next, { replace: true });
  }, [editingHighlightId, photoRecords, searchParams, setSearchParams]);
  const toggleHighlightRecord = (recordId: string) => {
    setHighlightRecordIds((current) => {
      if (current.includes(recordId)) {
        const next = current.filter((id) => id !== recordId);
        if (highlightCoverId === recordId) setHighlightCoverId(next[0]);
        return next;
      }
      if (!highlightCoverId) setHighlightCoverId(recordId);
      return [...current, recordId];
    });
  };
  const saveHighlight = async () => {
    const title = highlightTitle.trim();
    if (title.length < 1 || title.length > 20) {
      toast.error('하이라이트 이름은 1~20자로 입력해 주세요.');
      return;
    }
    if (highlightRecordIds.length === 0) {
      toast.error('사진을 하나 이상 골라 주세요.');
      return;
    }
    if (isSavingHighlight) return;
    setIsSavingHighlight(true);
    const existing = editingHighlightId
      ? highlights.find((item) => item.id === editingHighlightId)
      : undefined;
    const result = await saveCoupleHighlight({
      id: editingHighlightId || undefined,
      coupleId: profile.couple.coupleId || '',
      title,
      recordIds: highlightRecordIds,
      coverRecordId: highlightCoverId,
      sortOrder: existing?.sortOrder ?? highlights.length,
    });
    setIsSavingHighlight(false);
    if (!result.ok) {
      toast.error('하이라이트를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    setEditingHighlightId(undefined);
    toast.success('하이라이트를 저장했어요.');
  };
  const removeHighlight = async () => {
    if (!editingHighlightId || isSavingHighlight) return;
    setIsSavingHighlight(true);
    const removed = await deleteCoupleHighlight(editingHighlightId);
    setIsSavingHighlight(false);
    if (!removed) {
      toast.error('하이라이트를 삭제하지 못했어요.');
      return;
    }
    setEditingHighlightId(undefined);
    toast.success('하이라이트를 삭제했어요.');
  };

  return (
    <div className="min-h-full pb-8">
      <header className="flex h-14 items-center gap-2 px-4" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
        {/*
          왼쪽 끝이 게시물 만들기다.

          인스타의 `＋` 는 탭바 가운데에 있지만 곰신로그의 탭바 가운데는 이미 기록이
          차지하고 있다. 마이 화면에서 만드는 것은 **이 프로필의 게시물**이므로 이 화면의
          헤더가 그 자리다. 아이디를 가운데로 옮겨 좌우 무게를 맞춘다.
        */}
        <button type="button" aria-label="게시물 만들기" data-testid="open-post-composer" onClick={() => setComposingPost(true)} className="flex h-11 w-11 shrink-0 items-center justify-center">
          <Plus size={22} color="var(--ink)" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          {profile.username ? (
            <span className="truncate text-body font-bold" style={{ color: 'var(--ink)' }}>@{profile.username}</span>
          ) : (
            <button type="button" onClick={() => navigate('/settings?profile=edit')} className="inline-flex min-h-11 items-center truncate text-body font-semibold underline underline-offset-2" style={{ color: 'var(--ink-soft)' }}>
              아이디 설정하기
            </button>
          )}
          <Lock size={13} className="shrink-0" color="var(--ink-soft)" aria-label="둘만 볼 수 있어요" />
        </div>
        <button type="button" aria-label="기록 남기기" onClick={() => navigate('/compose')} className="flex h-11 w-11 items-center justify-center">
          <SquarePen size={20} color="var(--ink)" aria-hidden="true" />
        </button>
        <button type="button" aria-label="설정" onClick={() => navigate('/settings')} className="flex h-11 w-11 items-center justify-center">
          <Menu size={22} color="var(--ink)" aria-hidden="true" />
        </button>
      </header>

      <div className="px-4"><CoupleStatusBanner /></div>
      <div className="flex items-center gap-4 px-4 pt-1">
        <AvatarPicker userId={state.authenticatedUser?.id || profile.id} slot="me" size={78} label="내 프로필 사진">
          <InkCircle size={78} ring="seen"><PenFace size={52} /></InkCircle>
        </AvatarPicker>
        <div className="flex flex-1 items-stretch justify-around">
          {stats.map((stat) => (
            <button key={stat.label} type="button" disabled={!stat.href} onClick={() => stat.href && navigate(stat.href)} className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 disabled:cursor-default">
              <span className="text-heading font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{stat.value}</span>
              <span className="text-caption" style={{ color: 'var(--ink-soft)' }}>{stat.label}</span>
            </button>
          ))}
        </div>
      </div>
      <ProfileIdentity name={profile.myName} caption={caption} />
      <div className="px-4 pt-3">
        <button type="button" aria-label="프로필 편집" onClick={() => navigate('/settings?profile=edit')} className="press-response-row min-h-11 w-full rounded-control border border-border px-3 py-2 text-label font-semibold text-foreground">
          프로필 편집
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto px-4 pb-1 pt-5" data-testid="profile-highlights">
        <button type="button" aria-label="하이라이트 만들기" onClick={openCreateHighlight} className="flex w-[66px] shrink-0 flex-col items-center gap-1.5">
          <InkCircle size={60} ring="none"><span className="text-heading font-light" style={{ color: 'var(--ink-soft)' }}>+</span></InkCircle>
          <span className="max-w-[66px] truncate text-caption" style={{ color: 'var(--ink)' }}>만들기</span>
        </button>
        {highlights.map((item) => (
          <div key={item.id} className="flex w-[66px] shrink-0 flex-col items-center gap-1.5">
            <ProfileHighlightButton
              highlight={item}
              records={photoRecords}
              coupleId={profile.couple.coupleId}
              onOpen={() => navigate(`/story/highlight/${item.id}`)}
              onEdit={() => openEditHighlight(item)}
            />
          </div>
        ))}
      </div>

      {editingHighlightId !== undefined ? (
        <HighlightEditor
          title={highlightTitle}
          setTitle={setHighlightTitle}
          records={photoRecords}
          coupleId={profile.couple.coupleId}
          selectedIds={highlightRecordIds}
          coverId={highlightCoverId}
          onToggle={toggleHighlightRecord}
          onSetCover={(recordId) => {
            if (!highlightRecordIds.includes(recordId)) toggleHighlightRecord(recordId);
            setHighlightCoverId(recordId);
          }}
          editing={Boolean(editingHighlightId)}
          busy={isSavingHighlight}
          onClose={closeHighlightEditor}
          onSave={() => void saveHighlight()}
          onDelete={editingHighlightId ? () => void removeHighlight() : undefined}
        />
      ) : null}

      <div className="mt-4 flex border-t" style={{ borderColor: 'var(--ink-faint)' }}>
        {([
          { id: 'grid', Icon: Grid3x3, label: '격자' },
          { id: 'photo', Icon: ImageIcon, label: '사진' },
          { id: 'trip', Icon: Plane, label: '여행' },
        ] as const).map(({ id, Icon, label }) => (
          <button key={id} type="button" aria-label={label} aria-pressed={tab === id} onClick={() => setTab(id)} className="profile-tab flex min-h-11 flex-1 items-center justify-center py-3" style={{ borderBottom: `var(--stroke-bold) solid ${tab === id ? 'var(--ink)' : 'transparent'}` }}>
            <Icon size={20} color={tab === id ? 'var(--ink)' : 'var(--ink-soft)'} aria-hidden="true" />
          </button>
        ))}
      </div>

      {tab === 'trip' ? (
        <SharedTripList trips={state.trips ?? []} todayStr={todayStr} onOpen={(id) => navigate(`/trips/${encodeURIComponent(id)}`)} onOpenAll={() => navigate('/trips')} />
      ) : tab === 'photo' ? (
        <SharedRecordList records={sharedRecords} coupleId={profile.couple.coupleId} onOpen={(id) => navigate(`/record?record=${encodeURIComponent(id)}`)} />
      ) : (
        <PostGrid
          records={photoRecords}
          coupleId={profile.couple.coupleId}
          onOpen={setSelectedPostId}
          emptyMessage="함께 공개한 사진이 아직 없어요."
          ariaLabel="사진 게시물 격자"
        />
      )}

      {selectedPost ? (
        <PhotoPostViewer record={selectedPost} coupleId={profile.couple.coupleId} onClose={() => setSelectedPostId(null)} onOpenRecord={(id) => { setSelectedPostId(null); navigate(`/record?record=${encodeURIComponent(id)}`); }} />
      ) : null}

      {composingPost ? (
        <PostComposerSheet
          records={sharedRecords}
          trips={state.trips ?? []}
          coupleId={profile.couple.coupleId}
          connected={profile.couple.connected}
          busy={isPublishingPost}
          onClose={() => { if (!isPublishingPost) setComposingPost(false); }}
          onSubmit={(input) => { void publishPost(input); }}
        />
      ) : null}
    </div>
  );
}

const EMPTY_RECORD_ATTACHMENT: Attachment = { type: 'photo', name: '' };

function SharedRecordList({ records, coupleId, onOpen }: { records: DailyRecord[]; coupleId?: string; onOpen: (recordId: string) => void }) {
  const ordered = useMemo(
    () => [...records].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)),
    [records],
  );

  if (ordered.length === 0) {
    return <p className="px-8 pt-12 text-center text-label leading-relaxed" style={{ color: 'var(--ink-soft)' }}>함께 공개한 기록이 아직 없어요.</p>;
  }

  return (
    <section className="space-y-2 px-4 pt-3" data-testid="profile-record-list" aria-label="공유 기록 목록">
      {ordered.map((record) => <SharedRecordRow key={record.id} record={record} coupleId={coupleId} onOpen={onOpen} />)}
    </section>
  );
}

function SharedRecordRow({ record, coupleId, onOpen }: { record: DailyRecord; coupleId?: string; onOpen: (recordId: string) => void }) {
  const photo = getPhotoAttachments(record)[0];
  const { url, reportLoadFailure } = useMediaAttachment(photo || EMPTY_RECORD_ATTACHMENT, coupleId, record.id);
  const summary = record.contentUnavailable
    ? '이 기록의 글을 아직 열 수 없어요.'
    : record.log.trim() || (photo ? '사진을 남겼어요.' : '기록을 남겼어요.');

  return (
    <button type="button" data-testid={`profile-record-${record.id}`} onClick={() => onOpen(record.id)} className="press-response flex min-h-20 w-full items-center gap-3 rounded-control border border-border bg-card px-3 py-2 text-left">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted">
        {url ? <img src={url} alt="" onError={reportLoadFailure} className="h-full w-full object-cover" /> : <ImageIcon size={20} color="var(--ink-soft)" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>{formatLocalDate(record.date)}{record.time ? ` · ${record.time}` : ''}</span>
        <span className="mt-1 block line-clamp-2 text-label leading-relaxed" style={{ color: 'var(--ink)' }}>{summary}</span>
      </span>
    </button>
  );
}

function HighlightCircle({ highlight, records, coupleId }: { highlight: CoupleHighlight; records: DailyRecord[]; coupleId?: string }) {
  const record = records.find((item) => item.id === (highlight.coverRecordId || highlight.recordIds[0]));
  const photo = record ? getPhotoAttachments(record)[0] : undefined;
  if (!photo || !record) {
    return <InkCircle size={60} ring="seen"><ImageIcon size={22} color="var(--ink-soft)" aria-hidden="true" /></InkCircle>;
  }
  return <HighlightMedia photo={photo} coupleId={coupleId} recordId={record.id} />;
}

function ProfileHighlightButton({ highlight, records, coupleId, onOpen, onEdit }: { highlight: CoupleHighlight; records: DailyRecord[]; coupleId?: string; onOpen: () => void; onEdit: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      onPointerDown={() => {
        longPressed.current = false;
        timer.current = setTimeout(() => {
          longPressed.current = true;
          onEdit();
        }, 500);
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onContextMenu={(event) => { event.preventDefault(); onEdit(); }}
      onClick={() => {
        clear();
        if (!longPressed.current) onOpen();
        longPressed.current = false;
      }}
      className="flex w-full flex-col items-center gap-1.5"
      aria-label={`${highlight.title} 하이라이트 보기`}
    >
      <HighlightCircle highlight={highlight} records={records} coupleId={coupleId} />
      <span className="max-w-[66px] truncate text-caption" style={{ color: 'var(--ink)' }}>{highlight.title}</span>
    </button>
  );
}

function HighlightMedia({ photo, coupleId, recordId }: { photo: NonNullable<ReturnType<typeof getPhotoAttachments>[number]>; coupleId?: string; recordId: string }) {
  const { url, reportLoadFailure } = useMediaAttachment(photo, coupleId, recordId);
  return (
    <InkCircle size={60} ring="seen">
      {url ? <img src={url} alt="" onError={reportLoadFailure} className="h-full w-full rounded-full object-cover" /> : <ImageIcon size={22} color="var(--ink-soft)" aria-hidden="true" />}
    </InkCircle>
  );
}

function HighlightEditor({
  title,
  setTitle,
  records,
  coupleId,
  selectedIds,
  coverId,
  onToggle,
  onSetCover,
  editing,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  title: string;
  setTitle: (value: string) => void;
  records: DailyRecord[];
  coupleId?: string;
  selectedIds: string[];
  coverId?: string;
  onToggle: (recordId: string) => void;
  onSetCover: (recordId: string) => void;
  editing: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-foreground/35 p-3" role="dialog" aria-modal="true" aria-labelledby="highlight-editor-title" data-testid="highlight-editor">
      <section className="relative w-full rounded-surface border border-border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="highlight-editor-title" className="text-heading font-semibold text-foreground">{editing ? '하이라이트 편집' : '새 하이라이트'}</h2>
          <button type="button" aria-label="하이라이트 편집 닫기" onClick={onClose} disabled={busy} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground"><X size={19} aria-hidden="true" /></button>
        </div>
        <label className="mt-4 block text-label font-semibold text-foreground">
          이름
          <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 20))} maxLength={20} autoFocus className="mt-1 h-11 w-full rounded-control border border-border bg-background px-3 text-body font-normal outline-none focus:ring-2 focus:ring-coral/40" placeholder="예: 우리의 봄" />
        </label>
        <p className="mt-3 text-caption leading-relaxed text-muted-foreground">
          게시물 격자에서 고르거나, 스토리를 보다가 ‘하이라이트에 추가’를 눌러 가져올 수 있어요.
        </p>
        <div className="mt-2 grid max-h-[38dvh] grid-cols-3 gap-1 overflow-y-auto">
          {records.map((record) => (
            <HighlightPickerTile key={record.id} record={record} coupleId={coupleId} selected={selectedIds.includes(record.id)} cover={coverId === record.id} onToggle={() => onToggle(record.id)} onSetCover={() => onSetCover(record.id)} />
          ))}
        </div>
        {records.length === 0 ? <p className="py-6 text-center text-label text-muted-foreground">함께 공개한 사진이 아직 없어요.</p> : null}
        <div className="flex gap-2 pt-4">
          {onDelete ? <button type="button" onClick={onDelete} disabled={busy} className="min-h-11 px-3 text-label font-semibold text-destructive">삭제</button> : null}
          <button type="button" onClick={onClose} disabled={busy} className="press-response-row ml-auto min-h-11 rounded-control border border-border px-4 text-label font-semibold text-foreground">취소</button>
          <button type="button" onClick={onSave} disabled={busy} className="press-response min-h-11 rounded-control bg-foreground px-4 text-label font-semibold text-background disabled:opacity-50">{busy ? '저장 중…' : '저장'}</button>
        </div>
      </section>
    </div>
  );
}

function HighlightPickerTile({ record, coupleId, selected, cover, onToggle, onSetCover }: { record: DailyRecord; coupleId?: string; selected: boolean; cover: boolean; onToggle: () => void; onSetCover: () => void }) {
  const photo = getPhotoAttachments(record)[0];
  return (
    <div className="relative aspect-square overflow-hidden rounded-control bg-muted">
      <button type="button" onClick={onToggle} aria-label={`${record.date} 사진 ${selected ? '선택 해제' : '선택'}`} className="h-full w-full">
        {photo ? <HighlightPickerMedia photo={photo} coupleId={coupleId} recordId={record.id} /> : <span className="flex h-full items-center justify-center"><ImageIcon size={20} color="var(--ink-soft)" /></span>}
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-black/40 text-caption text-white">{selected ? '✓' : ''}</span>
      </button>
      {selected ? <button type="button" onClick={onSetCover} className="absolute bottom-1 left-1 rounded-full bg-black/55 px-2 py-1 text-caption font-semibold text-white">{cover ? '커버' : '커버로'}</button> : null}
    </div>
  );
}

function HighlightPickerMedia({ photo, coupleId, recordId }: { photo: NonNullable<ReturnType<typeof getPhotoAttachments>[number]>; coupleId?: string; recordId: string }) {
  const { url, reportLoadFailure } = useMediaAttachment(photo, coupleId, recordId);
  return url ? <img src={url} alt="" onError={reportLoadFailure} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center"><ImageIcon size={20} color="var(--ink-soft)" /></span>;
}

function SharedTripList({ trips, todayStr, onOpen, onOpenAll }: { trips: Trip[]; todayStr: string; onOpen: (id: string) => void; onOpenAll: () => void }) {
  const ordered = useMemo(() => {
    const grouped = groupTripsByPhase(trips, todayStr);
    return TRIP_PHASE_ORDER.flatMap((phase) => grouped[phase].map((trip) => ({ trip, phase })));
  }, [todayStr, trips]);
  const visible = ordered.slice(0, 3);
  return (
    <section className="space-y-2 px-4 pt-3" data-testid="profile-trips-list" aria-label="여행 요약">
      <div className="flex items-center justify-between"><span className="text-caption font-semibold" style={{ color: 'var(--ink-soft)' }}>여행 {trips.length || ''}</span><button type="button" onClick={onOpenAll} className="text-caption font-semibold underline" style={{ color: 'var(--ink-soft)' }}>전체 보기</button></div>
      {visible.length > 0 ? visible.map(({ trip, phase }) => <TripRow key={trip.id} trip={trip} phase={phase} onOpen={onOpen} />) : <div className="rounded-control px-4 py-6 text-center" style={{ background: 'var(--paper)', border: 'var(--stroke-thin) solid var(--ink-faint)' }}><p className="text-label" style={{ color: 'var(--ink-soft)' }}>등록한 여행이 없어요.</p><button type="button" onClick={onOpenAll} className="ink-chip mt-3 min-h-11 px-4"><span className="text-label" style={{ color: 'var(--ink)' }}>여행 만들기</span></button></div>}
    </section>
  );
}

function TripRow({ trip, phase, onOpen }: { trip: Trip; phase: TripPhase; onOpen: (id: string) => void }) {
  const dateLabel = trip.startDate === trip.endDate ? formatLocalDate(trip.startDate) : `${formatLocalDate(trip.startDate)} ~ ${formatLocalDate(trip.endDate)}`;
  return <button type="button" data-testid={`profile-trip-${trip.id}`} aria-label={`${trip.title} 열기`} onClick={() => onOpen(trip.id)} className="press-response flex min-h-16 w-full items-center gap-3 rounded-control px-3 text-left" style={{ background: 'var(--paper)', border: 'var(--stroke-thin) solid var(--ink-faint)' }}><CalendarDays size={18} className="shrink-0" color="var(--ink-soft)" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-label font-semibold" style={{ color: 'var(--ink)' }}>{trip.title}</span><span className="shrink-0 text-caption" style={{ color: 'var(--ink-soft)' }}>{TRIP_PHASE_PILL[phase]}</span></span><span className="mt-0.5 block truncate text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>{dateLabel}</span></span></button>;
}

function PhotoPostViewer({ record, coupleId, onClose, onOpenRecord }: { record: DailyRecord; coupleId?: string; onClose: () => void; onOpenRecord: (id: string) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const photos = getPhotoAttachments(record);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (photos.length === 0) return null;
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-labelledby="photo-post-viewer-title" data-testid="photo-post-viewer" className="max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-4 shadow-xl sm:rounded-surface" onPointerDown={(event) => event.stopPropagation()}><header className="flex min-h-11 items-center gap-3"><h2 id="photo-post-viewer-title" className="min-w-0 flex-1 text-label font-semibold text-card-foreground">{formatLocalDate(record.date)}{record.time ? ` ${record.time}` : ''}</h2><button ref={closeRef} type="button" onClick={onClose} aria-label="사진 게시물 닫기" className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground"><X size={19} aria-hidden="true" /></button></header><div className="pt-3"><RecordMediaGallery attachments={photos} coupleId={coupleId} recordId={record.id} /></div>{record.contentUnavailable ? <p className="pt-3 text-caption leading-relaxed text-muted-foreground">이 기록의 글은 이 기기에서 아직 열 수 없어요.</p> : record.log.trim() ? <p className="hand-text whitespace-pre-wrap break-keep pt-3 text-body text-card-foreground">{record.log}</p> : null}<div className="flex justify-end pt-3"><button type="button" onClick={() => onOpenRecord(record.id)} className="ink-chip min-h-9 px-3 text-caption font-semibold" style={{ color: 'var(--ink)' }}>원본 보기</button></div></div></div>;
}
