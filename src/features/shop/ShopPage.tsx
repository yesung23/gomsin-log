import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileText, Sprout } from 'lucide-react';
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import { localToday } from '@/lib/cycle';
import { GARDEN_ACCESSORY_OPTIONS } from '@/lib/companionGardenLocalState';
import {
  collectCompanionPaper,
  drawDailyAccessory,
  loadCompanionShopState,
  type CollectibleGardenAccessory,
  type CompanionShopState,
} from '@/lib/companionShopLocalState';
import {
  applyPaperTextureAttribute,
  loadPaperTexture,
  PAPER_TEXTURE_OPTIONS,
  savePaperTexture,
  type PaperTexture,
} from '@/lib/paperTexturePreference';

const COLLECTIBLE_ACCESSORY_OPTIONS = GARDEN_ACCESSORY_OPTIONS.filter(
  (option): option is { id: CollectibleGardenAccessory; label: string } => option.id !== 'none',
);

export function ShopPageBody() {
  const navigate = useNavigate();
  const { state } = useStore();
  const userId = state.authenticatedUser?.id || state.profile.id || '';
  const [shopState, setShopState] = useState<CompanionShopState>(() => loadCompanionShopState(userId));
  const [selectedPaper, setSelectedPaper] = useState<PaperTexture>(() => loadPaperTexture(userId));
  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    setShopState(loadCompanionShopState(userId));
    const nextPaper = loadPaperTexture(userId);
    setSelectedPaper(nextPaper);
    applyPaperTextureAttribute(nextPaper);
    setAnnouncement(null);
  }, [userId]);

  const today = localToday();
  const ownedAccessories = COLLECTIBLE_ACCESSORY_OPTIONS.filter(({ id }) => (
    shopState.ownedAccessories.includes(id)
  ));
  const drawComplete = ownedAccessories.length === COLLECTIBLE_ACCESSORY_OPTIONS.length;
  const drawUsedToday = shopState.lastFreeDrawDate === today;
  const drawDisabled = !userId || drawComplete || drawUsedToday;
  const drawLabel = !userId
    ? '로그인 후 이용할 수 있어요'
    : drawComplete
      ? '모든 액세서리를 모았어요'
      : drawUsedToday
        ? '오늘 뽑기 완료'
        : '오늘의 액세서리 무료 뽑기';

  const drawAccessory = () => {
    const result = drawDailyAccessory(userId, localToday());
    setShopState(result.state);

    if (result.status === 'drawn' && result.accessory) {
      const option = GARDEN_ACCESSORY_OPTIONS.find(({ id }) => id === result.accessory);
      setAnnouncement(option ? `액세서리 뽑기 결과: ${option.label}` : '뽑은 액세서리를 확인할 수 없어요.');
      return;
    }
    if (result.status === 'invalid_date') {
      setAnnouncement('오늘 날짜를 확인할 수 없어 뽑지 못했어요.');
      return;
    }
    if (result.status === 'complete') {
      setAnnouncement('모든 액세서리를 모았어요.');
      return;
    }
    setAnnouncement('오늘은 이미 액세서리를 뽑았어요.');
  };

  const choosePaper = (paper: typeof PAPER_TEXTURE_OPTIONS[number]) => {
    const owned = shopState.ownedPapers.includes(paper.id);
    if (!owned) {
      setShopState(collectCompanionPaper(userId, paper.id));
      setAnnouncement(`${paper.label}을 무료로 받았어요.`);
      return;
    }
    if (selectedPaper === paper.id) return;

    savePaperTexture(userId, paper.id);
    applyPaperTextureAttribute(paper.id);
    setSelectedPaper(paper.id);
    setAnnouncement(`${paper.label}을 적용했어요.`);
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
        <section className="space-y-3" aria-labelledby="accessory-draw-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="accessory-draw-title" className="text-heading text-foreground">액세서리 뽑기</h2>
            <span className="text-caption text-muted-foreground">무료</span>
          </div>
          <p className="text-label leading-relaxed text-muted-foreground">
            하루에 한 번, 아직 없는 액세서리 중 하나를 무료로 뽑아요.
          </p>
          <button
            type="button"
            onClick={drawAccessory}
            disabled={drawDisabled}
            aria-label={drawLabel}
            className="press-response min-h-11 w-full rounded-control border border-border px-3 text-label font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {drawLabel}
          </button>
          {announcement ? <p role="status" aria-live="polite" className="text-label text-coral">{announcement}</p> : null}

          <div aria-label="보유 액세서리" className="space-y-2">
            <h3 className="text-label font-semibold text-foreground">내 액세서리</h3>
            {ownedAccessories.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {ownedAccessories.map((option) => (
                  <li key={option.id} className="rounded-control border border-border px-3 py-2 text-label text-foreground">
                    {option.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-muted-foreground">아직 모은 액세서리가 없어요.</p>
            )}
          </div>
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
                  aria-pressed={active}
                  disabled={active}
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
