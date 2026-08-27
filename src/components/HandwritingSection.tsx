import { useEffect, useState } from 'react';
import { PenLine } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import {
  applyHandwritingAttribute,
  loadHandwritingEnabled,
  saveHandwritingEnabled,
} from '@/lib/handwritingPreference';
import {
  applyPaperTextureAttribute,
  loadPaperTexture,
  savePaperTexture,
  type PaperTexture,
} from '@/lib/paperTexturePreference';

/**
 * 손글씨로 볼지 고르는 곳.
 *
 * ## 이것은 취향 설정이 아니다
 *
 * 손글씨는 저시력·난독·고령 사용자에게 벽이 될 수 있다. 그래서 문구가 "예쁘게 보기"가
 * 아니라 "읽기 어려우면 끄세요"다. 접근성 장치를 꾸밈처럼 적어 두면 필요한 사람이
 * 찾지 않는다.
 *
 * ## 즉시 반영하는 이유
 *
 * 서체 설정은 눈으로 확인하고 정하는 값이다. 저장 후 새로고침해야 보이면 사용자는
 * 자기가 무엇을 골랐는지 모른 채로 화면을 떠난다. `applyHandwritingAttribute`가
 * `<html>`에 바로 반영하므로 토글하는 순간 화면이 바뀐다.
 *
 * ## 서버로 보내지 않는다
 *
 * 그 사람의 눈과 그 기기의 화면에 관한 값이다. 서버 프로필에는 넣지 않고, 같은 기기에서
 * 계정이 바뀔 때 서로의 선택이 섞이지 않도록 계정 ID가 붙은 로컬 키로만 보관한다.
 * §19의 서버 수집 허용 목록에도 이런 값이 없다.
 */
export function HandwritingSection({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState(() => loadHandwritingEnabled(userId));
  const [paper, setPaper] = useState<PaperTexture>(() => loadPaperTexture(userId));

  useEffect(() => {
    setEnabled(loadHandwritingEnabled(userId));
    setPaper(loadPaperTexture(userId));
  }, [userId]);

  const toggle = (next: boolean) => {
    setEnabled(next);
    saveHandwritingEnabled(userId, next);
    applyHandwritingAttribute(next);
  };

  const choosePaper = (next: PaperTexture) => {
    setPaper(next);
    savePaperTexture(userId, next);
    applyPaperTextureAttribute(next);
  };

  return (
    <section className="space-y-2" data-testid="handwriting-preference">
      <h2 className="text-heading text-foreground">보기</h2>
      <Card className="space-y-3">
        <div>
          <p className="text-label font-semibold text-foreground">종이 바탕</p>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-control bg-muted p-1">
            <button
              type="button"
              onClick={() => choosePaper('plain')}
              aria-pressed={paper === 'plain'}
              className={`press-response min-h-11 rounded-control text-label font-semibold ${paper === 'plain' ? 'bg-card text-foreground' : 'text-muted-foreground'}`}
            >
              무지 종이
            </button>
            <button
              type="button"
              onClick={() => choosePaper('ruled')}
              aria-pressed={paper === 'ruled'}
              className={`press-response min-h-11 rounded-control text-label font-semibold ${paper === 'ruled' ? 'bg-card text-foreground' : 'text-muted-foreground'}`}
            >
              줄 종이
            </button>
          </div>
          <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
            무지 종이는 가로줄을 없애 글과 사진에 더 집중할 수 있어요.
          </p>
        </div>
        <div className="ink-rule" aria-hidden="true" />
        <label className="flex items-center justify-between gap-3 min-h-11">
          <span className="flex items-center gap-2 text-label font-semibold text-foreground">
            <PenLine size={16} className="text-coral" />
            손글씨로 보기
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => toggle(event.target.checked)}
            className="h-5 w-5 accent-coral"
          />
        </label>
        <p className="text-caption text-muted-foreground leading-relaxed">
          둘이 남긴 글이 손글씨로 보여요. 읽기 어려우면 끄세요 — 끄면 모든 글이 기본 서체로
          바뀌고, 시간·버튼·안내 문구는 원래부터 기본 서체예요.
        </p>
      </Card>
    </section>
  );
}
