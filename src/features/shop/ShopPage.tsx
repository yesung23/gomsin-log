import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileText, Sparkles, Sprout } from 'lucide-react';
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import {
  GARDEN_ACCESSORY_OPTIONS,
} from '@/lib/companionGardenLocalState';
import {
  collectCompanionAccessory,
  collectCompanionPaper,
  loadCompanionShopState,
  type CollectibleGardenAccessory,
  type CompanionShopState,
} from '@/lib/companionShopLocalState';
import {
  STARTER_ACCESSORY_IDS,
  STARTER_ACCESSORY_OPTIONS,
  STARTER_REVEAL_DURATION_MS,
  drawStarterAccessory,
  getAvailableStarterPool,
  type StarterAccessoryId,
  type StarterAccessoryOption,
} from '@/lib/companionStarterReveal';
import { GardenAccessoryArt } from '@/features/diary/GardenAccessoryArt';
import {
  applyPaperTextureAttribute,
  PAPER_TEXTURE_OPTIONS,
  reconcileOwnedPaperTexture,
  savePaperTexture,
  type PaperTexture,
} from '@/lib/paperTexturePreference';

type ShopAnnouncement = {
  kind: 'status' | 'alert';
  section: 'accessory' | 'paper';
  message: string;
};

type PendingStarterReveal = {
  token: number;
  userId: string;
  item: StarterAccessoryOption;
};

const STARTER_REVEAL_FALLBACK_GRACE_MS = 250;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function withObjectParticle(label: string): string {
  const lastCodePoint = label.codePointAt(label.length - 1) ?? 0;
  const hasBatchim = lastCodePoint >= 0xac00
    && lastCodePoint <= 0xd7a3
    && (lastCodePoint - 0xac00) % 28 !== 0;
  return `${label}${hasBatchim ? '을' : '를'}`;
}

export function ShopPageBody() {
  const navigate = useNavigate();
  const { state } = useStore();
  const userId = state.authenticatedUser?.id || '';
  const [shopState, setShopState] = useState<CompanionShopState>(() => loadCompanionShopState(userId));
  const [selectedPaper, setSelectedPaper] = useState<PaperTexture>(() => {
    const initialShopState = loadCompanionShopState(userId);
    return reconcileOwnedPaperTexture(userId, initialShopState.ownedPapers);
  });
  const [announcement, setAnnouncement] = useState<ShopAnnouncement | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [revealedItem, setRevealedItem] = useState<StarterAccessoryId | null>(null);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinGenerationRef = useRef(0);
  const pendingRevealRef = useRef<PendingStarterReveal | null>(null);
  const currentUserIdRef = useRef(userId);
  currentUserIdRef.current = userId;

  useEffect(() => {
    spinGenerationRef.current += 1;
    pendingRevealRef.current = null;
    if (spinTimerRef.current) {
      clearTimeout(spinTimerRef.current);
      spinTimerRef.current = null;
    }
    setIsSpinning(false);
    setRevealedItem(null);

    const nextShopState = loadCompanionShopState(userId);
    setShopState(nextShopState);
    const nextPaper = reconcileOwnedPaperTexture(userId, nextShopState.ownedPapers);
    setSelectedPaper(nextPaper);
    applyPaperTextureAttribute(nextPaper);
    setAnnouncement(null);

    return () => {
      spinGenerationRef.current += 1;
      pendingRevealRef.current = null;
      if (spinTimerRef.current) {
        clearTimeout(spinTimerRef.current);
        spinTimerRef.current = null;
      }
    };
  }, [userId]);

  const availableStarterPool = getAvailableStarterPool(shopState.ownedAccessories);
  const isStarterComplete = availableStarterPool.length === 0;
  const rouletteOptions = STARTER_ACCESSORY_OPTIONS.filter(({ id }) => (
    availableStarterPool.includes(id)
  ));

  // Visual list of all accessories (starter items first, then legacy items if any)
  const legacyAccessories = GARDEN_ACCESSORY_OPTIONS.filter(
    (opt) => opt.id !== 'none' && !STARTER_ACCESSORY_IDS.includes(opt.id as StarterAccessoryId),
  );

  const completeStarterReveal = (token: number) => {
    const pending = pendingRevealRef.current;
    if (!pending
      || pending.token !== token
      || spinGenerationRef.current !== token
      || currentUserIdRef.current !== pending.userId) return;

    if (spinTimerRef.current) {
      clearTimeout(spinTimerRef.current);
      spinTimerRef.current = null;
    }
    pendingRevealRef.current = null;
    setShopState(loadCompanionShopState(pending.userId));
    setIsSpinning(false);
    setRevealedItem(pending.item.id);
    setAnnouncement({
      kind: 'status',
      section: 'accessory',
      message: `${withObjectParticle(pending.item.label)} 무료로 받았어요.`,
    });
  };

  const startDraw = () => {
    if (!userId || isSpinning || isStarterComplete) return;
    setAnnouncement(null);

    const drawRes = drawStarterAccessory(shopState.ownedAccessories);
    if (drawRes.status !== 'drawn') return;

    const drawnItem = drawRes.item;

    // Synchronously persist ownership before visual completion
    const nextState = collectCompanionAccessory(userId, drawnItem.id as CollectibleGardenAccessory);
    if (!nextState.ownedAccessories.includes(drawnItem.id as CollectibleGardenAccessory)) {
      setAnnouncement({
        kind: 'alert',
        section: 'accessory',
        message: '액세서리를 저장하지 못했어요. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요.',
      });
      return;
    }

    // Ownership is durable before the reveal begins. Reduced-motion users get
    // the same result without being forced through a decorative animation.
    if (prefersReducedMotion()) {
      setShopState(loadCompanionShopState(userId));
      setRevealedItem(drawnItem.id);
      setAnnouncement({
        kind: 'status',
        section: 'accessory',
        message: `${withObjectParticle(drawnItem.label)} 무료로 받았어요.`,
      });
      return;
    }

    const token = spinGenerationRef.current + 1;
    spinGenerationRef.current = token;
    pendingRevealRef.current = { token, userId, item: drawnItem };
    setIsSpinning(true);
    setRevealedItem(null);

    // `animationend` is the normal completion path. This fallback covers a
    // suspended/backgrounded WebView that never delivers the CSS event.
    spinTimerRef.current = setTimeout(() => {
      completeStarterReveal(token);
    }, STARTER_REVEAL_DURATION_MS + STARTER_REVEAL_FALLBACK_GRACE_MS);
  };

  const choosePaper = (paper: typeof PAPER_TEXTURE_OPTIONS[number]) => {
    if (!userId || isSpinning) return;
    const owned = shopState.ownedPapers.includes(paper.id);
    if (!owned) {
      const next = collectCompanionPaper(userId, paper.id);
      if (!next.ownedPapers.includes(paper.id)) {
        setAnnouncement({
          kind: 'alert',
          section: 'paper',
          message: '종이를 저장하지 못했어요. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요.',
        });
        return;
      }
      setShopState(next);
      setAnnouncement({
        kind: 'status',
        section: 'paper',
        message: `${withObjectParticle(paper.label)} 무료로 받았어요.`,
      });
      return;
    }
    if (selectedPaper === paper.id) return;

    savePaperTexture(userId, paper.id);
    applyPaperTextureAttribute(paper.id);
    setSelectedPaper(paper.id);
    setAnnouncement({
      kind: 'status',
      section: 'paper',
      message: `${withObjectParticle(paper.label)} 적용했어요.`,
    });
  };

  return (
    <div className="min-h-full pb-24">
      <AppBar
        title="상점"
        onBack={() => navigate('/diary')}
        backLabel="일기장으로 돌아가기"
        actions={(
          <AppBarAction aria-label="우리 정원 열기" onClick={() => navigate('/diary/garden')}>
            <Sprout size={20} className="pen-icon" color="var(--ink)" aria-hidden="true" />
          </AppBarAction>
        )}
      />

      <div className="space-y-6 px-4 py-4">
        <p className="text-caption leading-relaxed text-muted-foreground">
          지금 상점은 모두 무료이며 결제 기능이 없어요.
        </p>

        {/* Section 1: Starter Roulette Draw */}
        <section className="space-y-4" aria-labelledby="accessory-collection-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="accessory-collection-title" className="text-heading text-foreground">액세서리 컬렉션</h2>
            <span className="text-caption text-muted-foreground">무료</span>
          </div>
          <p className="text-label leading-relaxed text-muted-foreground">
            회전 뽑기로 장식을 무료로 하나씩 모아요. 중복 없이 모두 받을 수 있어요.
          </p>
          {!userId ? (
            <p id="shop-login-help" className="text-caption leading-relaxed text-muted-foreground">
              로그인하면 무료 수집과 종이 적용을 이용할 수 있어요.
            </p>
          ) : null}

          {/* Roulette Wheel visual card */}
          <div
            data-testid="accessory-draw-roulette"
            aria-busy={isSpinning}
            className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card/60 p-6 text-center shadow-sm"
          >
            <div className="relative flex h-32 w-32 items-center justify-center">
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[10px] border-x-transparent border-t-foreground"
              />
              <div
                data-testid="accessory-roulette-wheel"
                aria-hidden="true"
                onAnimationEnd={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const token = pendingRevealRef.current?.token;
                  if (token !== undefined) completeStarterReveal(token);
                }}
                className={`relative h-28 w-28 rounded-full border-2 border-dashed border-border bg-muted/30 ${
                  isSpinning ? 'accessory-roulette-spinning' : ''
                }`}
                style={{
                  '--accessory-roulette-duration': `${STARTER_REVEAL_DURATION_MS}ms`,
                } as CSSProperties}
              >
                {rouletteOptions.map((option, index) => {
                  const angle = -90 + (360 / Math.max(rouletteOptions.length, 1)) * index;
                  const radians = angle * Math.PI / 180;
                  return (
                    <span
                      key={option.id}
                      className="absolute h-7 w-7"
                      style={{
                        left: `${50 + Math.cos(radians) * 34}%`,
                        top: `${50 + Math.sin(radians) * 34}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      <GardenAccessoryArt accessory={option.id} className="h-full w-full drop-shadow-sm" />
                    </span>
                  );
                })}
              </div>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                {revealedItem ? (
                  <span
                    data-testid="starter-reveal-result"
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card shadow-sm"
                  >
                    <GardenAccessoryArt accessory={revealedItem} className="h-8 w-8" />
                  </span>
                ) : (
                  <Sparkles size={24} className="text-muted-foreground/60" />
                )}
              </span>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={startDraw}
                disabled={!userId || isSpinning || isStarterComplete}
                aria-label={isStarterComplete ? '모든 기본 장식을 모았어요' : '회전 뽑기로 장식 받기'}
                aria-describedby={!userId ? 'shop-login-help' : undefined}
                className="press-response min-h-11 rounded-control border border-border bg-foreground px-6 py-2.5 text-label font-semibold text-background disabled:cursor-default disabled:opacity-50"
              >
                {isStarterComplete
                  ? '모든 기본 장식을 모았어요'
                  : isSpinning
                    ? '장식 찾는 중...'
                    : '회전 뽑기로 장식 받기'}
              </button>
            </div>
            <p className="mt-2 text-caption text-muted-foreground">
              {isStarterComplete
                ? '준비된 무료 장식 5종을 모두 보유하고 있어요.'
                : `남은 무료 장식: ${availableStarterPool.length}개`}
            </p>
          </div>

          {/* Owned / Available starter items grid */}
          <div className="space-y-2">
            <h3 className="text-label font-semibold text-foreground">장식 목록</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="액세서리 목록">
              {STARTER_ACCESSORY_OPTIONS.map((option) => {
                const owned = shopState.ownedAccessories.includes(option.id);
                return (
                  <div
                    key={option.id}
                    className="flex min-h-11 items-center gap-2.5 rounded-control border border-border px-3 py-2 text-left"
                  >
                    <GardenAccessoryArt accessory={option.id} className="h-7 w-7" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-label font-semibold text-foreground truncate">{option.label}</span>
                      <span className="block text-caption font-normal text-muted-foreground">
                        {owned ? '보유 중' : '미보유'}
                      </span>
                    </div>
                  </div>
                );
              })}
              {legacyAccessories.map((option) => {
                const owned = shopState.ownedAccessories.includes(option.id as CollectibleGardenAccessory);
                if (!owned) return null;
                return (
                  <div
                    key={option.id}
                    className="flex min-h-11 items-center gap-2.5 rounded-control border border-border px-3 py-2 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block text-label font-semibold text-foreground truncate">{option.label}</span>
                      <span className="block text-caption font-normal text-muted-foreground">보유 중 (기존)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {announcement?.section === 'accessory' ? (
            <p
              role={announcement.kind}
              aria-live={announcement.kind === 'alert' ? 'assertive' : 'polite'}
              aria-atomic="true"
              className="text-label text-coral"
            >
              {announcement.message}
            </p>
          ) : null}
        </section>

        {/* Section 2: Paper Texture */}
        <section className="space-y-3" aria-labelledby="paper-texture-title">
          <div className="flex items-center gap-2">
            <FileText size={18} className="pen-icon" color="var(--ink)" aria-hidden="true" />
            <h2 id="paper-texture-title" className="text-heading text-foreground">종이 바탕</h2>
          </div>
          <p className="text-label leading-relaxed text-muted-foreground">
            가진 종이는 바로 적용하고, 새 종이는 무료로 받아 이 기기에 보관해요.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PAPER_TEXTURE_OPTIONS.map((paper) => {
              const owned = shopState.ownedPapers.includes(paper.id);
              const active = selectedPaper === paper.id;
              const actionLabel = active ? '사용 중' : owned ? '적용하기' : '무료로 받기';
              const label = `${paper.label} ${actionLabel}`;

              return (
                <button
                  key={paper.id}
                  type="button"
                  aria-label={label}
                  disabled={!userId || active || isSpinning}
                  aria-describedby={!userId ? 'shop-login-help' : undefined}
                  onClick={() => choosePaper(paper)}
                  className="press-response min-h-[112px] overflow-hidden rounded-surface border text-left disabled:cursor-default"
                  style={{ borderColor: active ? 'var(--ink)' : 'var(--ink-faint)' }}
                >
                  <span
                    aria-hidden="true"
                    data-paper={paper.id}
                    data-testid={`paper-texture-preview-${paper.id}`}
                    className="paper-texture-preview block h-16 border-b"
                  />
                  <span className="flex min-h-11 items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-label font-semibold text-foreground">{paper.label}</span>
                      <span className="block text-caption leading-relaxed text-muted-foreground">{paper.description}</span>
                    </span>
                    <span className="shrink-0 text-caption font-semibold text-foreground">{actionLabel}</span>
                    {active ? <Check size={17} className="shrink-0 pen-icon" color="var(--ink)" aria-hidden="true" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {announcement?.section === 'paper' ? (
            <p
              role={announcement.kind}
              aria-live={announcement.kind === 'alert' ? 'assertive' : 'polite'}
              aria-atomic="true"
              className="text-label text-coral"
            >
              {announcement.message}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export function ShopPage() {
  return (
    <MobileShell>
      <ShopPageBody />
    </MobileShell>
  );
}
