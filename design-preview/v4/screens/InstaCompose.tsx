import { useState } from 'react';
import { X, Image as ImageIcon, Check } from 'lucide-react';
import { PhotoFrame } from './common';

/**
 * 남기기 — 인스타의 만들기 흐름과 같은 자리.
 *
 *     인스타      갤러리 → 편집 → 캡션·공유
 *     곰신로그    글 → 사진(선택) → 태그 → 공개 범위 → 남기기
 *
 * 인스타는 사진이 필수라 갤러리가 먼저 오지만, 여기서는 **사진이 선택**이다. 하루에
 * 사진 한 장 없는 날이 많고 그런 날에도 남길 수 있어야 루프가 산다. 그래서 순서를
 * 뒤집어 글이 먼저 온다.
 *
 * ## 30초 계약
 *
 * §7.1: **일반 기록 작성 30초 이내.** 그래서 필수는 하나뿐이다 -- 공개 범위. 나머지는
 * 전부 건너뛸 수 있고, 아무것도 고르지 않아도 남길 수 있다.
 *
 * ## 공개 범위는 접히지 않는다
 *
 * §7.2: **항상 명시적이고 화면에 보인다.** 접어 두면 기본값으로 남기고, 기본값으로
 * 남긴 것이 상대에게 보인다는 사실을 나중에 알게 된다. 이 제품이 절대 만들면 안 되는
 * 종류의 놀람이다.
 *
 * ## 배려 신호가 여기 있는 이유
 *
 * 지금은 설정 안에 있어 존재를 모르고 지나간다. "하루를 남기는 순간"이 오늘 컨디션을
 * 고르는 가장 자연스러운 자리다. **주기 데이터에서 파생하지 않는다**(§21) -- 사용자가
 * 그날 직접 고르는 독립 신호이며 주기를 켜지 않은 사람도 똑같이 쓴다.
 */

const TAGS = ['좋았어', '이런 일이', '힘들었어', '네 생각났어'];

export function InstaCompose({ onClose }: { onClose?: () => void }) {
  const [text, setText] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [shared, setShared] = useState(true);
  const [photo, setPhoto] = useState(false);
  const [unwell, setUnwell] = useState(false);

  const now = new Date();
  const stamp = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}.`;
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <div className="notebook flex h-full flex-col">
      <header className="flex h-14 items-center px-3">
        <button type="button" aria-label="닫기" onClick={onClose} className="tap flex h-11 w-11 items-center justify-center">
          <X size={22} className="pen-icon" color="var(--ink)" />
        </button>
        <span className="print flex-1 text-center text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          오늘 남기기
        </span>
        {/* 인스타의 `공유` 자리. 필수 입력이 없으므로 언제나 누를 수 있다. */}
        <button type="button" onClick={onClose} className="tap ink-fill px-3.5 py-2">
          <span className="print text-[13px] font-semibold">남기기</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {/* 일기의 날짜 도장. 노트 상단에 찍는 그것. */}
        <div className="flex items-center gap-2 pb-3">
          <span
            className="print px-2.5 py-1 text-[12px] tabular-nums"
            style={{
              color: 'var(--ink-soft)',
              border: '1.2px solid var(--ink-faint)',
              borderRadius: '80px 6px 90px 6px / 6px 90px 6px 80px',
            }}
          >
            {stamp}
          </span>
          <span className="print text-[12px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>{clock}</span>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="오늘 어땠어?"
          aria-label="오늘 남길 글"
          rows={6}
          className="hand w-full resize-none bg-transparent text-[17px] outline-none placeholder:opacity-40"
          style={{ color: 'var(--ink)', lineHeight: '30px' }}
        />

        {photo ? (
          <div className="pt-2"><PhotoFrame ratio="4 / 5" /></div>
        ) : (
          <button
            type="button"
            onClick={() => setPhoto(true)}
            className="tap ink-chip mt-2 flex w-full items-center justify-center gap-2 py-3"
          >
            <ImageIcon size={17} className="pen-icon" color="var(--ink-soft)" />
            <span className="print text-[13px]" style={{ color: 'var(--ink-soft)' }}>사진 더하기</span>
          </button>
        )}

        <div className="ink-rule my-5" />

        <p className="print pb-2 text-[12px]" style={{ color: 'var(--ink-soft)' }}>오늘 어땠어? (선택)</p>
        <div className="flex flex-wrap gap-2">
          {TAGS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={tag === item}
              onClick={() => setTag(tag === item ? null : item)}
              className="tap ink-chip min-h-11 px-3.5"
              style={tag === item ? { background: 'var(--ink)', color: 'var(--paper)' } : undefined}
            >
              <span className="hand text-[15px]">{item}</span>
            </button>
          ))}
        </div>

        <div className="ink-rule my-5" />

        <div className="flex gap-2" role="radiogroup" aria-label="누가 볼 수 있나">
          {[{ on: true, label: '우리에게 공유' }, { on: false, label: '나만 보기' }].map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={shared === option.on}
              onClick={() => setShared(option.on)}
              className="tap ink-box flex flex-1 items-center justify-center gap-1.5 py-3"
              style={shared === option.on ? { background: 'var(--ink)', color: 'var(--paper)' } : undefined}
            >
              {shared === option.on ? <Check size={15} strokeWidth={2.4} /> : null}
              <span className="print text-[13px] font-semibold">{option.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-pressed={unwell}
          onClick={() => setUnwell(!unwell)}
          className="tap mt-3 flex w-full items-center gap-2.5 py-3"
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center"
            style={{
              border: '1.4px solid var(--ink)',
              borderRadius: '30px 4px 34px 4px / 4px 34px 4px 30px',
              background: unwell ? 'var(--ink)' : 'transparent',
            }}
          >
            {unwell ? <Check size={12} color="var(--paper)" strokeWidth={3} /> : null}
          </span>
          <span className="hand text-[15px]" style={{ color: 'var(--ink)' }}>
            오늘은 컨디션이 좋지 않아요
          </span>
        </button>
        <p className="print pl-[30px] text-[11px]" style={{ color: 'var(--ink-soft)' }}>
          오늘 하루만 보여요. 언제든 지울 수 있어요.
        </p>
      </div>
    </div>
  );
}
