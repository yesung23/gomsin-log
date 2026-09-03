import { useNavigate } from 'react-router-dom';
import { ChevronRight, Clock, Shield } from 'lucide-react';
import { AppBar } from '@/components/ui/AppBar';
import { CycleSupportSection } from '@/components/CycleSupportSection';
import { CycleTrackerSection } from '@/components/CycleTrackerSection';
import { computeServiceProgress } from '@/lib/milestones';
import { localToday } from '@/lib/cycle';
import { useStore } from '@/lib/useStore';
import type { MilitaryInfo, ContactPreferences } from '@/types';
import { MobileShell } from '@/components/MobileShell';
import { resolveRelationshipContext } from '@/lib/relationshipContext';

/**
 * 나 — 지금 상대에게 연락해도 되나. 상대는 지금 어떤 상태인가.
 *
 * 떨어져 있는 커플이 매일 부딪히는 질문은 이것 하나다. 군화는 훈련과 점호 때문에 연락이
 * 닿지 않고, 곰신은 아파서 힘들고, 장거리 커플은 시차와 근무 때문에 어긋난다. **원인은
 * 다르고 질문은 같다.**
 *
 * ## 이 화면은 새 기능이 아니다
 *
 * 답에 필요한 것은 이미 전부 앱 안에 있었고 **아무도 찾을 수 없는 곳에 있었다.** 복무
 * 현황과 연락 가능 시간은 `우리` 를 거쳐야 나오고, 주기와 배려 신호는 `마이` 의 설정 안에
 * 있어 존재를 모르고 지나간다. 매일 답해야 하는 질문의 답이 설정 안에 있으면 그 기능은
 * 없는 것과 같다. 여기로 **옮겼다** -- 복사하지 않았다. 같은 것을 두 곳에서 켜고 끄면
 * 어느 쪽이 진짜인지 알 수 없게 된다.
 *
 * ## 군 관련 카드는 끄는 것이 아니라 없다
 *
 * §11. `computeServiceProgress` 는 날짜가 없거나 `unknown` 이면 `null` 을 준다. 군 복무가
 * 아닌 커플에게 이 화면은 회색으로 비활성된 복무 카드를 보여주는 대신 그 카드가 아예 없는
 * 화면이 된다. 남는 것이 `오늘 컨디션` 하나뿐이어도 이 탭은 유효하다 -- 그것이 이 탭이
 * 답하는 질문의 전부이기 때문이다.
 *
 * ## §16 과 §21 을 넘지 않는다
 *
 * 상대의 주기 원본은 보이지 않고 **상대가 보내기로 한 것만** 보인다. 관계 점수도, 열람
 * 시각도, 접속 여부도 없다. 컨디션은 주기에서 계산되지 않고 사용자가 그날 직접 고른다.
 */

function MePageBody() {
  const navigate = useNavigate();
  const { state } = useStore();
  const { profile, authenticatedUser } = state;

  const authenticated = Boolean(authenticatedUser?.id);
  const connected = profile.couple.connected;
  const isGomsin = profile.role === 'gomsin';
  const isMilitaryRelationship = resolveRelationshipContext(
    profile.couple.relationshipContext,
  ) === 'military';

  const progress = computeServiceProgress(
    isMilitaryRelationship ? profile.military : undefined,
    localToday(),
  );
  /*
    복무 카드를 그릴 것인가.

    `computeServiceProgress` 가 `null` 이면 입대일이나 전역일이 없거나 상태가 `unknown`
    이다. 어느 쪽이든 이 커플에게 복무는 **없는 사실**이므로 자리도 만들지 않는다.

    전역한 뒤에도 그리지 않는다. 그 함수는 전역 뒤에도 `isDischarged: true` 로 계속 값을
    주는데, 그건 `/service` 와 `coupleStats` 가 그 상태를 알아야 해서다. 이 화면은 다르다
    -- 여기가 답하는 질문은 "지금 연락해도 되나"이고, 전역한 사람에게 복무는 더 이상 그
    질문의 답이 아니다. 남겨 두면 **"전역 🎉" 가 영원히 붙어 있는 트로피**가 되고, §11이
    말하는 "군 관련 표면은 끄는 것이 아니라 없다"에 어긋난다.

    전역이라는 사건 자체는 축하받아야 하고, 그 자리는 따로 있다 -- `우리` 의 하이라이트와
    `일기장` 의 마일스톤(`BUSINESS` §9.2가 1순위로 검증하겠다고 한 바로 그것)이다.
  */
  const discharged = isMilitaryRelationship && (
    progress?.isDischarged === true
    || profile.military.militaryStatus === 'discharged'
  );
  const serving = isMilitaryRelationship && progress !== null && !discharged;

  return (
    <div className="min-h-full pb-24">
      <AppBar title="나" />

      <div className="px-4 py-4 space-y-4">
        {/*
          내 것이 먼저 온다.

          이 화면에서 사용자가 **할 수 있는 일**은 자기 신호를 보내는 것 하나뿐이고,
          나머지는 읽는 것이다. 읽을 것을 위에 두면 매번 스크롤해서 내려와야 한다.
        */}
        <CycleSupportSection
          key={`mine:${authenticatedUser?.id || 'signed-out'}`}
          mine
          authenticated={authenticated}
          userId={authenticatedUser?.id}
          coupleId={profile.couple.coupleId}
          connected={connected}
          recipientLabel={isMilitaryRelationship ? '군화' : '상대방'}
        />

        {/*
          상대가 보낸 것.

          상대가 아무것도 보내지 않았으면 이 컴포넌트는 아무것도 그리지 않는다 -- 그래야
          "보낼까 하다 말았다"는 사실이 새어 나가지 않는다.
        */}
        <CycleSupportSection
          key={`partner:${authenticatedUser?.id || 'signed-out'}`}
          mine={false}
          authenticated={authenticated}
          userId={authenticatedUser?.id}
          coupleId={profile.couple.coupleId}
          connected={connected}
        />

        {/*
          주기.

          군 복무 맥락에서는 기존 공개 범위를 보존한다. 일반 커플에서는 내부 멤버 슬롯이나
          선택 성별로 건강 도구를 막지 않는다. 원본은 계속 소유자에게만 보이고, 상대에게는
          사용자가 그날 직접 보낸 배려 신호만 전달된다.
        */}
        {(!isMilitaryRelationship || isGomsin) ? (
          <CycleTrackerSection
            key={authenticatedUser?.id || 'signed-out'}
            userId={authenticatedUser?.id}
          />
        ) : null}

        {serving ? (
          <ServiceCard
            military={profile.military}
            contact={profile.contact}
            mine={!isGomsin}
            partnerName={profile.couple.partnerName}
            remainingDays={progress.remainingDays}
            percent={progress.percent}
            onOpen={() => navigate('/service')}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * 복무 카드.
 *
 * `/service` 전체를 여기 옮기지 않는다. 이 화면이 답하는 질문은 "지금 연락해도 되나"이고,
 * 그 답에 필요한 것은 **얼마나 남았나**와 **언제 닿나** 둘뿐이다. 나머지 -- 군별, 입대일,
 * 다음 휴가 목록, 수정 -- 는 `/service` 가 계속 소유한다.
 */
export function ServiceCard({
  military,
  contact,
  mine,
  partnerName,
  remainingDays,
  percent,
  onOpen,
}: {
  military: MilitaryInfo;
  contact: ContactPreferences;
  mine: boolean;
  partnerName: string;
  remainingDays: number;
  percent: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={mine ? '내 복무 현황 열기' : `${partnerName}의 복무 현황 열기`}
      className="press-response w-full rounded-control border border-border bg-card p-4 text-left"
    >
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-muted-foreground" aria-hidden="true" />
        <span className="text-label font-bold text-card-foreground">
          {mine ? '내 복무' : `${partnerName}의 복무`}
        </span>
        <span className="ml-auto text-heading font-bold text-card-foreground tabular-nums">
          D-{remainingDays}
        </span>
        <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />
      </div>

      {/*
        트랙 위의 막대는 강한 쪽 토큰을 쓴다.

        기본 산호빛은 밝아서 `--muted` 트랙 위에 얹으면 차오른 부분과 남은 부분이 잘 안
        갈린다. 여기서 이 막대가 하는 일은 "얼마나 왔나"를 한눈에 말하는 것 하나뿐이므로
        대비가 곧 기능이다. `/service` 의 큰 막대는 어두운 남색 위에 있어서 기본 토큰으로
        충분하고, 그래서 둘이 다른 토큰을 쓴다.
      */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-coral-strong" style={{ width: `${percent}%` }} />
      </div>

      {/*
        연락 가능 시간이야말로 이 화면의 질문에 가장 직접 답한다.

        `/service` 안에 있어서 두 번 들어가야 보였다. 꺼져 있으면 그리지 않는다 --
        "설정 안 함"을 굳이 말할 이유가 없고, 말하면 재촉이 된다.
      */}
      {contact.enabled ? (
        <p className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
          <Clock size={13} aria-hidden="true" />
          평일 {contact.weekdayStart}–{contact.weekdayEnd} · 주말 {contact.weekendStart}–{contact.weekendEnd}
        </p>
      ) : null}

      {military.memo ? (
        <p className="mt-1.5 text-caption text-muted-foreground line-clamp-2">{military.memo}</p>
      ) : null}
    </button>
  );
}

/**
 * 탭은 셸 안에 있어야 한다.

 * 셸이 하단 탭바와 스킵 링크와 라우트 안내를 갖는다. 이것 없이 렌더하면 그 탭에 들어간
 * 사람은 탭바가 없어 **빠져나올 수 없다** -- 뒤로 가기 말고는.
 */
export function MePage() {
  return (
    <MobileShell>
      <MePageBody />
    </MobileShell>
  );
}
