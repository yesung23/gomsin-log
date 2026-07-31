import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronLeft, LoaderCircle, Map, Plane, Plus, RefreshCw, ShieldAlert, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { MobileShell } from '@/components/MobileShell';
import { fetchTripsResultFromDB, saveTripToDB, validateTripDraft } from '@/lib/trips';
import { useStore } from '@/lib/useStore';
import { formatLocalDate } from '@/lib/utils';
import type { Trip } from '@/types';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'disconnected';

export function TripsPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [showModal, setShowModal] = useState(false);
  const [newTrip, setNewTrip] = useState({ title: '', startDate: '', endDate: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const userId = state.authenticatedUser?.id;
  const coupleId = state.profile.couple.coupleId;
  const activeCouple = Boolean(
    userId && coupleId && state.profile.couple.connected && state.profile.couple.status === 'active',
  );

  const loadTrips = useCallback(async () => {
    if (!userId) {
      setLoadState('forbidden');
      return;
    }
    if (!activeCouple || !coupleId) {
      setLoadState('disconnected');
      return;
    }
    setLoadState('loading');
    try {
      const result = await fetchTripsResultFromDB(coupleId);
      if (!result.ok) {
        setLoadState(result.reason === 'forbidden' ? 'forbidden' : 'error');
        return;
      }
      setTrips(result.trips);
      setLoadState('ready');
    } catch (error) {
      console.error('Failed to load trips:', error);
      setLoadState('error');
    }
  }, [activeCouple, coupleId, userId]);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  const openCreate = () => {
    if (loadState !== 'ready' || !activeCouple) return;
    setFormError(null);
    setShowModal(true);
  };

  const handleSaveTrip = async () => {
    if (isCreating) return;
    const validationError = validateTripDraft(newTrip);
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }
    if (!userId || !coupleId || !activeCouple) {
      setFormError('연결된 우리 공간에서만 여행을 만들 수 있어요.');
      return;
    }

    setIsCreating(true);
    setFormError(null);
    try {
      const saved = await saveTripToDB({
        title: newTrip.title.trim(),
        startDate: newTrip.startDate,
        endDate: newTrip.endDate,
      }, coupleId, userId);
      if (!saved) {
        const message = '여행을 만들지 못했어요. 입력 내용은 유지되니 다시 시도해 주세요.';
        setFormError(message);
        toast.error(message);
        return;
      }
      // Do not wait for realtime before exposing the confirmed row locally.
      setTrips((current) => [...current.filter((trip) => trip.id !== saved.id), saved]);
      setShowModal(false);
      setNewTrip({ title: '', startDate: '', endDate: '' });
      toast.success('여행 계획이 생성되었습니다!');
      navigate(`/trips/${saved.id}`);
    } catch {
      const message = '여행을 만들지 못했어요. 인터넷 연결을 확인해 주세요.';
      setFormError(message);
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const sortedTrips = [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const statePanel = (() => {
    if (loadState === 'loading') {
      return <div className="py-24 flex justify-center"><LoaderCircle className="w-7 h-7 animate-spin text-indigo-500" aria-label="여행 불러오는 중" /></div>;
    }
    if (loadState === 'error') {
      return (
        <div className="text-center py-20 space-y-4">
          <RefreshCw className="w-10 h-10 text-muted-foreground mx-auto" />
          <div><p className="font-bold">여행을 불러오지 못했어요</p><p className="text-sm text-muted-foreground mt-1">인터넷 연결을 확인하고 다시 시도해 주세요.</p></div>
          <button onClick={() => void loadTrips()} className="px-5 py-2.5 rounded-xl bg-indigo-500 text-white font-bold text-sm">다시 시도</button>
        </div>
      );
    }
    if (loadState === 'forbidden') {
      return (
        <div className="text-center py-20 space-y-3">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="font-bold">여행 플래너에 접근할 수 없어요</p>
          <p className="text-sm text-muted-foreground">로그인 상태와 우리 공간 권한을 확인해 주세요.</p>
        </div>
      );
    }
    if (loadState === 'disconnected') {
      const pending = state.profile.couple.status === 'pending';
      return (
        <div className="text-center py-20 space-y-3">
          <Unlink className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="font-bold">{pending ? '상대방의 연결을 기다리고 있어요' : '우리 공간 연결이 필요해요'}</p>
          <p className="text-sm text-muted-foreground">두 사람이 연결된 뒤 함께 여행을 계획할 수 있어요.</p>
          <button onClick={() => navigate('/us')} className="px-5 py-2.5 rounded-xl bg-muted font-bold text-sm">우리 공간으로</button>
        </div>
      );
    }
    if (sortedTrips.length === 0) {
      return (
        <div className="text-center py-20">
          <div className="bg-indigo-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Map className="w-8 h-8 text-indigo-400" /></div>
          <p className="text-gray-500 font-medium mb-1">등록된 여행이 없어요</p>
          <p className="text-gray-400 text-sm mb-6">첫 여행 계획을 세워보세요!</p>
          <button onClick={openCreate} className="bg-indigo-500 text-white px-6 py-2.5 rounded-2xl font-bold shadow-sm">새 여행 만들기</button>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {sortedTrips.map((trip) => (
          <button key={trip.id} type="button" onClick={() => navigate(`/trips/${trip.id}`)} className="w-full text-left bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow active:scale-[0.98]">
            <div className="flex items-center justify-between mb-3 gap-3">
              <h3 className="font-bold text-gray-900 text-lg truncate">{trip.title}</h3>
              <div className="shrink-0 bg-indigo-50 text-indigo-600 text-xs font-bold px-2.5 py-1 rounded-full">
                {trip.status === 'completed' ? '다녀옴' : trip.status === 'ongoing' ? '여행중' : '계획중'}
              </div>
            </div>
            <div className="flex items-center gap-2 text-gray-500 text-sm"><Calendar className="w-4 h-4" /><span>{formatLocalDate(trip.startDate)} ~ {formatLocalDate(trip.endDate)}</span></div>
          </button>
        ))}
      </div>
    );
  })();

  return (
    <MobileShell>
      <div className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-gray-100 flex items-center justify-between px-5 h-14">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/us')} className="p-1.5 -ml-1.5 rounded-full hover:bg-gray-100" aria-label="뒤로"><ChevronLeft className="w-5 h-5 text-gray-700" /></button>
          <h1 className="font-bold text-gray-900 text-lg flex items-center gap-2"><Plane className="w-5 h-5 text-indigo-500" />여행 플래너</h1>
        </div>
        <button onClick={openCreate} disabled={loadState !== 'ready'} className="p-1.5 -mr-1.5 rounded-full hover:bg-indigo-50 text-indigo-600 disabled:opacity-30" aria-label="새 여행"><Plus className="w-5 h-5" /></button>
      </div>
      <div className="p-5 pb-24">{statePanel}</div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-5">
          <div className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 animate-in slide-in-from-bottom-4">
            <h2 className="text-xl font-bold text-gray-900 mb-6">새 여행 만들기</h2>
            <div className="space-y-4">
              <label className="block text-sm font-bold text-gray-700">여행 이름<input type="text" value={newTrip.title} onChange={(event) => setNewTrip((prev) => ({ ...prev, title: event.target.value }))} placeholder="예: 제주도 3박 4일 여행" className="mt-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500" /></label>
              <div className="flex gap-3">
                <label className="flex-1 text-sm font-bold text-gray-700">가는 날<input type="date" value={newTrip.startDate} onChange={(event) => setNewTrip((prev) => ({ ...prev, startDate: event.target.value }))} className="mt-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 outline-none focus:border-indigo-500" /></label>
                <label className="flex-1 text-sm font-bold text-gray-700">오는 날<input type="date" min={newTrip.startDate || undefined} value={newTrip.endDate} onChange={(event) => setNewTrip((prev) => ({ ...prev, endDate: event.target.value }))} className="mt-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 outline-none focus:border-indigo-500" /></label>
              </div>
              {formError && <p className="text-sm text-red-600" role="alert">{formError}</p>}
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowModal(false)} disabled={isCreating} className="flex-1 bg-gray-100 text-gray-700 font-bold py-3.5 rounded-xl disabled:opacity-50">취소</button>
              <button onClick={() => void handleSaveTrip()} disabled={isCreating} className="flex-1 bg-indigo-500 text-white font-bold py-3.5 rounded-xl disabled:opacity-50">{isCreating ? '만드는 중...' : '만들기'}</button>
            </div>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
