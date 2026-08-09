import type { ScreenState } from './fixtures';
import { GhostButton, PrimaryButton, Skeleton } from './ui';

type Props = { state: ScreenState; compact: boolean };

/* ================================================================== */
/* 로그인 — the action sits in the thumb zone, not the optical centre   */
/* ================================================================== */

export function Login({ state, compact }: Props) {
  return (
    <div className="flex h-full flex-col justify-between bg-background px-5 pb-6 pt-10">
      <div className="pt-6">
        <h1 className="text-[28px] font-bold leading-tight text-foreground">곰신로그</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          답장이 늦어도,
          <br />
          오늘의 순간은 놓치지 않도록.
        </p>
      </div>

      <div className="space-y-2">
        {state === 'loading' ? (
          <Skeleton label="로그인 상태를 확인하는 중이에요" lines={2} />
        ) : (
          <>
            {state === 'error' ? (
              <div className="mb-1 rounded-md border border-border bg-warning-surface px-3 py-2">
                <p className="text-[13px] font-medium text-warning-foreground">
                  로그인이 취소되었어요
                </p>
                <p className="text-[12px] text-warning-foreground">다시 시도해 주세요.</p>
              </div>
            ) : null}

            {/*
              Social buttons are `secondary`, never coral. Putting the brand's
              primary colour on someone else's identity button blurs which action
              belongs to this app.
            */}
            {['Google로 계속하기', 'Apple로 계속하기', '이메일로 시작하기'].map((label) => (
              <button
                key={label}
                type="button"
                className="min-h-13 w-full rounded-md border border-border bg-card text-[15px] font-semibold text-foreground"
              >
                {label}
              </button>
            ))}
            <div className="pt-1 text-center">
              <GhostButton label="둘러보기" />
            </div>
            <p className="pt-1 text-center text-[11px] leading-relaxed text-muted-foreground">
              계속하면 이용약관과
              {compact ? ' ' : <br />}
              개인정보 처리방침에 동의합니다
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 온보딩 — one decision per screen                                     */
/* ================================================================== */

export function Onboarding({ state, compact }: Props) {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between px-2 py-2">
        <button type="button" aria-label="뒤로" className="min-h-11 min-w-11 text-muted-foreground">
          ‹
        </button>
        {/* Text progress, not dots: dots are cramped at 320px and mean nothing to a
            screen reader. */}
        <span className="pr-3 text-[13px] tabular-nums text-muted-foreground">2 / 4</span>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-4">
        <h1 className="text-[20px] font-bold leading-snug text-foreground">어느 쪽이신가요?</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          역할에 따라 첫 화면과 다음 질문이 달라져요.
        </p>

        {/*
          Role and military status used to share one screen. They are split because
          the answer here changes what is asked next -- 곰신 is never asked her own
          branch of service -- and WIREFRAMES §4 already required one decision per
          screen.
        */}
        <div className={`mt-4 grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {[
            { title: '곰신이에요', sub: '기다리는 사람' },
            { title: '군화예요', sub: '복무 중인 사람' },
          ].map((r, i) => (
            <button
              key={r.title}
              type="button"
              aria-pressed={i === 0}
              className={`flex min-h-22 flex-col items-center justify-center gap-1 rounded-lg border px-3 ${
                i === 0
                  ? 'border-coral bg-card ring-2 ring-coral'
                  : 'border-border bg-card'
              }`}
            >
              <span className="text-[15px] font-semibold text-foreground">{r.title}</span>
              <span className="text-[12px] text-muted-foreground">{r.sub}</span>
            </button>
          ))}
        </div>

        {state === 'error' ? (
          <p className="mt-3 text-[13px] font-medium text-destructive">
            역할을 선택해 주세요.
          </p>
        ) : null}
      </div>

      <div className="shrink-0 px-5 pb-6 pt-2">
        <PrimaryButton label="다음" full />
      </div>
    </div>
  );
}

/* ================================================================== */
/* 연결 대기 — partner data must not appear to exist yet                */
/* ================================================================== */

export function PendingConnect({ state, compact }: Props) {
  const code = ['3', '8', '1', '2', '4', '9'];
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between px-2 py-2">
        <button type="button" aria-label="뒤로" className="min-h-11 min-w-11 text-muted-foreground">
          ‹
        </button>
        <span className="pr-3 text-[13px] tabular-nums text-muted-foreground">4 / 4</span>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-2">
        <h1 className="text-[20px] font-bold leading-snug text-foreground">
          둘만의 공간을 연결해요
        </h1>

        {state === 'loading' ? (
          <div className="mt-4">
            <Skeleton label="공간 정보를 확인하는 중이에요" lines={3} />
          </div>
        ) : state === 'empty' ? (
          <>
            <p className="mt-1 text-[13px] text-muted-foreground">
              먼저 공간을 만들고 코드를 상대에게 보내면 돼요.
            </p>
            <div className="mt-4">
              <PrimaryButton label="새 공간 만들기" full />
            </div>
            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[12px] text-muted-foreground">또는</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <p className="text-[13px] font-medium text-foreground">초대 코드 6자리</p>
            <div className="mt-1.5 flex gap-1.5">
              {code.map((_, i) => (
                <span
                  key={i}
                  className="flex flex-1 items-center justify-center rounded-md border border-border bg-card text-[17px] font-semibold tabular-nums text-foreground"
                  style={{ minHeight: 52 }}
                >
                  {' '}
                </span>
              ))}
            </div>
            {state === 'error' ? null : null}
            <div className="mt-3">
              <button
                type="button"
                className="min-h-13 w-full rounded-md border border-border bg-card text-[15px] font-semibold text-foreground"
              >
                참가하기
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-muted-foreground">
              이 코드를 상대에게 보내 주세요. 24시간 동안 쓸 수 있어요.
            </p>

            <div className="mt-4 rounded-lg border border-border bg-card px-4 py-4 text-center">
              <div className={`flex justify-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
                {code.map((d, i) => (
                  <span
                    key={i}
                    className="flex items-center justify-center rounded-md bg-muted text-[20px] font-bold tabular-nums text-foreground"
                    style={{ minWidth: compact ? 36 : 44, minHeight: 52 }}
                  >
                    {d}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-md border border-border px-3 text-[13px] font-medium text-foreground"
                >
                  코드 복사
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-md border border-border px-3 text-[13px] font-medium text-foreground"
                >
                  재발급
                </button>
              </div>
            </div>

            {/*
              Waiting state, NOT a populated home. Nothing here implies the partner
              already exists or has written anything: showing an empty partner
              timeline would read as "he never writes".
            */}
            <div className="mt-3 rounded-lg border border-border bg-muted px-4 py-3">
              <p className="text-[14px] font-medium text-foreground">상대의 참가를 기다리고 있어요</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                연결되면 서로의 하루가 보이기 시작해요. 그때까지 내 기록은 혼자 남겨 둘 수 있어요.
              </p>
            </div>

            {state === 'error' ? (
              <div className="mt-3 rounded-md border border-border bg-warning-surface px-3 py-2">
                <p className="text-[13px] font-medium text-warning-foreground">
                  만료된 코드예요
                </p>
                <p className="text-[12px] text-warning-foreground">
                  재발급을 눌러 새 코드를 받아 주세요. 입력한 값은 그대로 있어요.
                </p>
              </div>
            ) : null}

            <div className="mt-3">
              <GhostButton label="먼저 혼자 기록 시작하기 ›" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
