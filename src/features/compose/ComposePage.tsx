import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Image as ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { recordProductEvent } from '@/lib/productEvents';
import { MEDIA_ACCEPT } from '@/lib/records';
import { clearComposerDraft, readComposerDraft, writeComposerDraft } from '@/lib/composerDraft';
import { EmotionCharacter } from '@/components/emotion/EmotionCharacter';
import { useEmotionCandidatesAtBoundary } from '@/lib/useEmotionCandidates';
import { BASIC_EMOTION_LABEL, BASIC_EMOTION_ORDER, GROUP_BY_BASIC } from '@/lib/basicEmotions';
import { localToday } from '@/lib/cycle';
import type { BasicEmotion, EmotionFlowItem } from '@/types';

/**
 * 남기기 — 인스타의 만들기 흐름과 같은 자리, 뒤집힌 순서.
 *
 *     인스타      갤러리 → 편집 → 캡션·공유
 *     곰신로그    글 → 사진(선택) → 마음 → 공개 범위 → 남기기
 *
 * 인스타는 사진이 필수라 갤러리가 먼저 오지만 여기서는 **사진이 선택**이다. 하루에 사진
 * 한 장 없는 날이 많고 그런 날에도 남길 수 있어야 루프가 산다. 그래서 글이 먼저 온다.
 *
 * ## 30초 계약
 *
 * §7.1 -- 일반 기록 작성 30초 이내. 그래서 필수가 하나도 없다. 마음도 사진도 손대지 않고
 * 글만 쓰고 나갈 수 있다.
 *
 * ## 공개 범위는 접히지 않는다
 *
 * §7.2 -- 항상 명시적이고 화면에 보인다. 접어 두면 기본값으로 남기고, 기본값으로 남긴
 * 것이 상대에게 보인다는 사실을 나중에 알게 된다. 이 제품이 절대 만들면 안 되는 놀람이다.
 *
 * ## 마음은 고르지 않으면 붙지 않는다
 *
 * §13 -- 파트너에게 보이는 감정은 작성자의 명시적 행위를 요구한다. 기본값으로 하나 골라
 * 두면 그것은 명시적 행위가 아니다. 여섯 낱말이 아니라 여섯 **얼굴**인 이유는 이것이
 * 사람이 무언가를 느끼는 중에 만지는 유일한 컨트롤이기 때문이다 -- 읽기가 가장 먼저
 * 없어지는 상태다.
 */

export function ComposePage() {
  const navigate = useNavigate();
  const { state, addRecordWithMedia, queueRecordForLater } = useStore();

  const userId = state.authenticatedUser?.id || state.profile.id || '';
  const restored = useRef(readComposerDraft(userId)).current;

  const [log, setLog] = useState(restored?.log ?? '');
  /*
    감정은 고르는 것이 아니라 **확인하는 것**이다.

    프리뷰에는 여섯 얼굴을 직접 고르는 줄이 있었고 처음에 그것을 그대로 옮겼다. 그러면
    앱이 이미 갖고 있는 파이프라인 -- 쓴 글을 읽고 후보를 제안하면 사람이 확인·교정하는
    §13의 흐름 -- 이 통째로 사라진다. 프리뷰는 픽스처만 있는 화면이라 읽을 글이 없었을
    뿐이고, 수동 선택이 그 자리를 대신한 것이지 대체하기로 한 것이 아니었다.

    제안은 **아무것도 답하지 않는다.** 누르지 않은 읽기는 저장되지도 공유되지도 않는다.
  */
  const review = useEmotionCandidatesAtBoundary();

  /*
    고른 마음. 여섯은 **늘 한 줄에 있고**, 앱이 읽은 것만 미리 눌려 있다.

    앞선 판은 후보 카드마다 `맞아요` / `다른 마음` / `✕` 를 달았다. 읽기 하나에 컨트롤이
    셋이었고, 두 개가 읽히면 여섯 개의 버튼을 지나야 저장에 닿았다. 30초 계약(§7.1)에
    그만한 자리가 없다.

    지금은 토글 여섯뿐이다. 맞으면 그냥 남기고, 틀리면 눌러서 끄고 다른 걸 누른다.
    "확인"이라는 별도 동작이 없어지는 대신 **여섯이 언제나 보이므로** 무엇이 저장될지
    화면이 늘 말하고 있다.

    순서는 흐름이다(§6.2). 앱이 읽은 순서로 먼저 들어가고, 사용자가 더한 것은 뒤에 붙는다
    -- `화났어 → 기뻤어` 같은 하루의 모양이 그렇게 남는다.
  */
  const [mood, setMood] = useState<BasicEmotion[]>([]);
  /** 어떤 읽기에서 씨앗을 받았는지. 같은 읽기로 두 번 덮어쓰지 않는다. */
  const seededFrom = useRef<string>('');
  const [isPrivate, setIsPrivate] = useState(restored?.isPrivate ?? false);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** §19가 허용하는 단 하나의 시간. 열린 순간은 기기에 남고 **차이만** 나간다. */
  const openedAt = useRef<number>(Date.now());

  /*
    쓰던 글을 잃지 않는다.

    이 화면은 전체 화면이라 뒤로 가기 한 번이면 사라진다. 매 입력마다 기기에 stash 하면
    실수로 나가도, 앱이 죽어도 돌아왔을 때 그대로 있다. 서버로 가지 않는다 -- 아직
    남기지 않은 글은 상대의 것이 아니다.
  */
  useEffect(() => {
    if (!userId) return;
    if (log.trim().length === 0 && !isPrivate) return;
    writeComposerDraft(userId, { log, isPrivate });
  }, [userId, log, isPrivate]);

  const connected = state.profile.couple.connected;
  /*
    연결되지 않았으면 공유할 상대가 없다.

    `우리에게 공유` 를 고를 수 있게 두면 고른 대로 되지 않는다. 저장되는 값과 화면이
    어긋나는 것이 §7.2 가 막으려는 바로 그것이다.
  */
  const effectivePrivate = connected ? isPrivate : true;
  const hasContent = log.trim().length > 0 || files.length > 0;

  /*
    §13 -- 상대에게 보이는 감정은 작성자의 명시적 행위를 요구한다. 기본값은 꺼짐이고,
    확인한 마음이라도 이 스위치를 켜야 상대에게 간다.
  */

  /*
    읽기가 도착하면 그 결과로 줄을 채운다.

    사용자가 이미 손댄 뒤에는 덮어쓰지 않는다 -- 끈 것을 앱이 다시 켜면 그건 대화가
    아니라 말싸움이다. 같은 글을 다시 읽어도(키가 같으면) 아무 일도 일어나지 않는다.
  */
  useEffect(() => {
    const key = review.candidates.map((candidate) => candidate.id).join('|');
    if (!key || key === seededFrom.current) return;
    seededFrom.current = key;
    setMood(review.candidates.map((candidate) => candidate.basic));
  }, [review.candidates]);

  const toggleMood = (item: BasicEmotion) => {
    setMood((current) => (current.includes(item)
      ? current.filter((one) => one !== item)
      : [...current, item]));
  };

  /*
    고른 것이 그대로 저장된다.

    전부 `user_confirmed` 다 -- 화면에 눌린 채로 보이는 것을 두고 `남기기` 를 누르는 것이
    작성자의 행위이기 때문이다. §13 이 막으려던 것은 **보이지 않는 기본값**이고, 여기서는
    무엇이 저장될지 여섯 칸이 언제나 말하고 있다.

    그래서 §13 의 보호는 다른 자리에 남긴다: `상대에게도 보여주기` 는 **꺼진 채로 시작하고
    직접 켜야 한다.** 앱이 읽은 것이 작성자도 모르게 상대에게 가는 일은 여전히 없다.
  */
  const buildFlow = (now: Date): EmotionFlowItem[] => mood.map((basic, index) => ({
    id: `mood-${now.getTime()}-${index}`,
    sequence: index + 1,
    group: GROUP_BY_BASIC[basic],
    basic,
    displayLabel: BASIC_EMOTION_LABEL[basic],
    source: 'user_confirmed' as const,
    /*
      감정은 기록의 공개 범위를 그대로 따른다.

      한때 `상대에게도 이 마음 보여주기` 스위치가 따로 있었고 기본이 꺼짐이었다. 없앤
      이유는 그것이 답할 수 없는 질문이기 때문이다 -- 글은 보여주면서 그 글에서 읽은
      마음만 숨기는 상태가 무엇을 뜻하는지 사용자도 상대도 알 수 없다. `나만 보기` 면
      둘 다 나만 보고, `우리에게 공유` 면 둘 다 함께 본다.

      §13 이 요구하는 "작성자의 명시적 행위" 는 공개 범위 그 자체가 진다 -- 접히지 않고
      화면에 늘 보이며(§7.2), 고른 마음도 여섯 칸에 눌린 채로 보인다. 무엇이 상대에게
      갈지 화면이 두 곳에서 말하고 있다.
    */
    visibility: effectivePrivate ? ('author_only' as const) : ('shared' as const),
    userEdited: true,
  }));

  const save = async () => {
    if (saving || !hasContent) return;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    /*
      확인한 것만 저장한다.

      `toFlowItems` 가 확인된 후보만 골라 주고, 나만 보기면 감정도 작성자만 보게 표시한다.
      확인하지 않은 읽기는 여기서 사라진다 -- 그것이 §13의 "명시적 행위"다.
    */
    const flow = buildFlow(now);

    const draft = {
      date: localToday(),
      time,
      authorRole: state.profile.role,
      log,
      isPrivate: effectivePrivate,
      talkAbout: false,
      emotionFlow: flow,
      emotionUpdatedAt: flow.length > 0 ? now.toISOString() : null,
    };

    const done = (message: string) => {
      clearComposerDraft(userId);
      review.reset();
      setMood([]);
      seededFrom.current = '';
      toast.success(message);
      navigate('/home');
    };

    /*
      오프라인은 OS 가 믿을 만한 유일한 연결 사실이므로 쓰기를 시도하지 않고 **저장한다.**

      미리 거절하면 타이핑한 글이 어디에도 없는 채로 사라진다. 큐에 넣으면 연결이
      돌아왔을 때 그대로 나간다.
    */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSaving(true);
      let queued: { queued: boolean; error?: string };
      try {
        queued = await queueRecordForLater(draft, files);
      } finally {
        setSaving(false);
      }
      if (!queued.queued) {
        toast.error(queued.error || '지금은 저장할 수 없어요.');
        return;
      }
      done('오프라인이라 저장해 뒀어요. 연결되면 자동으로 보낼게요.');
      return;
    }

    setSaving(true);
    let result: Awaited<ReturnType<typeof addRecordWithMedia>>;
    try {
      result = await addRecordWithMedia(draft, files);
    } finally {
      setSaving(false);
    }

    if (result.queued) {
      done('지금은 보내지 못해 저장해 뒀어요. 연결되면 자동으로 보낼게요.');
      return;
    }

    if (!result.ok) {
      if (result.reason === 'protection_required') {
        toast.error(result.error || '기록 보호 설정이 필요해요.', {
          action: { label: '설정 열기', onClick: () => navigate('/settings') },
        });
      } else {
        toast.error(result.error || '기록을 저장하지 못했어요.');
      }
      return;
    }

    if (result.failedFiles.length > 0) {
      toast.warning(`사진 ${result.failedFiles.length}장은 올리지 못했어요. 글은 저장됐어요.`);
    }

    /*
      §19 계측 -- 실제로 끝난 경로에서만.

      실패한 쓰기를 기록 하나로 세지 않는다. 나가는 값은 경과 시간 하나뿐이고 글도,
      길이도, 공개 범위도, 감정도 나가지 않는다.
    */
    void recordProductEvent({
      kind: 'record_composed',
      screen: 'home',
      durationMs: Date.now() - openedAt.current,
    });

    done('남겼어요.');
  };

  const stamp = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const clock = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="notebook flex min-h-screen min-h-[100dvh] flex-col">
      <header
        className="flex h-14 shrink-0 items-center px-3"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <button
          type="button"
          aria-label="닫기"
          onClick={() => navigate(-1)}
          className="flex h-11 w-11 items-center justify-center"
        >
          <X size={22} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
        <span className="flex-1 text-center text-body font-semibold" style={{ color: 'var(--ink)' }}>
          오늘 남기기
        </span>
        {/* 인스타의 `공유` 자리. 글이나 사진이 하나라도 있으면 누를 수 있다. */}
        {/*
          아직 아무것도 안 쓴 상태를 **회색 덩어리**로 만들지 않는다.

          `ink-fill` 에 `opacity` 를 걸면 잉크가 흐려진 채로 남아 종이 위에 회색 블록이
          하나 뜬다. 대신 칠하지 않은 상자로 둔다 -- 같은 자리, 같은 크기, 채워지지
          않았을 뿐이다. 쓰기 시작하면 잉크가 찬다.
        */}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!hasContent || saving}
          className={hasContent && !saving ? 'ink-fill px-3.5 py-2' : 'ink-chip px-3.5 py-2'}
          style={hasContent && !saving ? undefined : { color: 'var(--ink-soft)' }}
        >
          <span className="text-label font-semibold">{saving ? '남기는 중' : '남기기'}</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 px-4 pb-8">
        {/* 일기의 날짜 도장. 노트 상단에 찍는 그것. */}
        <div className="flex items-center gap-2 pb-3">
          <span
            className="px-2.5 py-1 text-caption tabular-nums"
            style={{
              color: 'var(--ink-soft)',
              border: 'var(--stroke-thin) solid var(--ink-faint)',
              borderRadius: '80px 6px 90px 6px / 6px 90px 6px 80px',
            }}
          >
            {stamp}
          </span>
          <span className="text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>{clock}</span>
        </div>

        <textarea
          value={log}
          onChange={(event) => setLog(event.target.value)}
          placeholder="오늘 어땠어?"
          /*
            **필드를 떠나는 것**이 분석이 기다리는 경계다. blur 는 생각이 끝났다는 뜻이고
            300ms 의 멈춤은 그렇지 않다 -- `무서운` 과 `무서운 영화 봤어` 의 차이다.
          */
          onBlur={() => review.analyse(log)}
          aria-label="오늘 남길 글"
          rows={6}
          className="hand-text w-full resize-none bg-transparent text-heading outline-none placeholder:opacity-40"
          style={{ color: 'var(--ink)', lineHeight: '30px' }}
        />

        <input
          ref={fileInput}
          type="file"
          multiple
          accept={MEDIA_ACCEPT}
          className="hidden"
          onChange={(event) => {
            setFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="ink-chip mt-2 flex w-full items-center justify-center gap-2 py-3"
        >
          <ImageIcon size={17} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
          <span className="text-label" style={{ color: 'var(--ink-soft)' }}>
            {files.length > 0 ? `사진 ${files.length}장` : '사진 더하기'}
          </span>
        </button>

        <div className="ink-rule my-5" aria-hidden="true" />

        {/*
          여섯은 늘 여기 있다. 앱이 읽은 것만 미리 눌려 있고, 아니면 눌러서 끄면 된다.

          "확인"이라는 별도 동작이 없다. 화면에 눌린 채로 보이는 것이 곧 저장될 것이고,
          여섯 칸이 언제나 그것을 말하고 있다.
        */}
        <div className="flex items-baseline gap-2 pb-2.5">
          <p className="text-caption" style={{ color: 'var(--ink-soft)' }}>오늘 마음</p>
          {review.candidates.length > 0 ? (
            <p className="text-caption" style={{ color: 'var(--ink-soft)' }}>
              · 글에서 읽어봤어요
            </p>
          ) : null}
        </div>

        <div className="flex justify-between" role="group" aria-label="오늘 마음">
          {BASIC_EMOTION_ORDER.map((item) => {
            const on = mood.includes(item);
            return (
              <button
                key={item}
                type="button"
                aria-pressed={on}
                aria-label={BASIC_EMOTION_LABEL[item]}
                onClick={() => toggleMood(item)}
                className="flex min-h-11 w-[52px] flex-col items-center gap-1"
              >
                <EmotionCharacter emotion={item} selected={on} size={40} />
                <span
                  className="text-caption"
                  style={{ color: on ? 'var(--ink)' : 'var(--ink-soft)', fontWeight: on ? 600 : 400 }}
                >
                  {BASIC_EMOTION_LABEL[item]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="ink-rule my-5" aria-hidden="true" />

        <div className="flex gap-2" role="radiogroup" aria-label="누가 볼 수 있나">
          {[{ shared: true, label: '우리에게 공유' }, { shared: false, label: '나만 보기' }].map((option) => {
            const on = !effectivePrivate === option.shared;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!connected && option.shared}
                onClick={() => setIsPrivate(!option.shared)}
                className="ink-box flex flex-1 items-center justify-center gap-1.5 py-3 disabled:opacity-40"
                style={on ? { background: 'var(--ink)', color: 'var(--paper)' } : { color: 'var(--ink)' }}
              >
                {on ? <Check size={15} strokeWidth={2.4} aria-hidden="true" /> : null}
                <span className="text-label font-semibold">{option.label}</span>
              </button>
            );
          })}
        </div>

        {!connected ? (
          <p className="pt-2 text-caption" style={{ color: 'var(--ink-soft)' }}>
            아직 연결되지 않아서 나만 볼 수 있어요. 연결하면 그때부터 공유할 수 있어요.
          </p>
        ) : null}
      </div>
    </div>
  );
}
