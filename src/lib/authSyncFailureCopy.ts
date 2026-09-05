import type { ServerErrorKind } from '@/lib/serverErrors';
import type { AuthSyncStage } from '@/lib/sync';

interface AuthSyncFailureCopy {
  title: string;
  description: string;
  actionLabel: '다시 로그인' | '다시 시도';
}

interface StageCopy {
  title: string;
  hiddenSubject: string;
}

const STAGE_COPY: Record<AuthSyncStage, StageCopy> = {
  profile: {
    title: '계정 정보를 확인하지 못했어요',
    hiddenSubject: '계정 데이터는',
  },
  membership: {
    title: '커플 공간을 확인하지 못했어요',
    hiddenSubject: '커플 공간 정보는',
  },
  couple: {
    title: '커플 공간을 확인하지 못했어요',
    hiddenSubject: '커플 공간 정보는',
  },
  partner: {
    title: '커플 공간을 확인하지 못했어요',
    hiddenSubject: '커플 공간 정보는',
  },
  contact: {
    title: '연락 설정을 불러오지 못했어요',
    hiddenSubject: '연락 설정은',
  },
  records: {
    title: '기록을 불러오지 못했어요',
    hiddenSubject: '둘의 기록은',
  },
  events: {
    title: '일정을 불러오지 못했어요',
    hiddenSubject: '일정은',
  },
  trips: {
    title: '여행 정보를 불러오지 못했어요',
    hiddenSubject: '여행 정보는',
  },
  'talk-about': {
    title: '이야기할 기록을 불러오지 못했어요',
    hiddenSubject: '모아둔 이야기는',
  },
  unexpected: {
    title: '앱 정보를 불러오지 못했어요',
    hiddenSubject: '계정 데이터는',
  },
  timeout: {
    title: '앱 정보를 불러오는 데 시간이 걸려요',
    hiddenSubject: '계정 데이터는',
  },
};

const CAUSE_LEAD: Record<Exclude<ServerErrorKind, 'auth_expired'>, string> = {
  forbidden: '해당 정보에 접근할 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  not_found: '요청한 정보를 찾지 못했어요. 잠시 후 다시 시도해 주세요.',
  offline: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  unreachable: '서버에 요청이 닿지 않았어요. 잠시 후 다시 시도해 주세요.',
  server: '서비스가 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
  unknown: '잠시 후 다시 시도해 주세요.',
};

/**
 * Translate a fail-closed hydration result into copy that names the data that
 * actually failed. The safety behavior is intentionally outside this function:
 * App still hides every authenticated route until hydration succeeds.
 */
export function authSyncFailureCopy(
  reason: ServerErrorKind | null,
  stage: AuthSyncStage | null,
): AuthSyncFailureCopy {
  if (reason === 'auth_expired') {
    return {
      title: '세션이 만료되었어요',
      description: '다시 로그인해 주세요. 확인이 끝날 때까지 계정 데이터는 표시하지 않아요.',
      actionLabel: '다시 로그인',
    };
  }

  const stageCopy = STAGE_COPY[stage ?? 'unexpected'];
  const cause = reason ?? 'unknown';

  return {
    title: stageCopy.title,
    description: `${CAUSE_LEAD[cause]} 확인이 끝날 때까지 ${stageCopy.hiddenSubject} 표시하지 않아요.`,
    actionLabel: '다시 시도',
  };
}
