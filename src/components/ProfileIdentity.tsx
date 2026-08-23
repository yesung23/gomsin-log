import { useNavigate } from 'react-router-dom';
import type { ProfileCaptionResult } from '@/lib/profileCaption';

export function ProfileIdentity({
  name,
  caption,
}: {
  name: string;
  caption: ProfileCaptionResult;
}) {
  const navigate = useNavigate();

  return (
    <div className="px-4 pt-3">
      <h1 className="text-label font-bold truncate" style={{ color: 'var(--ink)' }}>{name || '나'}</h1>
      {caption.status === 'ready' ? (
        <p className="text-body mt-1 whitespace-pre-wrap break-keep" style={{ color: 'var(--ink)' }}>{caption.text}</p>
      ) : (
        <button
          type="button"
          onClick={() => navigate('/settings?profile=edit')}
          className="mt-1 block min-h-11 text-left text-caption underline underline-offset-2"
          style={{ color: 'var(--ink-soft)' }}
        >
          {caption.status === 'needs_setup' && caption.missing.includes('together')
            ? '기념일 미설정'
            : '소개를 설정해 보세요'}
        </button>
      )}
    </div>
  );
}
