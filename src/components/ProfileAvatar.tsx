import { useState, type ReactNode } from 'react';
import { useProfileAvatar } from '@/lib/useProfileAvatar';

/** The surrounding story button owns its label and unseen ring state. */
export function ProfileAvatar({ userId, size, children }: { userId?: string; size: number; children: ReactNode }) {
  const { dataUrl } = useProfileAvatar(userId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return dataUrl && dataUrl !== failedUrl
    ? <img src={dataUrl} alt="" aria-hidden="true" width={size} height={size}
        className="rounded-full object-cover" style={{ width: size, height: size }}
        onError={() => setFailedUrl(dataUrl)} />
    : <>{children}</>;
}
