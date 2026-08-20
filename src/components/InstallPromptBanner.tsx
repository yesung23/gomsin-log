import { useState, useEffect } from 'react';
import { Share, PlusSquare, X, Smartphone, Download } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { Button } from '@/components/ui/Button';
import { isNativePlatform } from '@/lib/platform';

/**
 * "Install this app" prompt. WEB ONLY.
 *
 * Inside the Capacitor WebView none of the three web signals rules this banner
 * out: `androidScheme: 'https'` means `display-mode` is not `standalone`,
 * `beforeinstallprompt` never fires, and the UA still says Android or iOS. So the
 * UA branch rendered a banner telling the user to add the app to their home
 * screen while they were already inside the installed native app -- with
 * instructions naming Chrome's ⋮ menu or Safari's share sheet, neither of which
 * exists there. `main.tsx` already gates the service worker on
 * `isNativePlatform()`; this component was the oversight.
 */
export function InstallPromptBanner() {
  const { state, setHasSeenInstallPrompt } = useStore();
  const [showPrompt, setShowPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'other'>('other');
  // Read once: the platform cannot change for the lifetime of the process, and
  // this must be false-y on web before any of the effects below run.
  const [isNative] = useState(() => isNativePlatform());

  useEffect(() => {
    if (isNative) return;
    // Determine Platform
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(navigator.userAgent);
    
    if (isIOS) setPlatform('ios');
    else if (isAndroid) setPlatform('android');

    // Handle standard Android install prompt
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, [isNative]);

  useEffect(() => {
    // 0. Never prompt to install the app from inside the installed app.
    if (isNative) return;

    // 1. Check if running in Standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (isStandalone) return;

    // 2. Check if user already dismissed or hasn't hit the threshold
    if (state.hasSeenInstallPrompt) return;
    
    // Threshold: show after they've added at least 1 record OR if they've been using it for a while (e.g. 1st visit after setup)
    if (state.setupComplete && state.records.length > 0) {
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isNative, state.hasSeenInstallPrompt, state.setupComplete, state.records.length]);

  const handleDismiss = () => {
    setShowPrompt(false);
    setHasSeenInstallPrompt(true);
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      handleDismiss();
    }
  };

  // Belt and braces: the effects above already refuse to arm the banner on a
  // native platform, and this makes it unrenderable regardless of how it got set.
  if (isNative || !showPrompt) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-[calc(100%-2.5rem)] max-w-[390px] z-50 bg-card/95 backdrop-blur-xl p-5 rounded-surface shadow-2xl border border-border animate-in slide-in-from-bottom-8">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="w-12 h-12 bg-coral/10 rounded-2xl flex items-center justify-center shrink-0">
          <Smartphone size={24} className="text-coral" />
        </div>
        <div className="flex-1 pt-1">
          <h3 className="text-heading text-card-foreground">곰신로그를 앱으로 설치해보세요!</h3>
          <p className="text-caption text-muted-foreground mt-1">
            홈 화면에 추가하면 매번 로그인할 필요 없이 훨씬 빠르고 편하게 쓸 수 있어요.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground p-1 bg-muted rounded-full active:scale-95 transition"
        >
          <X size={16} />
        </button>
      </div>

      {platform === 'ios' && (
        <div className="bg-muted p-3.5 rounded-2xl text-caption text-foreground font-medium space-y-2 border border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-coral-strong text-coral-strong-foreground font-bold flex items-center justify-center shrink-0">1</span>
            <span>하단 사파리 메뉴에서 공유 <Share size={14} className="inline text-info mx-0.5" /> 버튼을 누르세요.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-coral-strong text-coral-strong-foreground font-bold flex items-center justify-center shrink-0">2</span>
            <span>목록에서 <b>'홈 화면에 추가'</b> <PlusSquare size={14} className="inline text-muted-foreground mx-0.5" /> 를 누르면 끝!</span>
          </div>
        </div>
      )}

      {platform === 'android' && deferredPrompt && (
        <Button variant="primary" full className="mt-2"
                onClick={handleInstallClick}>
          <Download size={18} />
          앱 설치하기
        </Button>
      )}

      {platform === 'android' && !deferredPrompt && (
        <div className="bg-muted p-3.5 rounded-2xl text-caption text-foreground font-medium space-y-2 border border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-coral-strong text-coral-strong-foreground font-bold flex items-center justify-center shrink-0">1</span>
            <span>크롬 또는 삼성인터넷 메뉴(⋮)를 누르세요.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-coral-strong text-coral-strong-foreground font-bold flex items-center justify-center shrink-0">2</span>
            <span><b>'홈 화면에 추가'</b> 또는 <b>'앱 설치'</b>를 누르면 끝!</span>
          </div>
        </div>
      )}
    </div>
  );
}
