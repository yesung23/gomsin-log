import type { ProfileDateType } from '@/types';

const DATE_OPTIONS: { value: ProfileDateType; label: string; token: string }[] = [
  { value: 'together', label: '함께한 날', token: '(함께한 날)' },
  { value: 'meeting', label: '만남', token: '(만남)' },
  { value: 'discharge', label: '전역', token: '(전역)' },
];

export function ProfileCaptionEditor({
  caption,
  dateType,
  onCaptionChange,
  onDateTypeChange,
  allowDischarge = true,
}: {
  caption: string;
  dateType: ProfileDateType | '';
  onCaptionChange: (value: string) => void;
  onDateTypeChange: (value: ProfileDateType | '') => void;
  allowDischarge?: boolean;
}) {
  const availableOptions = allowDischarge
    ? DATE_OPTIONS
    : DATE_OPTIONS.filter((option) => option.value !== 'discharge');
  const effectiveDateType = allowDischarge || dateType !== 'discharge' ? dateType : '';
  const selected = availableOptions.find((option) => option.value === effectiveDateType);

  return (
    <div className="space-y-2">
      <label htmlFor="edit-profile-caption" className="text-label font-semibold text-muted-foreground">
        소개 문구 (최대 80자)
      </label>
      <textarea
        id="edit-profile-caption"
        value={caption}
        maxLength={80}
        rows={2}
        onChange={(event) => onCaptionChange(event.target.value.slice(0, 80))}
        placeholder="우리의 다음 장면을 적어 보세요"
        className="w-full px-3 py-2 rounded-control bg-muted border border-border text-body text-foreground outline-none focus:ring-2 focus:ring-coral/40 resize-none"
      />
      <div className="flex items-center gap-2">
        <label htmlFor="edit-profile-date-type" className="text-caption text-muted-foreground shrink-0">
          날짜 토큰
        </label>
        <select
          id="edit-profile-date-type"
          value={effectiveDateType}
          onChange={(event) => onDateTypeChange(event.target.value as ProfileDateType | '')}
          className="min-h-11 flex-1 px-3 rounded-control bg-muted border border-border text-body text-foreground"
        >
          <option value="">선택 안 함</option>
          {availableOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && onCaptionChange(`${caption}${caption && !caption.endsWith(' ') ? ' ' : ''}${selected.token}`.slice(0, 80))}
          className="min-h-11 px-3 rounded-control border border-border text-caption font-semibold text-foreground disabled:opacity-40"
        >
          넣기
        </button>
      </div>
      <p className="text-caption text-muted-foreground">
        날짜가 없으면 숫자를 지어내지 않고 설정 안내로 보여요.
      </p>
    </div>
  );
}
