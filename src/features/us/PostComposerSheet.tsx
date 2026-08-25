import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, GripVertical, Image as ImageIcon, Plane, Sparkles, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { MEDIA_ACCEPT, MEDIA_POLICY_REFUSAL, classifyMediaFile } from '@/lib/records';
import { formatLocalDate } from '@/lib/utils';
import { useMediaAttachment } from '@/lib/useMediaAttachment';
import {
  MAX_POST_PHOTOS,
  containsAttachment,
  movePostItem,
  remainingPostSlots,
  removePostItem,
  selectablePhotos,
  tripDateSet,
  type PostDraftItem,
  type SelectablePhoto,
} from '@/features/us/postComposition';
import type { Attachment, DailyRecord, Trip } from '@/types';

/**
 * 게시물 만들기. **인스타그램의 세 단계를 그대로 따르되, 곰신로그가 줄 수 없는 것은 넣지 않는다.**
 *
 * 인스타는 고르기 → 순서·편집 → 캡션 세 화면을 쓴다. 그 분할이 좋은 이유는 각 화면이 한
 * 가지만 묻기 때문이다: 무엇을, 어떤 순서로, 무슨 말과 함께. 한 화면에 다 넣으면 사진을
 * 고르는 동안 캡션 칸이 비어 있는 채로 시선을 끌고, 순서를 바꾸는 드래그가 스크롤과 싸운다.
 *
 * ## 인스타에 있고 여기 없는 것
 *
 * - **영상.** `classifyMediaFile` 이 사진 외를 거부한다(`MEDIA_POLICY_REFUSAL`). E2EE 이전에
 *   평문 영상 경로를 열지 않기로 한 결정이므로 이 화면이 그것을 우회하지 않는다.
 * - **사람 태그.** 상대가 한 명인 관계 앱에서 태그할 대상은 이미 정해져 있다.
 * - **위치.** 여행 기능이 장소를 소유한다. 같은 개념을 두 곳에 두지 않고 "여행에서 고르기" 로 잇는다.
 * - **필터.** 시각 정체성은 디자인 워크스트림 소유이고, 이 표면은 기능만 담당한다.
 *
 * ## 이미 서버에 있는 사진은 다시 올리지 않는다
 *
 * 여행·스토리에서 고른 사진은 `existing` 항목이 되어 원본 기록을 가리킨다. 사본을 만들면
 * 저장 비용이 두 배가 되고, 원본을 지웠을 때 게시물의 사진이 어떻게 되는지 답할 수 없다.
 */

type Step = 'source' | 'arrange' | 'caption';

export interface PostComposerSheetProps {
  /** 이미 권한 판정을 통과한, 이 커플이 볼 수 있는 기록 전부. */
  records: readonly DailyRecord[];
  trips: readonly Trip[];
  coupleId?: string;
  /** 연결 전에는 공개 범위를 고를 수 없고 항상 비공개로 저장된다. */
  connected: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (input: {
    caption: string;
    isPrivate: boolean;
    files: File[];
    reusedRecordIds: string[];
  }) => void;
}

export function PostComposerSheet({
  records,
  trips,
  coupleId,
  connected,
  busy = false,
  onClose,
  onSubmit,
}: PostComposerSheetProps) {
  const [step, setStep] = useState<Step>('source');
  const [items, setItems] = useState<PostDraftItem[]>([]);
  const [caption, setCaption] = useState('');
  const [isPrivate, setIsPrivate] = useState(!connected);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const createdUrls = useRef<string[]>([]);

  useEffect(() => closeRef.current?.focus(), []);

  /*
    미리보기 URL 은 이 시트가 만든 자원이므로 이 시트가 놓아준다.

    `createObjectURL` 은 문서가 사라질 때까지 살아 있다. 사진 열 장을 고르고 시트를 닫는
    동작을 몇 번 반복하면 그만큼의 파일이 메모리에 남고, PWA 는 사용자가 며칠씩 열어 두는
    앱이다.
  */
  useEffect(() => () => {
    for (const url of createdUrls.current) URL.revokeObjectURL(url);
  }, []);

  const tripDates = useMemo(() => tripDateSet(trips), [trips]);
  const storyPhotos = useMemo(() => selectablePhotos(records), [records]);
  const tripPhotos = useMemo(
    () => selectablePhotos(records, { dates: tripDates }),
    [records, tripDates],
  );

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const room = remainingPostSlots(items);
    if (room === 0) {
      toast.info(`사진은 ${MAX_POST_PHOTOS}장까지 담을 수 있어요.`);
      return;
    }
    const accepted: PostDraftItem[] = [];
    let refused = false;
    for (const file of Array.from(fileList)) {
      if (accepted.length >= room) {
        toast.info(`사진은 ${MAX_POST_PHOTOS}장까지 담을 수 있어요.`);
        break;
      }
      // 사진만 통과한다. 영상·음성은 정책이 거부하는 것이고 "지원되지 않음" 이 아니다.
      const classified = classifyMediaFile(file);
      if ('error' in classified || classified.type !== 'photo') {
        refused = true;
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      createdUrls.current.push(previewUrl);
      accepted.push({
        kind: 'file',
        id: `file-${Date.now()}-${accepted.length}-${file.name}`,
        file,
        previewUrl,
      });
    }
    if (refused) toast.error(MEDIA_POLICY_REFUSAL);
    if (accepted.length === 0) return;
    setItems((prev) => [...prev, ...accepted]);
    setStep('arrange');
  }, [items]);

  const addExisting = useCallback((photo: SelectablePhoto) => {
    setItems((prev) => {
      if (containsAttachment(prev, photo.attachment)) {
        toast.info('이미 담은 사진이에요.');
        return prev;
      }
      if (remainingPostSlots(prev) === 0) {
        toast.info(`사진은 ${MAX_POST_PHOTOS}장까지 담을 수 있어요.`);
        return prev;
      }
      return [...prev, {
        kind: 'existing',
        id: `existing-${photo.recordId}-${photo.attachment.path ?? photo.attachment.name}`,
        sourceRecordId: photo.recordId,
        attachment: photo.attachment,
      }];
    });
  }, []);

  const submit = () => {
    if (items.length === 0) {
      toast.info('사진을 한 장 이상 담아 주세요.');
      return;
    }
    onSubmit({
      caption: caption.trim(),
      isPrivate: connected ? isPrivate : true,
      files: items.filter((item) => item.kind === 'file').map((item) => item.file),
      reusedRecordIds: [...new Set(
        items.filter((item) => item.kind === 'existing').map((item) => item.sourceRecordId),
      )],
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-foreground/40 sm:items-center sm:p-4"
      onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-composer-title"
        data-testid="post-composer"
        className="max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-4 shadow-xl sm:rounded-surface"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-11 items-center gap-2">
          {step === 'source' ? (
            <button ref={closeRef} type="button" onClick={onClose} disabled={busy} aria-label="게시물 만들기 닫기" className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground">
              <X size={19} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={() => setStep(step === 'caption' ? 'arrange' : 'source')} disabled={busy} aria-label="이전 단계" className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground">
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
          )}
          <h2 id="post-composer-title" className="min-w-0 flex-1 text-label font-semibold text-card-foreground">
            {step === 'source' ? '새 게시물' : step === 'arrange' ? '순서 정하기' : '글 쓰기'}
          </h2>
          {step === 'arrange' ? (
            <button type="button" onClick={() => setStep('caption')} disabled={busy || items.length === 0} className="press-response min-h-11 rounded-control px-3 text-label font-semibold text-coral-strong disabled:opacity-40">
              다음
            </button>
          ) : step === 'caption' ? (
            <button type="button" onClick={submit} disabled={busy || items.length === 0} data-testid="post-share" className="press-response min-h-11 rounded-control px-3 text-label font-semibold text-coral-strong disabled:opacity-40">
              {busy ? '올리는 중…' : '공유'}
            </button>
          ) : items.length > 0 ? (
            <button type="button" onClick={() => setStep('arrange')} className="press-response min-h-11 rounded-control px-3 text-label font-semibold text-coral-strong">
              다음
            </button>
          ) : null}
        </header>

        {step === 'source' ? (
          <SourceStep
            onPickFiles={() => fileInputRef.current?.click()}
            tripPhotos={tripPhotos}
            storyPhotos={storyPhotos}
            coupleId={coupleId}
            items={items}
            onAdd={addExisting}
          />
        ) : step === 'arrange' ? (
          <ArrangeStep
            items={items}
            coupleId={coupleId}
            dragIndex={dragIndex}
            setDragIndex={setDragIndex}
            onMove={(from, to) => setItems((prev) => movePostItem(prev, from, to))}
            onRemove={(id) => setItems((prev) => removePostItem(prev, id))}
            onAddMore={() => setStep('source')}
          />
        ) : (
          <CaptionStep
            items={items}
            coupleId={coupleId}
            caption={caption}
            setCaption={setCaption}
            connected={connected}
            isPrivate={isPrivate}
            setIsPrivate={setIsPrivate}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          className="sr-only"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function SourceStep({
  onPickFiles,
  tripPhotos,
  storyPhotos,
  coupleId,
  items,
  onAdd,
}: {
  onPickFiles: () => void;
  tripPhotos: SelectablePhoto[];
  storyPhotos: SelectablePhoto[];
  coupleId?: string;
  items: PostDraftItem[];
  onAdd: (photo: SelectablePhoto) => void;
}) {
  const [source, setSource] = useState<'trip' | 'story'>('story');
  const list = source === 'trip' ? tripPhotos : storyPhotos;

  return (
    <div className="pt-3">
      <button type="button" onClick={onPickFiles} data-testid="post-pick-files" className="press-response-row flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border py-3 text-label font-semibold text-foreground">
        <Upload size={17} aria-hidden="true" />
        앨범에서 올리기
      </button>
      <p className="pt-2 text-caption leading-relaxed text-muted-foreground">
        사진만 올릴 수 있어요. 최대 {MAX_POST_PHOTOS}장.
      </p>

      <div className="mt-4 flex gap-2" role="tablist" aria-label="사진 가져올 곳">
        {([
          { id: 'story', label: '스토리에서', Icon: Sparkles },
          { id: 'trip', label: '여행에서', Icon: Plane },
        ] as const).map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={source === id} onClick={() => setSource(id)} className="press-response-row inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-control text-label font-semibold" style={{ border: 'var(--stroke-thin) solid var(--ink-faint)', background: source === id ? 'var(--paper-deep, var(--paper))' : 'transparent', color: 'var(--ink)' }}>
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="px-6 pt-8 pb-4 text-center text-label leading-relaxed text-muted-foreground">
          {source === 'trip' ? '여행 기간에 남긴 사진이 아직 없어요.' : '고를 수 있는 사진이 아직 없어요.'}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1 pt-3" data-testid="post-source-photos" aria-label="고를 수 있는 사진">
          {list.map((photo) => (
            <li key={`${photo.recordId}-${photo.attachment.path}`}>
              <ExistingPhotoButton
                photo={photo}
                coupleId={coupleId}
                picked={containsAttachment(items, photo.attachment)}
                onAdd={onAdd}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExistingPhotoButton({
  photo,
  coupleId,
  picked,
  onAdd,
}: {
  photo: SelectablePhoto;
  coupleId?: string;
  picked: boolean;
  onAdd: (photo: SelectablePhoto) => void;
}) {
  const media = useMediaAttachment(photo.attachment, coupleId, photo.recordId);
  return (
    <button
      type="button"
      onClick={() => onAdd(photo)}
      aria-pressed={picked}
      data-testid="post-source-photo"
      aria-label={`${formatLocalDate(photo.date)}에 남긴 사진 담기${picked ? ' (담음)' : ''}`}
      className="press-response relative block aspect-square w-full overflow-hidden rounded-control"
      style={{ background: 'var(--paper)', border: `var(--stroke-thin) solid ${picked ? 'var(--ink)' : 'var(--ink-faint)'}` }}
    >
      {media.url ? (
        <img src={media.url} alt="" className="h-full w-full object-cover" onError={media.reportLoadFailure} />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ImageIcon size={18} color="var(--ink-soft)" aria-hidden="true" />
        </span>
      )}
      {picked ? (
        <span className="absolute inset-0 flex items-center justify-center bg-foreground/35 text-caption font-bold text-background">담음</span>
      ) : null}
    </button>
  );
}

function ArrangeStep({
  items,
  coupleId,
  dragIndex,
  setDragIndex,
  onMove,
  onRemove,
  onAddMore,
}: {
  items: PostDraftItem[];
  coupleId?: string;
  dragIndex: number | null;
  setDragIndex: (index: number | null) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onAddMore: () => void;
}) {
  return (
    <div className="pt-3">
      <p className="text-caption leading-relaxed text-muted-foreground">
        첫 번째 사진이 우리 격자의 대표가 돼요. 끌어서 순서를 바꿀 수 있어요.
      </p>
      <ul className="space-y-2 pt-3" data-testid="post-arrange-list" aria-label="게시물 사진 순서">
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) onMove(dragIndex, index);
              setDragIndex(null);
            }}
            className="flex items-center gap-3 rounded-control p-2"
            style={{ background: 'var(--paper)', border: 'var(--stroke-thin) solid var(--ink-faint)' }}
          >
            <GripVertical size={16} color="var(--ink-soft)" aria-hidden="true" />
            <DraftThumb item={item} coupleId={coupleId} />
            <span className="min-w-0 flex-1 text-caption" style={{ color: 'var(--ink-soft)' }}>
              {index === 0 ? '대표 사진' : `${index + 1}번째`}
            </span>
            {/*
              키보드로도 순서를 바꿀 수 있어야 한다. 드래그만 제공하면 포인터가 없는
              사용자에게 이 화면의 유일한 기능이 사라진다.
            */}
            <button type="button" onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label={`${index + 1}번째 사진을 앞으로`} className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-label disabled:opacity-30" style={{ color: 'var(--ink)' }}>↑</button>
            <button type="button" onClick={() => onMove(index, index + 1)} disabled={index === items.length - 1} aria-label={`${index + 1}번째 사진을 뒤로`} className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-label disabled:opacity-30" style={{ color: 'var(--ink)' }}>↓</button>
            <button type="button" onClick={() => onRemove(item.id)} aria-label={`${index + 1}번째 사진 빼기`} className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-muted-foreground">
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {remainingPostSlots(items) > 0 ? (
        <button type="button" onClick={onAddMore} className="press-response-row mt-3 flex min-h-11 w-full items-center justify-center rounded-control border border-border text-label font-semibold text-foreground">
          사진 더 담기 ({remainingPostSlots(items)}장 가능)
        </button>
      ) : null}
    </div>
  );
}

function CaptionStep({
  items,
  coupleId,
  caption,
  setCaption,
  connected,
  isPrivate,
  setIsPrivate,
}: {
  items: PostDraftItem[];
  coupleId?: string;
  caption: string;
  setCaption: (value: string) => void;
  connected: boolean;
  isPrivate: boolean;
  setIsPrivate: (value: boolean) => void;
}) {
  return (
    <div className="pt-3">
      <ul className="flex gap-1 overflow-x-auto pb-1" aria-label="담은 사진">
        {items.map((item) => (
          <li key={item.id} className="shrink-0"><DraftThumb item={item} coupleId={coupleId} /></li>
        ))}
      </ul>
      <label className="mt-3 block">
        <span className="text-caption font-medium text-muted-foreground">글</span>
        <textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="이 순간에 대해 남기고 싶은 말"
          data-testid="post-caption"
          className="hand-text mt-1 w-full rounded-control border border-border bg-background px-3 py-2 text-body text-foreground"
        />
      </label>
      {connected ? (
        <button type="button" role="switch" aria-checked={isPrivate} onClick={() => setIsPrivate(!isPrivate)} className="press-response-row mt-2 flex min-h-11 w-full items-center justify-between rounded-control px-3" style={{ border: 'var(--stroke-thin) solid var(--ink-faint)' }}>
          <span className="text-label" style={{ color: 'var(--ink)' }}>나만 보기</span>
          <span className="text-caption" style={{ color: 'var(--ink-soft)' }}>{isPrivate ? '켜짐' : '꺼짐'}</span>
        </button>
      ) : (
        <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
          아직 둘이 연결되지 않아 이 게시물은 나만 볼 수 있게 저장돼요.
        </p>
      )}
    </div>
  );
}

function DraftThumb({ item, coupleId }: { item: PostDraftItem; coupleId?: string }) {
  if (item.kind === 'file') {
    return <img src={item.previewUrl} alt="" className="h-14 w-14 rounded-control object-cover" />;
  }
  return <ExistingThumb attachment={item.attachment} coupleId={coupleId} recordId={item.sourceRecordId} />;
}

function ExistingThumb({ attachment, coupleId, recordId }: { attachment: Attachment; coupleId?: string; recordId: string }) {
  const media = useMediaAttachment(attachment, coupleId, recordId);
  if (!media.url) {
    return (
      <span className="flex h-14 w-14 items-center justify-center rounded-control" style={{ background: 'var(--paper)' }}>
        <ImageIcon size={16} color="var(--ink-soft)" aria-hidden="true" />
      </span>
    );
  }
  return <img src={media.url} alt="" className="h-14 w-14 rounded-control object-cover" onError={media.reportLoadFailure} />;
}
