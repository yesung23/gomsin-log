import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import { ChevronLeft, Plus, Map, Calendar, Plane } from 'lucide-react';
import { formatLocalDate } from '@/lib/utils';
import { saveTripToDB } from '@/lib/trips';
import { toast } from 'sonner';

export function TripsPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [newTrip, setNewTrip] = useState({ title: '', startDate: '', endDate: '' });

  const trips = [...(state.trips || [])].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  const handleSaveTrip = async () => {
    if (!newTrip.title || !newTrip.startDate || !newTrip.endDate) {
      toast.error('모든 정보를 입력해주세요.');
      return;
    }
    if (newTrip.startDate > newTrip.endDate) {
      toast.error('종료일은 시작일 이후여야 합니다.');
      return;
    }

    const saved = await saveTripToDB(
      newTrip, 
      state.profile.couple.coupleId!, 
      state.authenticatedUser!.id
    );

    if (saved) {
      toast.success('여행 계획이 생성되었습니다!');
      setShowModal(false);
      setNewTrip({ title: '', startDate: '', endDate: '' });
      navigate(`/trips/${saved.id}`);
    } else {
      toast.error('오류가 발생했습니다.');
    }
  };

  return (
    <MobileShell>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-gray-100 flex items-center justify-between px-5 h-14">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/us')} className="p-1.5 -ml-1.5 rounded-full hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="font-bold text-gray-900 text-lg flex items-center gap-2">
            <Plane className="w-5 h-5 text-indigo-500" />
            여행 플래너
          </h1>
        </div>
        <button onClick={() => setShowModal(true)} className="p-1.5 -mr-1.5 rounded-full hover:bg-indigo-50 text-indigo-600 transition-colors">
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="p-5 pb-24">
        {trips.length === 0 ? (
          <div className="text-center py-20">
            <div className="bg-indigo-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Map className="w-8 h-8 text-indigo-400" />
            </div>
            <p className="text-gray-500 font-medium mb-1">등록된 여행이 없어요</p>
            <p className="text-gray-400 text-sm mb-6">첫 여행 계획을 세워보세요!</p>
            <button 
              onClick={() => setShowModal(true)}
              className="bg-indigo-500 text-white px-6 py-2.5 rounded-2xl font-bold hover:bg-indigo-600 transition-colors shadow-sm"
            >
              새 여행 만들기
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {trips.map(trip => (
              <div 
                key={trip.id} 
                onClick={() => navigate(`/trips/${trip.id}`)}
                className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer active:scale-[0.98]"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-900 text-lg">{trip.title}</h3>
                  <div className="bg-indigo-50 text-indigo-600 text-xs font-bold px-2.5 py-1 rounded-full">
                    {trip.status === 'completed' ? '다녀옴' : (trip.status === 'ongoing' ? '여행중' : '계획중')}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Calendar className="w-4 h-4" />
                  <span>
                    {formatLocalDate(trip.startDate)} ~ {formatLocalDate(trip.endDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-5">
          <div className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 animate-in slide-in-from-bottom-4">
            <h2 className="text-xl font-bold text-gray-900 mb-6">새 여행 만들기</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">여행 이름</label>
                <input
                  type="text"
                  placeholder="예: 제주도 3박 4일 여행"
                  value={newTrip.title}
                  onChange={(e) => setNewTrip(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-700 mb-1">가는 날</label>
                  <input
                    type="date"
                    value={newTrip.startDate}
                    onChange={(e) => setNewTrip(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-700 mb-1">오는 날</label>
                  <input
                    type="date"
                    value={newTrip.endDate}
                    onChange={(e) => setNewTrip(prev => ({ ...prev, endDate: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 bg-gray-100 text-gray-700 font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveTrip}
                className="flex-1 bg-indigo-500 text-white font-bold py-3.5 rounded-xl hover:bg-indigo-600 transition-colors"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
