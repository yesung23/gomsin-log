import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileText } from 'lucide-react';
import { AppBar } from '@/components/ui/AppBar';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import {
  DIARY_PAPERS,
  diaryPaperStyle,
  loadDefaultDiaryPaper,
  saveDefaultDiaryPaper,
  type DiaryPaperId,
} from '@/features/diary/papers';

/**
 * Paper library only.
 *
 * Unvalidated sticker packs/themes/memory-book products stay hidden while the
 * product validates the diary/core-loop. There is no payment or entitlement path.
 */
export function ShopPageBody() {
  const navigate = useNavigate();
  const { state } = useStore();
  const userId = state.authenticatedUser?.id || state.profile.id || '';
  const [selected, setSelected] = useState<DiaryPaperId>(() => loadDefaultDiaryPaper(userId));

  useEffect(() => {
    setSelected(loadDefaultDiaryPaper(userId));
  }, [userId]);

  const choose = (paperId: DiaryPaperId) => {
    setSelected(paperId);
    saveDefaultDiaryPaper(userId, paperId);
  };

  return (
    <div className="min-h-full pb-24">
      <AppBar title="종이 보관함" onBack={() => navigate('/diary')} backLabel="일기장으로 돌아가기" />

      <div className="space-y-4 px-4 py-4">
        <section className="space-y-2" aria-labelledby="paper-library-title">
          <div className="flex items-center gap-2">
            <FileText size={18} className="pen-icon" color="var(--ink)" aria-hidden="true" />
            <h2 id="paper-library-title" className="text-heading text-foreground">내 일기장 종이</h2>
          </div>
          <p className="text-label leading-relaxed text-muted-foreground">
            일기장에 쓸 종이만 골라둘 수 있어요. 새로 여는 페이지의 기본 종이로 이 기기에 저장돼요.
          </p>
        </section>

        <div role="radiogroup" aria-label="기본 종이" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DIARY_PAPERS.map((paper) => {
            const active = selected === paper.id;
            return (
              <button
                key={paper.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={paper.label}
                onClick={() => choose(paper.id)}
                className="press-response min-h-[112px] overflow-hidden rounded-surface border text-left"
                style={{ borderColor: active ? 'var(--ink)' : 'var(--ink-faint)' }}
              >
                <span
                  className="block h-16 border-b"
                  aria-hidden="true"
                  style={{ ...diaryPaperStyle(paper.id), borderColor: 'var(--ink-faint)' }}
                />
                <span className="flex min-h-11 items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-semibold text-foreground">{paper.label}</span>
                    <span className="block text-caption leading-relaxed text-muted-foreground">{paper.description}</span>
                  </span>
                  {active ? <Check size={17} className="shrink-0 pen-icon" color="var(--ink)" aria-hidden="true" /> : null}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-caption leading-relaxed text-muted-foreground">
          기존 무료 스티커는 일기장에서 그대로 쓸 수 있어요. 다른 상품과 Book Studio는 지금은 보여주지 않아요.
        </p>
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
