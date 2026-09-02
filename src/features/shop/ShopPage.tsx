import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileText, Sprout } from 'lucide-react';
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import { GARDEN_ACCESSORY_OPTIONS } from '@/lib/companionGardenLocalState';
import {
  collectCompanionAccessory,
  collectCompanionPaper,
  loadCompanionShopState,
  type CollectibleGardenAccessory,
  type CompanionShopState,
} from '@/lib/companionShopLocalState';
import {
  applyPaperTextureAttribute,
  PAPER_TEXTURE_OPTIONS,
  reconcileOwnedPaperTexture,
  savePaperTexture,
  type PaperTexture,
} from '@/lib/paperTexturePreference';

const COLLECTIBLE_ACCESSORY_OPTIONS = GARDEN_ACCESSORY_OPTIONS.filter(
  (option): option is { id: CollectibleGardenAccessory; label: string } => option.id !== 'none',
);

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
  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    const nextShopState = loadCompanionShopState(userId);
    setShopState(nextShopState);
    const nextPaper = reconcileOwnedPaperTexture(userId, nextShopState.ownedPapers);
    setSelectedPaper(nextPaper);
    applyPaperTextureAttribute(nextPaper);
    setAnnouncement(null);
  }, [userId]);

  const collectAccessory = (option: typeof COLLECTIBLE_ACCESSORY_OPTIONS[number]) => {
    if (!userId || shopState.ownedAccessories.includes(option.id)) return;
    setAnnouncement(null);
    setShopState(collectCompanionAccessory(userId, option.id));
    setAnnouncement(`${withObjectParticle(option.label)} 무료로 받았어요.`);
  };

  const choosePaper = (paper: typeof PAPER_TEXTURE_OPTIONS[number]) => {
    if (!userId) return;
    const owned = shopState.ownedPapers.includes(paper.id);
    if (!owned) {
      setShopState(collectCompanionPaper(userId, paper.id));
      setAnnouncement(`${withObjectParticle(paper.label)} 무료로 받았어요.`);
      return;
    }
    if (selectedPaper === paper.id) return;

    savePaperTexture(userId, paper.id);
    applyPaperTextureAttribute(paper.id);
    setSelectedPaper(paper.id);
    setAnnouncement(`${withObjectParticle(paper.label)} 적용했어요.`);
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

      <div className="space-y-4 px-4 py-4">
        <p className="text-caption leading-relaxed text-muted-foreground">
          지금 상점은 모두 무료이며 결제 기능이 없어요.
        </p>
        <section className="space-y-3" aria-labelledby="accessory-collection-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="accessory-collection-title" className="text-heading text-foreground">액세서리 컬렉션</h2>
            <span className="text-caption text-muted-foreground">무료</span>
          </div>
          <p className="text-label leading-relaxed text-muted-foreground">
            원하는 액세서리를 언제든 골라 무료로 받아요.
          </p>
          {!userId ? (
            <p id="shop-login-help" className="text-caption leading-relaxed text-muted-foreground">
              로그인하면 무료 수집과 종이 적용을 이용할 수 있어요.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3" aria-label="액세서리 선택">
            {COLLECTIBLE_ACCESSORY_OPTIONS.map((option) => {
              const owned = shopState.ownedAccessories.includes(option.id);
              const actionLabel = owned ? '보유 중' : '무료로 받기';

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => collectAccessory(option)}
                  disabled={!userId || owned}
                  aria-label={`${option.label} ${actionLabel}`}
                  aria-describedby={!userId ? 'shop-login-help' : undefined}
                  className="press-response min-h-11 rounded-control border border-border px-3 py-2 text-left text-label font-semibold text-foreground disabled:cursor-default disabled:opacity-60"
                >
                  <span className="block">{option.label}</span>
                  <span className="mt-1 block text-caption font-normal text-muted-foreground">{actionLabel}</span>
                </button>
              );
            })}
          </div>
          {announcement ? <p role="status" aria-live="polite" className="text-label text-coral">{announcement}</p> : null}
        </section>

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
