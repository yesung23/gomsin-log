import { useState } from 'react';
import { PenLine } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import {
  applyHandwritingAttribute,
  loadHandwritingEnabled,
  saveHandwritingEnabled,
} from '@/lib/handwritingPreference';

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
 * 그 사람의 눈과 그 기기의 화면에 관한 값이다. 큰 화면에서는 켜고 작은 폰에서는 끄는 것이
 * 자연스럽고, 계정에 묶으면 그 자연스러움이 사라진다. §19의 허용 목록에도 이런 값이 없다.
 */
export function HandwritingSection({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState(() => loadHandwritingEnabled(userId));

  const toggle = (next: boolean) => {
    setEnabled(next);
    saveHandwritingEnabled(userId, next);
    applyHandwritingAttribute(next);
  };

  return (
    <section className="space-y-2" data-testid="handwriting-preference">
      <h2 className="text-heading text-foreground">보기</h2>
      <Card className="space-y-3">
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
