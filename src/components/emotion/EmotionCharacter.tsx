import type { ReactElement } from 'react';
import type { BasicEmotion } from '@/lib/basicEmotions';

/**
 * The six 곰신로그 emotion characters.
 *
 * ## Why characters at all
 *
 * A feeling picked from a list of six words is a form field. A feeling picked from
 * six faces is recognised before it is read -- which matters here because this is
 * the one control in the app a user touches while they are actually feeling
 * something, and reading is the first thing that goes.
 *
 * ## Why these are not the obvious reference
 *
 * The principle borrowed is only: one emotion, one creature, one colour, legible
 * at a glance. Nothing else. The well-known animated cast is humanoid, limbed, and
 * identified almost entirely by its palette; copying either the forms or that
 * palette would make this recognisably someone else's work, which is the failure
 * mode to avoid.
 *
 * So the load-bearing signal here is SILHOUETTE. Each body is a different shape
 * before it has any colour at all -- round, tall, tapered, squat, squared, heavy --
 * and each stays identifiable in a monochrome unselected state, which is exactly
 * the state most of them are in most of the time. Colour is the second signal and
 * the Korean label under it is the third.
 *
 * They are 씨앗 -- seeds, or smooth river pebbles. Soft enough to belong beside the
 * cream and coral this app is built from, and specific enough not to read as a
 * generic emoji. Not childish: no sparkles, no rainbow, no bouncing.
 *
 * ## Why nothing moves
 *
 * There is no idle animation and no loop. A row of six characters breathing at the
 * bottom of a diary entry would compete with the entry, and continuous motion is
 * the pattern `prefers-reduced-motion` exists to stop. The only motion is the press
 * response the whole app shares, and the only state change is selection.
 */

/**
 * Ink for the facial features.
 *
 * One value for both themes, which works because every accent is mid-to-light in
 * light mode and lighter still in dark mode -- a dark ink is legible on all twelve.
 */
const INK = 'oklch(0.24 0.03 265)';

export interface EmotionCharacterProps {
  emotion: BasicEmotion;
  /** Coloured and upright when true; quiet monochrome when false. */
  selected?: boolean;
  /** Rendered px. The art is drawn on a 48-unit grid and scales cleanly. */
  size?: number;
  className?: string;
}

/**
 * Per-emotion art.
 *
 * `body` is the silhouette, `face` the expression. They are separate so the body
 * can take the accent while the face keeps the ink.
 */
const ART: Record<BasicEmotion, { body: string; face: ReactElement; accent: string }> = {
  /* 행복 — round, tilted up, a sprout. The only one that grows something. */
  happiness: {
    body: 'M24 10c8.3 0 14 5.9 14 13.6S32.3 40 24 40s-14-4.7-14-12.4S15.7 10 24 10Z',
    accent: 'var(--emotion-happiness)',
    face: (
      <>
        <path d="M17 24.5c1-1.6 3.2-1.6 4.2 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M26.8 24.5c1-1.6 3.2-1.6 4.2 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M20 30c1.6 2.2 6.4 2.2 8 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />
        {/* Sprout: the one piece of the set that reads as alive rather than drawn. */}
        <path d="M24 10c0-2.6-1.6-4.4-4-4.8 0 2.8 1.5 4.4 4 4.8Z" fill={INK} opacity="0.55" />
        <path d="M24 10c.4-2.2 2-3.6 4-3.8-.2 2.4-1.6 3.6-4 3.8Z" fill={INK} opacity="0.35" />
      </>
    ),
  },
  /* 놀람 — tall and narrow, lifted. Reads as "stood up suddenly". */
  surprise: {
    body: 'M24 7c7.4 0 12.5 6.4 12.5 15.4S31.4 41 24 41s-12.5-9.6-12.5-18.6S16.6 7 24 7Z',
    accent: 'var(--emotion-surprise)',
    face: (
      <>
        <circle cx="19.4" cy="22.5" r="3.1" fill={INK} />
        <circle cx="28.6" cy="22.5" r="3.1" fill={INK} />
        <circle cx="20.5" cy="21.4" r="1" fill="var(--card)" />
        <circle cx="29.7" cy="21.4" r="1" fill="var(--card)" />
        <ellipse cx="24" cy="31.5" rx="2.4" ry="3" fill={INK} />
      </>
    ),
  },
  /* 공포 — tapered to a point at the top, narrow shoulders, unsettled base. */
  fear: {
    body: 'M24 8c5.6 3.4 11 8.8 11 16.2 0 8-4.9 12.8-11 12.8s-11-4.8-11-12.8C13 16.8 18.4 11.4 24 8Z',
    accent: 'var(--emotion-fear)',
    face: (
      <>
        <circle cx="20.4" cy="24" r="2.4" fill={INK} />
        <circle cx="27.6" cy="24" r="2.4" fill={INK} />
        {/* Unsteady mouth. The only wavy line in the set. */}
        <path
          d="M20 31.4c1-1.2 2-1.2 3 0s2 1.2 3 0 2-1.2 2.4-.4"
          stroke={INK}
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      </>
    ),
  },
  /* 혐오 — squat and wide, leaning away from the viewer. */
  disgust: {
    body: 'M23 13c9.2-1.4 15 3.4 15 11.4C38 33 32 39 23.4 39 15 39 10 34 10 26.6 10 19 14.6 14.2 23 13Z',
    accent: 'var(--emotion-disgust)',
    face: (
      <>
        {/* One brow up, one eye narrowed: the asymmetry is the whole expression. */}
        <path d="M16.6 21.6c1.4-1.4 3.4-1.6 4.8-.6" stroke={INK} strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M18 26.4c1.4-.8 3-.8 4.2 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="29.4" cy="26" r="2.2" fill={INK} />
        <path d="M18.6 32.6c2.6-1.4 5.6-1.6 8.2-.4" stroke={INK} strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </>
    ),
  },
  /* 분노 — squared shoulders. The only silhouette in the set with corners. */
  anger: {
    body: 'M15 14h18a5 5 0 0 1 5 5v8c0 7.2-5.4 12-14 12s-14-4.8-14-12v-8a5 5 0 0 1 5-5Z',
    accent: 'var(--emotion-anger)',
    face: (
      <>
        <path d="M16.6 20.6 22 23" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M31.4 20.6 26 23" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="19.6" cy="26.6" r="2.2" fill={INK} />
        <circle cx="28.4" cy="26.6" r="2.2" fill={INK} />
        <path d="M19.6 33h8.8" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      </>
    ),
  },
  /* 슬픔 — light at the top, heavy at the bottom. It sinks. */
  sadness: {
    body: 'M24 9c7 0 12 4.4 12 11 0 8.8-3.4 20-12 20s-12-11.2-12-20c0-6.6 5-11 12-11Z',
    accent: 'var(--emotion-sadness)',
    face: (
      <>
        <path d="M17.4 25.6c1-1.6 3.2-1.6 4.2 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" transform="rotate(180 19.5 24.8)" />
        <path d="M26.4 25.6c1-1.6 3.2-1.6 4.2 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" transform="rotate(180 28.5 24.8)" />
        <path d="M21 33.4c1.4-1.8 4.6-1.8 6 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" transform="rotate(180 24 32.5)" />
      </>
    ),
  },
};

export function EmotionCharacter({
  emotion,
  selected = false,
  size = 40,
  className,
}: EmotionCharacterProps) {
  const art = ART[emotion];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      /*
        Decorative. Every caller renders the Korean label as real text next to it,
        so announcing the drawing too would make a screen reader say the feeling
        twice.
      */
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={art.body}
        fill={selected ? art.accent : 'var(--muted-foreground)'}
        /*
          Unselected is monochrome, not merely faded. Six washed-out colours still
          read as six competing colours; one grey shape reads as "not this one",
          which is what the state actually means. It is also why the silhouettes
          have to differ -- in this state the shape is the ONLY thing left.
        */
        opacity={selected ? 1 : 0.3}
      />
      {/* The face fades with the body but never disappears: a blank pebble reads as
          a loading placeholder rather than an unchosen option. */}
      <g opacity={selected ? 1 : 0.45}>{art.face}</g>
    </svg>
  );
}


