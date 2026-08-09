import type { DailyRecord, Role } from '@/types';
import { isOwnRecord, type Viewer } from '@/lib/privacy';

/**
 * Who wrote a record, expressed so a reader can tell in one glance.
 *
 * Bug condition:
 *   isBugCondition(timeline) = a 군화 card and a 곰신 card are rendered with the
 *                              same surface, the same border and the same text
 *                              colour, so the only difference is a 2-character
 *                              name label in muted 11px type.
 *
 * Measured on the unfixed tree: `RecordPage.tsx` built every timeline card from
 * the identical class string `rounded-2xl bg-card border p-4 ...` and used
 * `isOwn` for nothing but `{isOwn ? '나' : partnerDisplayName}`. Two people's
 * days interleave on one date, so reading the timeline meant reading that label
 * on every card.
 *
 * The distinction below deliberately uses THREE independent channels, because
 * WCAG 2.1 SC 1.4.1 forbids colour as the only carrier of information and roughly
 * 8% of men -- i.e. every 군화 in the target audience -- have some form of colour
 * vision deficiency:
 *
 *   1. Hue      -- a 6px edge stripe, coral for 곰신 and info-blue for 군화.
 *   2. Geometry -- the timeline dot marker differs in SHAPE by ownership: the
 *                  viewer's own record gets a filled dot; the partner's gets a
 *                  hollow ring (border-only, same diameter). This replaced the
 *                  chat-bubble indentation (ml-auto / mr-auto / max-w-[94%]) which
 *                  was incompatible with the editorial timeline's fixed column
 *                  layout. The editorial timeline requires a stable time column at
 *                  44px, which a 94%-width pushed left or right destroys.
 *   3. Text     -- an explicit attribution chip, `🌸 곰신 · 나`, which carries the
 *                  role as words and as an emoji rather than as colour.
 *
 * Hue is keyed on the ROLE, not on ownership, so the same person is the same
 * colour on both phones; that matters because couples screenshot this screen for
 * each other. Geometry (marker) is keyed on OWNERSHIP, which is the axis each
 * reader actually scans for.
 *
 * Only theme tokens are used. `src/lib/themeTokens.test.ts` guards this file and
 * fails the build if a raw palette literal (a hard-coded white surface, a fixed
 * grey ink, ...) reappears, and `--coral` / `--info` are both defined for the
 * light AND dark themes, so these accents survive a theme switch.
 */

export const ROLE_LABEL: Record<Role, string> = {
  gomsin: '곰신',
  soldier: '군화',
};

/**
 * The role emojis onboarding already taught. Reused rather than re-invented so
 * the timeline speaks the same visual language as `나는 곰신이에요` / `나는 군화예요`.
 */
export const ROLE_EMOJI: Record<Role, string> = {
  gomsin: '🌸',
  soldier: '🪖',
};

interface RoleAccent {
  /** Full-height edge stripe. An ink token, so it stays visible in both themes. */
  stripe: string;
  /** Attribution chip surface. Tinted with the same hue at low alpha. */
  chip: string;
}

const ROLE_ACCENT: Record<Role, RoleAccent> = {
  // Coral is the app's signature warm accent and 곰신 is its primary persona.
  gomsin: { stripe: 'bg-coral', chip: 'bg-coral/15 text-foreground' },
  // Info-blue reads as uniform/navy and is far enough from coral in hue to stay
  // separable under deuteranopia and protanopia, which a coral/mint pair is not.
  soldier: { stripe: 'bg-info', chip: 'bg-info/15 text-foreground' },
};

/**
 * Accent used when `authorRole` is missing or unrecognised.
 *
 * Legacy and imported rows can arrive without the field even though the type
 * declares it, and inventing a role would attribute someone's words to the wrong
 * person. A neutral stripe says "unknown" instead.
 */
const UNKNOWN_ACCENT: RoleAccent = { stripe: 'bg-border', chip: 'bg-muted text-muted-foreground' };

export function isRole(value: unknown): value is Role {
  return value === 'gomsin' || value === 'soldier';
}

/**
 * Timeline marker geometry classes, keyed on OWNERSHIP (not role).
 *
 * The viewer's own record gets a filled dot (solid background); the partner's
 * record gets a hollow ring (border-only, same diameter). This is the second
 * non-colour channel (after the text chip) that distinguishes author identity.
 *
 * Both are 6px × 6px (w-1.5 h-1.5) with rounded-full. The filled variant is a
 * solid ink dot; the hollow variant has a transparent interior with a 1px
 * `border-foreground` ring. Ink rather than an accent hue on purpose: the hue
 * channel already belongs to the ROLE stripe, and reusing coral here would make
 * the two channels co-vary instead of being independent.
 */
const MARKER_OWN = 'w-1.5 h-1.5 rounded-full bg-foreground';
const MARKER_PARTNER = 'w-1.5 h-1.5 rounded-full border border-foreground bg-transparent';

export interface RecordAuthorPresentation {
  /** `null` when the record carries no usable role. */
  role: Role | null;
  /** `곰신` / `군화`, or `null` when the role is unknown. */
  roleLabel: string | null;
  roleEmoji: string | null;
  isOwn: boolean;
  /** `나` for the viewer's own record, otherwise the partner's display name. */
  displayName: string;
  /** Visible attribution, e.g. `🌸 곰신 · 나`. Never colour-only. */
  attribution: string;
  /** Full sentence for assistive tech, e.g. `곰신 나가 남긴 기록`. */
  srAttribution: string;
  /**
   * Timeline dot marker class: filled dot for own records, hollow ring for the
   * partner's. This is channel 2 (geometry), replacing the chat-bubble indentation
   * that was incompatible with the editorial timeline's fixed column layout.
   */
  markerClass: string;
  stripeClass: string;
  chipClass: string;
}

/**
 * Derive everything the timeline needs to attribute one record.
 *
 * Ownership comes from `isOwnRecord`, not from `record.authorRole === viewer.role`.
 * The two agree in the normal case, but the helper prefers the server identity
 * when both sides have one, so a demo profile that switches role -- which
 * `MyPage` offers -- can no longer re-label records the viewer really did write.
 */
export function recordAuthorPresentation(
  record: Pick<DailyRecord, 'userId' | 'authorRole'>,
  viewer: Viewer,
  partnerName: string,
): RecordAuthorPresentation {
  const role = isRole(record.authorRole) ? record.authorRole : null;
  const isOwn = isOwnRecord(record, viewer);
  const accent = role ? ROLE_ACCENT[role] : UNKNOWN_ACCENT;
  const roleLabel = role ? ROLE_LABEL[role] : null;
  const roleEmoji = role ? ROLE_EMOJI[role] : null;
  const displayName = isOwn ? '나' : partnerName;

  return {
    role,
    roleLabel,
    roleEmoji,
    isOwn,
    displayName,
    attribution: roleLabel ? `${roleEmoji} ${roleLabel} · ${displayName}` : displayName,
    srAttribution: roleLabel
      ? `${roleLabel} ${displayName}가 남긴 기록`
      : `${displayName}가 남긴 기록`,
    // Geometry channel: filled dot for own, hollow ring for partner.
    markerClass: isOwn ? MARKER_OWN : MARKER_PARTNER,
    stripeClass: accent.stripe,
    chipClass: accent.chip,
  };
}
