import { useState, useEffect } from 'react';
import { Share, PlusSquare, X, Smartphone } from 'lucide-react';

const DISMISS_KEY = 'gomsinlog.pwa_install_dismissed';

export function InstallPromptBanner() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // 1. Check if running in Standalone mode (already installed & opened as web app)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;

    if (isStandalone) {
      return; // Never show if running in standalone mode
    }

    // 2. Check if iOS environment (iPhone, iPad, iPod)
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (!isIOS) {
      return; // Only show iOS-specific Safari prompt on iOS devices
    }

    // 3. Check if user already dismissed
    const isDismissed = localStorage.getItem(DISMISS_KEY);
    if (isDismissed) {
      return;
    }

    // Delay 1.5 seconds after page load for non-intrusive experience
    const timer = setTimeout(() => {
      setShowPrompt(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem(DISMISS_KEY, 'true');
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[398px] z-40 bg-navy/95 backdrop-blur-md text-white p-4 rounded-2xl shadow-xl border border-white/10 animate-in slide-in-from-bottom-5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 font-bold text-sm text-coral">
          <Smartphone size={18} />
          <span>홈 화면에 추가하여 앱처럼 사용하기</span>
        </div>
        <button
          onClick={handleDismiss}
          className="text-white/70 hover:text-white p-1.5 rounded-full min-h-[36px] min-w-[36px] flex items-center justify-center -mr-1 -mt-1 active:scale-95 transition"
          aria-label="안내 닫기"
        >
          <X size={18} />
        </button>
      </div>

      <p className="text-xs text-white/80 leading-relaxed mb-3">
        iPhone Safari에서 홈 화면에 추가하면 전용 독립 앱으로 편하게 사용하실 수 있어요.
      </p>

      <div className="space-y-1.5 bg-white/10 p-2.5 rounded-xl text-[11px] text-white/90 font-medium">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-coral/30 text-coral font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
          <span>하단 메뉴의 공유 버튼 <Share size={13} className="inline text-coral mx-0.5" /> 을 눌러주세요</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-coral/30 text-coral font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
          <span>목록에서 <b>'홈 화면에 추가'</b> <PlusSquare size={13} className="inline text-coral mx-0.5" /> 를 선택하세요</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-coral/30 text-coral font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
          <span>우측 상단 <b>'추가'</b>를 누르면 설치가 완료됩니다</span>
        </div>
      </div>
    </div>
  );
}
