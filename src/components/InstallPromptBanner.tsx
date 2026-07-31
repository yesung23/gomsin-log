import { useState, useEffect } from 'react';
import { Share, PlusSquare, X, Smartphone, Download } from 'lucide-react';
import { useStore } from '@/lib/useStore';

export function InstallPromptBanner() {
  const { state, setHasSeenInstallPrompt } = useStore();
  const [showPrompt, setShowPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'other'>('other');

  useEffect(() => {
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
  }, []);

  useEffect(() => {
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
  }, [state.hasSeenInstallPrompt, state.setupComplete, state.records.length]);

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

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-[calc(100%-2.5rem)] max-w-[390px] z-50 bg-card/95 backdrop-blur-xl p-5 rounded-3xl shadow-2xl border border-gray-100 animate-in slide-in-from-bottom-8">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="w-12 h-12 bg-coral/10 rounded-2xl flex items-center justify-center shrink-0">
          <Smartphone size={24} className="text-coral" />
        </div>
        <div className="flex-1 pt-1">
          <h3 className="font-bold text-gray-900 text-sm">곰신로그를 앱으로 설치해보세요!</h3>
          <p className="text-xs text-gray-500 mt-1">
            홈 화면에 추가하면 매번 로그인할 필요 없이 훨씬 빠르고 편하게 쓸 수 있어요.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-gray-400 hover:text-gray-600 p-1 bg-gray-50 rounded-full active:scale-95 transition"
        >
          <X size={16} />
        </button>
      </div>

      {platform === 'ios' && (
        <div className="bg-gray-50 p-3.5 rounded-2xl text-[11px] text-gray-700 font-medium space-y-2 border border-gray-100">
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-coral text-white font-bold flex items-center justify-center shrink-0">1</span>
            <span>하단 사파리 메뉴에서 공유 <Share size={14} className="inline text-blue-500 mx-0.5" /> 버튼을 누르세요.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-coral text-white font-bold flex items-center justify-center shrink-0">2</span>
            <span>목록에서 <b>'홈 화면에 추가'</b> <PlusSquare size={14} className="inline text-gray-600 mx-0.5" /> 를 누르면 끝!</span>
          </div>
        </div>
      )}

      {platform === 'android' && deferredPrompt && (
        <button 
          onClick={handleInstallClick}
          className="w-full mt-2 bg-coral text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <Download size={18} />
          앱 설치하기
        </button>
      )}

      {platform === 'android' && !deferredPrompt && (
        <div className="bg-gray-50 p-3.5 rounded-2xl text-[11px] text-gray-700 font-medium space-y-2 border border-gray-100">
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-coral text-white font-bold flex items-center justify-center shrink-0">1</span>
            <span>크롬 또는 삼성인터넷 메뉴(⋮)를 누르세요.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full bg-coral text-white font-bold flex items-center justify-center shrink-0">2</span>
            <span><b>'홈 화면에 추가'</b> 또는 <b>'앱 설치'</b>를 누르면 끝!</span>
          </div>
        </div>
      )}
    </div>
  );
}
