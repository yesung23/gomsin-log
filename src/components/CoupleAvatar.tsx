export function CoupleAvatar({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" aria-hidden>
      <circle cx="40" cy="40" r="40" fill="oklch(0.96 0.02 25)" />
      <circle cx="30" cy="36" r="12" fill="#F7C7C0" />
      <path d="M18 34 Q30 18 42 34 Z" fill="#8B4A3A" />
      <circle cx="26" cy="37" r="1.2" fill="#1B2340" />
      <circle cx="33" cy="37" r="1.2" fill="#1B2340" />
      <path d="M27 42 Q30 44 33 42" stroke="#1B2340" strokeWidth="1" strokeLinecap="round" fill="none" />
      <circle cx="52" cy="38" r="12" fill="#F0D0B8" />
      <path d="M40 34 Q52 22 64 34 L64 36 L40 36 Z" fill="#5A6B4A" />
      <circle cx="48" cy="39" r="1.2" fill="#1B2340" />
      <circle cx="55" cy="39" r="1.2" fill="#1B2340" />
      <path d="M49 44 Q52 46 55 44" stroke="#1B2340" strokeWidth="1" strokeLinecap="round" fill="none" />
      <path d="M40 22 l-2 -2 a1.6 1.6 0 1 1 2 -2 a1.6 1.6 0 1 1 2 2 z" fill="#F28B82" />
    </svg>
  );
}
