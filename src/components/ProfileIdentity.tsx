import { useNavigate } from 'react-router-dom';
import { AvatarPicker } from '@/components/AvatarPicker';
import { InkCircle, PenFace } from '@/components/paper';
import type { ProfileCaptionResult } from '@/lib/profileCaption';

export function ProfileIdentity({
  userId,
  name,
  username,
  caption,
}: {
  userId?: string;
  name: string;
  username?: string;
  caption: ProfileCaptionResult;
}) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-6 px-4 pt-1">
      <AvatarPicker userId={userId} slot="me" size={82} label="내 프로필 사진">
        <InkCircle size={82} ring="seen"><PenFace size={56} /></InkCircle>
      </AvatarPicker>
      <div className="min-w-0 flex-1">
        <h1 className="text-label font-semibold truncate" style={{ color: 'var(--ink)' }}>{name || '나'}</h1>
        {username ? (
          <p className="text-caption" style={{ color: 'var(--ink-soft)' }}>@{username}</p>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="text-caption underline underline-offset-2"
            style={{ color: 'var(--ink-soft)' }}
          >
            아이디 설정하기
          </button>
        )}
        {caption.status === 'ready' ? (
          <p className="text-body mt-1 break-keep" style={{ color: 'var(--ink)' }}>{caption.text}</p>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="mt-1 text-caption text-left underline underline-offset-2"
            style={{ color: 'var(--ink-soft)' }}
          >
            {caption.status === 'needs_setup' && caption.missing.includes('together')
              ? '기념일 미설정'
              : '소개를 설정해 보세요'}
          </button>
        )}
      </div>
    </div>
  );
}
