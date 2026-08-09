import type { ScreenState } from './fixtures';
import { SERVICE } from './fixtures';
import { AppBar, Card, EmptyState, GhostButton, Skeleton, TabBar } from './ui';

type Props = { state: ScreenState; compact: boolean };

function Row({
  label,
  value,
  danger,
}: {
  label: string;
  value?: string;
  danger?: boolean;
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        className="flex w-full min-h-12 items-center gap-3 px-4 py-2 text-left"
      >
        <span
          className={`min-w-0 flex-1 text-[14px] ${
            danger ? 'font-medium text-destructive' : 'text-foreground'
          }`}
        >
          {label}
        </span>
        {value ? (
          <span className="shrink-0 text-[13px] text-muted-foreground truncate max-w-[45%]">
            {value}
          </span>
        ) : null}
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          ›
        </span>
      </button>
    </li>
  );
}

/* ================================================================== */
/* 우리 — relationship context. 복무 현황 lives here, not in 마이.       */
/* ================================================================== */

export function Us({ state }: Props) {
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="우리" />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {state === 'loading' ? (
          <Card>
            <Skeleton label="우리 정보를 불러오는 중이에요" lines={3} />
          </Card>
        ) : state === 'empty' ? (
          <Card>
            <EmptyState
              title="아직 연결되지 않았어요"
              description="초대 코드를 주고받으면 함께한 날이 쌓여요."
              action="연결하기"
            />
          </Card>
        ) : (
          <>
            <Card>
              <div className="px-4 py-4 text-center">
                <div className="flex items-center justify-center gap-3">
                  <span
                    aria-hidden="true"
                    className="block rounded-full bg-muted"
                    style={{ width: 48, height: 48 }}
                  />
                  <span className="text-coral text-[18px]" aria-hidden="true">
                    ♡
                  </span>
                  <span
                    aria-hidden="true"
                    className="block rounded-full bg-muted"
                    style={{ width: 48, height: 48 }}
                  />
                </div>
                <p className="mt-2 text-[13px] text-muted-foreground">민지 · 현우</p>
                <p className="mt-0.5 text-[28px] font-bold tabular-nums leading-tight text-foreground">
                  412일
                </p>
                <p className="text-[13px] text-muted-foreground">함께한 날</p>
              </div>
            </Card>

            <Card title="8월" action={<span className="text-[12px] text-muted-foreground">기념일 2</span>}>
              <div className="px-4 pb-3">
                <div className="grid grid-cols-7 gap-0.5">
                  {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
                    <span key={d} className="text-center text-[11px] text-muted-foreground">
                      {d}
                    </span>
                  ))}
                  {Array.from({ length: 21 }).map((_, i) => {
                    const day = i + 1;
                    const mark = day === 15 || day === 20;
                    return (
                      <span
                        key={day}
                        className="flex min-h-11 flex-col items-center justify-center text-[12px] tabular-nums text-foreground"
                      >
                        {day}
                        {/*
                          A marker, not a filled cell. Filling the whole cell made an
                          anniversary look like the SELECTED day, which is what a
                          filled cell means on every other calendar in this app.
                        */}
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 block rounded-full ${mark ? 'bg-coral' : 'bg-transparent'}`}
                          style={{ width: 5, height: 5 }}
                        />
                      </span>
                    );
                  })}
                </div>
                <ul className="mt-2 space-y-1">
                  <li className="text-[13px] text-foreground">
                    <span className="tabular-nums text-muted-foreground">8/15 </span>면회
                  </li>
                  <li className="text-[13px] text-foreground">
                    <span className="tabular-nums text-muted-foreground">8/20 </span>제주도 여행 시작
                  </li>
                </ul>
              </div>
            </Card>

            <Card title="다가오는 여행">
              <div className="flex items-baseline gap-2 px-4 pb-3">
                <span className="text-[15px] font-semibold text-foreground">제주도</span>
                <span className="text-[12px] tabular-nums text-muted-foreground">8/20 – 8/22</span>
                <span className="ml-auto text-[17px] font-bold tabular-nums text-foreground">
                  D-13
                </span>
              </div>
            </Card>

            {/* Moved from 마이: this is the waiting the two of them share, not an
                account setting. 곰신 checks it most often. */}
            <Card title="현우의 복무" action={<GhostButton label="편집" />}>
              <div className="px-4 pb-3">
                <p className="text-[28px] font-bold tabular-nums leading-tight text-foreground">
                  D-{SERVICE.dday}
                </p>
                <p className="text-[13px] text-muted-foreground">전역까지</p>
                <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    aria-hidden="true"
                    className="block h-full rounded-full bg-coral"
                    style={{ width: `${SERVICE.percent}%` }}
                  />
                </span>
                <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
                  {SERVICE.branch} · 2025.03.10 – 2026.12.09 · {SERVICE.percent}%
                </p>
                <p className="mt-2 text-[13px] text-foreground">다음 면회 8월 15일 (D-8)</p>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="min-h-11 rounded-md border border-border bg-card text-[13px] font-medium text-foreground"
              >
                일정 보기
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md border border-border bg-card text-[13px] font-medium text-foreground"
              >
                여행 보기
              </button>
            </div>
          </>
        )}
      </div>
      <TabBar active="우리" />
    </div>
  );
}

/* ================================================================== */
/* 마이 — only things that are MINE                                     */
/* ================================================================== */

export function My({ state }: Props) {
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="마이" />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <Card>
          <div className="flex items-center gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className="block shrink-0 rounded-full bg-muted"
              style={{ width: 44, height: 44 }}
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-foreground">민지</span>
              <span className="block text-[12px] text-muted-foreground">
                곰신 · {state === 'error' ? '연결 상태 확인 중' : '연결됨'}
              </span>
            </span>
          </div>
        </Card>

        <Card title="내 정보">
          <ul className="border-t border-border">
            <Row label="닉네임" value="민지" />
            <Row label="테마" value="시스템" />
          </ul>
        </Card>

        <Card title="커플 연결">
          <ul className="border-t border-border">
            <Row label="초대 코드" value="381 249" />
            <Row label="코드 재발급" />
          </ul>
        </Card>

        {/*
          Author-only. The partner does not get a disabled row or a "no access"
          notice: the section is not rendered for them at all, because even an
          access-denied message discloses that the data exists.

          Raw entries stay owner-only in the database (RLS), are excluded from
          Realtime and from localStorage, and the only thing a partner can ever see
          is a same-day support signal the author explicitly turned on -- with no
          dates, symptoms or predictions, revocable at once and expiring within 24h.
        */}
        <Card title="나만의 기록">
          <ul className="border-t border-border">
            <Row label="주기 기록" value="나만 볼 수 있어요" />
          </ul>
        </Card>

        <Card title="데이터">
          <ul className="border-t border-border">
            <Row label="내 기록 내보내기" />
          </ul>
        </Card>

        <Card title="약관">
          <ul className="border-t border-border">
            <Row label="이용약관" />
            <Row label="개인정보 처리방침" />
          </ul>
        </Card>

        <GhostButton label="설정 열기 ›" />
      </div>
      <TabBar active="마이" />
    </div>
  );
}

/* ================================================================== */
/* 설정 — danger zone last, separated, and not painted red             */
/* ================================================================== */

export function Settings({ state, compact }: Props) {
  return (
    <div className="flex flex-col h-full bg-background">
      <header className="shrink-0 flex items-center gap-2 border-b border-border px-2 py-2">
        <button type="button" aria-label="뒤로" className="min-h-11 min-w-11 text-muted-foreground">
          ‹
        </button>
        <span className="flex-1 text-[17px] font-semibold text-foreground">설정</span>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {state === 'loading' ? (
          <Card title="내 정보">
            <Skeleton label="설정을 불러오는 중이에요" lines={3} />
          </Card>
        ) : (
          <>
            <Card title="내 정보">
              <ul className="border-t border-border">
                <Row label="닉네임" value="민지" />
                <Row label="테마" value={compact ? '시스템' : '시스템 설정 따르기'} />
              </ul>
            </Card>

            <Card title="커플 연결">
              <ul className="border-t border-border">
                <Row label="초대 코드 복사" value="381 249" />
                <Row label="코드 재발급" />
              </ul>
            </Card>

            <Card title="바로가기">
              <ul className="border-t border-border">
                <Row label="일정" />
                <Row label="여행" />
                <Row label="복무 현황" />
              </ul>
            </Card>

            <Card title="데이터">
              <ul className="border-t border-border">
                <Row label="내 기록 JSON으로 내보내기" />
              </ul>
            </Card>

            <Card title="약관">
              <ul className="border-t border-border">
                <Row label="이용약관" />
                <Row label="개인정보 처리방침" />
              </ul>
            </Card>

            {/*
              32px of air, a destructive-toned LABEL, but ordinary rows. Painting
              three red blocks makes them look like buttons that want pressing;
              only the final confirmation is `danger`.
            */}
            <div style={{ height: 32 }} />
            <p className="px-1 text-[12px] font-semibold text-destructive">위험 행동</p>
            <Card>
              <ul>
                <Row label="커플 연결 해제" danger />
                <Row label="내가 쓴 기록 전체 삭제" danger />
                <Row label="계정 삭제" danger />
              </ul>
            </Card>
            <p className="px-1 pb-2 text-[12px] text-muted-foreground">
              어떤 것도 한 번의 실수로 실행되지 않아요. 무엇이 사라지는지 먼저 설명해 드려요.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 파괴적 확인 — the ONLY centre modal in the product                   */
/* ================================================================== */

export function DeleteConfirm(_props: Props) {
  return (
    <div className="relative flex h-full flex-col bg-background">
      {/* Dimmed page behind, to show the modal is not a page of its own. */}
      <div className="pointer-events-none flex-1 opacity-40">
        <AppBar title="설정" />
        <div className="px-3 py-3 space-y-2">
          {['닉네임', '테마', '초대 코드'].map((t) => (
            <div key={t} className="rounded-lg border border-border bg-card px-4 py-3">
              <span className="text-[14px] text-foreground">{t}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-foreground/40 px-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          className="w-full rounded-xl border border-border bg-card px-4 py-4"
        >
          <h2 id="confirm-title" className="text-[17px] font-semibold text-foreground">
            계정을 삭제할까요?
          </h2>
          {/* Consequence in plain language FIRST, including the effect on the
              partner. Buttons come after. */}
          <p className="mt-2 text-[14px] text-foreground">
            내가 쓴 기록과 사진, 계정 접근이 모두 사라집니다. 현우가 볼 수 있던 내 기록도 함께
            사라져요.
          </p>
          <p className="mt-2 text-[14px] text-muted-foreground">
            삭제 대기 기간에는 다시 로그인해 취소할 수 있어요.
          </p>
          <div className="mt-4 flex gap-2">
            {/* 취소 is first and takes initial focus. */}
            <button
              type="button"
              className="min-h-12 flex-1 rounded-md border border-border bg-card text-[15px] font-semibold text-foreground"
            >
              취소
            </button>
            <button
              type="button"
              className="min-h-12 flex-1 rounded-md bg-destructive text-[15px] font-semibold text-destructive-foreground"
            >
              삭제 요청
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
