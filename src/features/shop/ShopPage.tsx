import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileText, Sprout } from 'lucide-react';
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
  userId: string;
  kind: 'status' | 'alert';
  section: 'accessory' | 'paper';
  message: string;
};

type StarterSelection = {
  userId: string;
  id: StarterAccessoryId;
};

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
  const [starterSelection, setStarterSelection] = useState<StarterSelection | null>(null);
  const collectingAccessoryRef = useRef(false);
  const shopStateRef = useRef(shopState);
  shopStateRef.current = shopState;

  useEffect(() => {
    const nextShopState = loadCompanionShopState(userId);
    shopStateRef.current = nextShopState;
    setShopState(nextShopState);
    const nextPaper = reconcileOwnedPaperTexture(userId, nextShopState.ownedPapers);
    setSelectedPaper(nextPaper);
    applyPaperTextureAttribute(nextPaper);
    setStarterSelection(null);
    setAnnouncement(null);
  }, [userId]);

  const availableStarterPool = getAvailableStarterPool(shopState.ownedAccessories);
  const isStarterComplete = availableStarterPool.length === 0;
  const selectedStarterId = starterSelection?.userId === userId ? starterSelection.id : null;
  const selectedStarter = STARTER_ACCESSORY_OPTIONS.find(({ id }) => id === selectedStarterId) ?? null;
  // Visual list of all accessories (starter items first, then legacy items if any)
  const legacyAccessories = GARDEN_ACCESSORY_OPTIONS.filter(
    (opt) => opt.id !== 'none' && !STARTER_ACCESSORY_IDS.includes(opt.id as StarterAccessoryId),
  );

  const collectSelectedStarter = () => {
    if (!userId || !selectedStarter || collectingAccessoryRef.current) return;
    const accessory = selectedStarter.id as CollectibleGardenAccessory;
    if (shopStateRef.current.ownedAccessories.includes(accessory)) return;

    collectingAccessoryRef.current = true;
    setAnnouncement(null);
    try {
      const nextState = collectCompanionAccessory(userId, accessory);
      if (!nextState.ownedAccessories.includes(accessory)) {
        setAnnouncement({
          userId,
          kind: 'alert',
          section: 'accessory',
          message: '액세서리를 저장하지 못했어요. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요.',
        });
        return;
      }

      shopStateRef.current = nextState;
      setShopState(nextState);
      setStarterSelection(null);
      setAnnouncement({
        userId,
        kind: 'status',
        section: 'accessory',
        message: `${withObjectParticle(selectedStarter.label)} 무료로 받았어요.`,
      });
    } finally {
      collectingAccessoryRef.current = false;
    }
  };

  const choosePaper = (paper: typeof PAPER_TEXTURE_OPTIONS[number]) => {
    if (!userId) return;
    const owned = shopState.ownedPapers.includes(paper.id);
    if (!owned) {
      const next = collectCompanionPaper(userId, paper.id);
      if (!next.ownedPapers.includes(paper.id)) {
        setAnnouncement({
          userId,
          kind: 'alert',
          section: 'paper',
          message: '종이를 저장하지 못했어요. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요.',
        });
        return;
      }
      setShopState(next);
      setAnnouncement({
        userId,
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
      userId,
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

        {/* Section 1: finite, pressure-free starter collection */}
        <section className="space-y-4" aria-labelledby="accessory-collection-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="accessory-collection-title" className="text-heading text-foreground">액세서리 컬렉션</h2>
            <span className="text-caption text-muted-foreground">무료</span>
          </div>
          <p className="text-label leading-relaxed text-muted-foreground">
            마음에 드는 기본 장식을 골라 무료로 받아요.
          </p>
          {!userId ? (
            <p id="shop-login-help" className="text-caption leading-relaxed text-muted-foreground">
              로그인하면 무료 수집과 종이 적용을 이용할 수 있어요.
            </p>
          ) : null}

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2" aria-label="액세서리 목록">
              {STARTER_ACCESSORY_OPTIONS.map((option) => {
                const owned = shopState.ownedAccessories.includes(option.id);
                const selected = selectedStarterId === option.id;
                const actionLabel = owned ? '보유 중' : '선택';
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={`${option.label} ${actionLabel}`}
                    aria-pressed={owned ? undefined : selected}
                    aria-describedby={!userId ? 'shop-login-help' : undefined}
                    disabled={!userId || owned}
                    onClick={() => {
                      setStarterSelection({ userId, id: option.id });
                      setAnnouncement(null);
                    }}
                    className={`press-response flex min-h-[88px] items-center gap-3 rounded-surface border p-3 text-left disabled:cursor-default ${
                      selected ? 'border-foreground bg-card shadow-sm' : 'border-border bg-card/40'
                    } ${!userId ? 'opacity-50' : ''}`}
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-muted/40" aria-hidden="true">
                      <GardenAccessoryArt accessory={option.id} className="h-10 w-10 drop-shadow-sm" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-keep text-label font-semibold leading-snug text-foreground">{option.label}</span>
                      <span className="mt-0.5 block text-caption text-muted-foreground">{actionLabel}</span>
                    </span>
                    {owned ? <Check size={17} className="shrink-0 pen-icon" color="var(--ink)" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>

            {isStarterComplete ? (
              <p className="rounded-control bg-muted/35 px-3 py-3 text-label font-semibold text-foreground">
                기본 장식 5종을 모두 모았어요.
              </p>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={collectSelectedStarter}
                  disabled={!userId || !selectedStarter}
                  aria-label={selectedStarter ? `${selectedStarter.label} 받기` : '장식을 골라 주세요'}
                  aria-describedby={!userId ? 'shop-login-help' : undefined}
                  className="press-response min-h-11 w-full rounded-control bg-foreground px-4 py-2.5 text-label font-semibold text-background disabled:cursor-default disabled:opacity-50"
                >
                  {selectedStarter ? `${selectedStarter.label} 받기` : '장식을 골라 주세요'}
                </button>
                <p className="text-center text-caption text-muted-foreground">
                  남은 무료 장식 {availableStarterPool.length}개
                </p>
              </div>
            )}

            {legacyAccessories.some((option) => (
              shopState.ownedAccessories.includes(option.id as CollectibleGardenAccessory)
            )) ? (
              <div className="space-y-2 pt-1">
                <h3 className="text-caption font-semibold text-muted-foreground">이전에 모은 장식</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
            ) : null}
            </div>

          {announcement?.userId === userId && announcement.section === 'accessory' ? (
            <p
              role={announcement.kind}
              aria-live={announcement.kind === 'alert' ? 'assertive' : 'polite'}
              aria-atomic="true"
              className={announcement.kind === 'alert' ? 'text-label text-destructive' : 'text-label text-foreground'}
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
                  disabled={!userId || active}
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
          {announcement?.userId === userId && announcement.section === 'paper' ? (
            <p
              role={announcement.kind}
              aria-live={announcement.kind === 'alert' ? 'assertive' : 'polite'}
              aria-atomic="true"
              className={announcement.kind === 'alert' ? 'text-label text-destructive' : 'text-label text-foreground'}
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
