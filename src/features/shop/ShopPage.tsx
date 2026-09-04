import { useEffect, useRef, useState } from 'react';
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

type RevealMotion = 'full' | 'reduced';

type PendingStarterReveal = {
  token: number;
  userId: string;
  item: StarterAccessoryOption;
};

const STARTER_REVEAL_DURATION_MS = 1200;
const REDUCED_REVEAL_DURATION_MS = 140;
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
  const [revealMotion, setRevealMotion] = useState<RevealMotion | null>(null);
  const [revealedItem, setRevealedItem] = useState<StarterAccessoryId | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealGenerationRef = useRef(0);
  const pendingRevealRef = useRef<PendingStarterReveal | null>(null);
  const currentUserIdRef = useRef(userId);
  currentUserIdRef.current = userId;
  const isRevealing = revealMotion !== null;

  useEffect(() => {
    revealGenerationRef.current += 1;
    pendingRevealRef.current = null;
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setRevealMotion(null);
    setRevealedItem(null);

    const nextShopState = loadCompanionShopState(userId);
    setShopState(nextShopState);
    const nextPaper = reconcileOwnedPaperTexture(userId, nextShopState.ownedPapers);
    setSelectedPaper(nextPaper);
    applyPaperTextureAttribute(nextPaper);
    setAnnouncement(null);

    return () => {
      revealGenerationRef.current += 1;
      pendingRevealRef.current = null;
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
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
      || revealGenerationRef.current !== token
      || currentUserIdRef.current !== pending.userId) return;

    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    pendingRevealRef.current = null;
    setShopState(loadCompanionShopState(pending.userId));
    setRevealMotion(null);
    setRevealedItem(pending.item.id);
    setAnnouncement({
      kind: 'status',
      section: 'accessory',
      message: `${withObjectParticle(pending.item.label)} 무료로 받았어요.`,
    });
  };

  const startReveal = () => {
    if (!userId || isRevealing || pendingRevealRef.current || isStarterComplete) return;
    setAnnouncement(null);

    const randomIndex = Math.floor(Math.random() * availableStarterPool.length);
    const selectedId = availableStarterPool[randomIndex] ?? availableStarterPool[0];
    const selectedItem = STARTER_ACCESSORY_OPTIONS.find(({ id }) => id === selectedId);
    if (!selectedItem) return;

    // The item remains hidden until this durable ownership write succeeds.
    const nextState = collectCompanionAccessory(
      userId,
      selectedItem.id as CollectibleGardenAccessory,
    );
    if (!nextState.ownedAccessories.includes(selectedItem.id as CollectibleGardenAccessory)) {
      setAnnouncement({
        kind: 'alert',
        section: 'accessory',
        message: '액세서리를 저장하지 못했어요. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요.',
      });
      return;
    }

    const token = revealGenerationRef.current + 1;
    const motion: RevealMotion = prefersReducedMotion() ? 'reduced' : 'full';
    revealGenerationRef.current = token;
    pendingRevealRef.current = { token, userId, item: selectedItem };
    setRevealMotion(motion);
    setRevealedItem(null);

    revealTimerRef.current = setTimeout(
      () => completeStarterReveal(token),
      motion === 'reduced'
        ? REDUCED_REVEAL_DURATION_MS
        : STARTER_REVEAL_DURATION_MS + STARTER_REVEAL_FALLBACK_GRACE_MS,
    );
  };

  const choosePaper = (paper: typeof PAPER_TEXTURE_OPTIONS[number]) => {
    if (!userId || isRevealing) return;
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

        {/* Section 1: finite, pressure-free starter reveal */}
        <section className="space-y-4" aria-labelledby="accessory-collection-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="accessory-collection-title" className="text-heading text-foreground">액세서리 컬렉션</h2>
            <span className="text-caption text-muted-foreground">무료</span>
          </div>
          <p className="text-label leading-relaxed text-muted-foreground">
            남은 기본 장식 가운데 하나를 무료로 공개해요. 중복 없이 모두 모을 수 있어요.
          </p>
          {!userId ? (
            <p id="shop-login-help" className="text-caption leading-relaxed text-muted-foreground">
              로그인하면 무료 수집과 종이 적용을 이용할 수 있어요.
            </p>
          ) : null}

          <div
            data-testid="accessory-draw-roulette"
            aria-busy={isRevealing}
            className="flex flex-col items-center justify-center rounded-surface border border-border bg-card/60 p-5 text-center"
          >
            <div className="relative flex h-32 w-32 items-center justify-center">
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[10px] border-x-transparent border-t-foreground"
              />
              <div
                data-testid="accessory-roulette-wheel"
                data-reveal-motion={revealMotion ?? 'idle'}
                aria-hidden="true"
                onAnimationEnd={(event) => {
                  if (event.target !== event.currentTarget || revealMotion !== 'full') return;
                  const token = pendingRevealRef.current?.token;
                  if (token !== undefined) completeStarterReveal(token);
                }}
                className={`relative h-28 w-28 rounded-full border-2 border-dashed border-border bg-muted/30 ${
                  revealMotion === 'full'
                    ? 'starter-reveal-rotating animate-spin [animation-duration:1200ms] [animation-iteration-count:1] [animation-timing-function:cubic-bezier(.2,.8,.3,1)] [animation-fill-mode:forwards]'
                    : revealMotion === 'reduced'
                      ? 'starter-reveal-reduced opacity-60 transition-opacity duration-150'
                      : ''
                }`}
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
                    data-accessory={revealedItem}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card shadow-sm"
                  >
                    <GardenAccessoryArt accessory={revealedItem} className="h-8 w-8" />
                  </span>
                ) : (
                  <Sparkles size={24} className="text-muted-foreground/60" />
                )}
              </span>
            </div>

            {isStarterComplete ? (
              <p className="mt-4 text-label font-semibold text-foreground">
                기본 장식 5종을 모두 모았어요.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={startReveal}
                  disabled={!userId || isRevealing}
                  aria-label="무료 장식 하나 공개하기"
                  aria-describedby={!userId ? 'shop-login-help' : undefined}
                  className="press-response mt-4 min-h-11 rounded-control border border-border bg-foreground px-6 py-2.5 text-label font-semibold text-background disabled:cursor-default disabled:opacity-50"
                >
                  {isRevealing ? '장식 공개 중...' : '무료 장식 공개하기'}
                </button>
                <p className="mt-2 text-caption text-muted-foreground">
                  남은 무료 장식 {availableStarterPool.length}개
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-label font-semibold text-foreground">장식 목록</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="액세서리 목록">
              {STARTER_ACCESSORY_OPTIONS.map((option) => {
                const owned = shopState.ownedAccessories.includes(option.id);
                return (
                  <div
                    key={option.id}
                    data-owned={owned}
                    className="flex min-h-11 items-center gap-2.5 rounded-control border border-border px-3 py-2 text-left"
                  >
                    <GardenAccessoryArt accessory={option.id} className="h-7 w-7" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-label font-semibold text-foreground truncate">{option.label}</span>
                      <span className="block text-caption font-normal text-muted-foreground">
                        {owned ? '보유 중' : '공개 전'}
                      </span>
                    </div>
                    {owned ? <Check size={17} className="shrink-0 pen-icon" color="var(--ink)" aria-hidden="true" /> : null}
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
                  disabled={!userId || active || isRevealing}
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
