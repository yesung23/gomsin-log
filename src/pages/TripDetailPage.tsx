import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '@/lib/useStore';
import { MobileShell } from '@/components/MobileShell';
import { 
  ArrowLeft, Calendar, MapPin, Plus, Trash2, ExternalLink, 
  CheckSquare, Square, PenTool, CheckCircle2 
} from 'lucide-react';
import { 
  fetchTripItemsFromDB, saveTripItemToDB, deleteTripItemFromDB, 
  deleteTripFromDB, fetchTripChecklistsFromDB, saveTripChecklistToDB, 
  toggleTripChecklistInDB, deleteTripChecklistFromDB 
} from '@/lib/trips';
import { TripItem, TripChecklist } from '@/types';
import { formatLocalDate, daysBetweenLocal, toLocalDateString } from '@/lib/utils';
import { toast } from 'sonner';

export function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state } = useStore();

  const trip = useMemo(() => {
    return state.trips.find(t => t.id === id);
  }, [state.trips, id]);

  const [items, setItems] = useState<TripItem[]>([]);
  const [checklists, setChecklists] = useState<TripChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'schedule' | 'checklist'>('schedule');
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  
  const [showItemModal, setShowItemModal] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', category: 'activity' as const, memo: '', url: '' });
  const [newChecklistName, setNewChecklistName] = useState('');

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [fetchedItems, fetchedChecklists] = await Promise.all([
      fetchTripItemsFromDB(id),
      fetchTripChecklistsFromDB(id),
    ]);
    setItems(fetchedItems);
    setChecklists(fetchedChecklists);
    setLoading(false);
  }, [id]);

  // Calculate days
  const totalDays = trip ? daysBetweenLocal(trip.startDate, trip.endDate) + 1 : 0;
  const daysList = useMemo(() => {
    if (!trip) return [];
    const list = [];
    const start = new Date(trip.startDate);
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      list.push({
        index: i,
        label: `${i + 1}일차`,
        dateStr: toLocalDateString(d)
      });
    }
    return list;
  }, [trip, totalDays]);

  const currentDayItems = useMemo(() => {
    if (!daysList[activeDayIndex]) return [];
    const currentDate = daysList[activeDayIndex].dateStr;
    return items.filter(it => it.itemDate === currentDate);
  }, [items, daysList, activeDayIndex]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!trip) {
    return (
      <MobileShell>
        <div className="p-5 text-center mt-20 text-muted-foreground">여행을 찾을 수 없습니다.</div>
      </MobileShell>
    );
  }

  const handleDeleteTrip = async () => {
    if (confirm('이 여행 계획을 삭제하시겠습니까? 하위 일정 및 준비물도 함께 삭제됩니다.')) {
      await deleteTripFromDB(trip.id);
      toast.success('여행이 삭제되었습니다.');
      navigate('/trips');
    }
  };

  const handleSaveItem = async () => {
    if (!newItem.title.trim()) {
      toast.error('장소 또는 제목을 입력해주세요.');
      return;
    }
    const currentDate = daysList[activeDayIndex].dateStr;
    const saved = await saveTripItemToDB({
      tripId: trip.id,
      itemDate: currentDate,
      title: newItem.title.trim(),
      category: newItem.category,
      memo: newItem.memo.trim() || undefined,
      url: newItem.url.trim() || undefined,
      sortOrder: currentDayItems.length
    });

    if (saved) {
      setItems(prev => [...prev, saved]);
      setShowItemModal(false);
      setNewItem({ title: '', category: 'activity', memo: '', url: '' });
      toast.success('일정이 추가되었습니다.');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const ok = await deleteTripItemFromDB(itemId);
    if (ok) {
      setItems(prev => prev.filter(i => i.id !== itemId));
      toast.success('일정이 삭제되었습니다.');
    }
  };

  const handleAddChecklist = async () => {
    if (!newChecklistName.trim()) return;
    const saved = await saveTripChecklistToDB(trip.id, newChecklistName.trim());
    if (saved) {
      setChecklists(prev => [...prev, saved]);
      setNewChecklistName('');
      toast.success('준비물이 추가되었습니다.');
    }
  };

  const handleToggleChecklist = async (item: TripChecklist) => {
    const nextVal = !item.completed;
    setChecklists(prev => prev.map(c => c.id === item.id ? { ...c, completed: nextVal } : c));
    await toggleTripChecklistInDB(item.id, nextVal);
  };

  const handleDeleteChecklist = async (checklistId: string) => {
    const ok = await deleteTripChecklistFromDB(checklistId);
    if (ok) {
      setChecklists(prev => prev.filter(c => c.id !== checklistId));
    }
  };

  return (
    <MobileShell>
      <div className="pb-28">
        {/* Top Header */}
        <div className="bg-card border-b border-border px-5 py-4 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/trips')} className="p-1 -ml-1 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="font-bold text-foreground text-lg truncate max-w-[200px]">{trip.title}</h1>
          </div>
          <button onClick={handleDeleteTrip} className="p-1.5 -mr-1.5 rounded-full hover:bg-red-50 text-red-500 transition-colors">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>

        {/* Date Info & Record Entry Banner */}
        <div className="bg-coral/10 border-b border-coral/20 px-5 py-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-coral font-bold text-sm">
              <Calendar className="w-4 h-4" />
              <span>{formatLocalDate(trip.startDate)} ~ {formatLocalDate(trip.endDate)}</span>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-coral text-white">
              {totalDays}일간의 여정
            </span>
          </div>

          {/* Post-Trip Log CTA */}
          <button
            onClick={() => navigate('/record')}
            className="w-full py-2.5 px-3 rounded-2xl bg-card border border-coral/30 text-coral font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition"
          >
            <PenTool size={14} />
            <span>이 여행의 사진과 추억 기록 남기기 📝</span>
          </button>
        </div>

        {/* Main Section Tabs (Schedule vs Checklist) */}
        <div className="flex border-b border-border bg-card">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition ${
              activeTab === 'schedule' ? 'border-coral text-coral' : 'border-transparent text-muted-foreground'
            }`}
          >
            일정 동선 ({items.length})
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition ${
              activeTab === 'checklist' ? 'border-coral text-coral' : 'border-transparent text-muted-foreground'
            }`}
          >
            준비물 체크리스트 ({checklists.length})
          </button>
        </div>

        {activeTab === 'schedule' ? (
          <>
            {/* Day Tabs */}
            <div className="bg-card border-b border-border px-2 flex overflow-x-auto no-scrollbar">
              {daysList.map((day, i) => (
                <button
                  key={i}
                  onClick={() => setActiveDayIndex(i)}
                  className={`px-4 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                    activeDayIndex === i 
                      ? 'border-navy text-navy font-black' 
                      : 'border-transparent text-muted-foreground'
                  }`}
                >
                  {day.label} <span className="text-[11px] font-normal">({day.dateStr.slice(5)})</span>
                </button>
              ))}
            </div>

            {/* Items List */}
            <div className="p-5">
              {loading ? (
                <div className="text-center py-10 text-xs text-muted-foreground">로딩 중...</div>
              ) : currentDayItems.length === 0 ? (
                <div className="bg-card border border-dashed border-border/80 rounded-2xl p-8 text-center space-y-2">
                  <MapPin className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-xs font-bold text-foreground">{daysList[activeDayIndex]?.label}의 첫 방문 장소를 추가해보세요.</p>
                </div>
              ) : (
                <div className="space-y-3 relative before:absolute before:left-4 before:top-4 before:bottom-4 before:w-0.5 before:bg-border">
                  {currentDayItems.map((item, idx) => (
                    <div key={item.id} className="relative pl-9">
                      <div className="absolute left-2 top-3 -translate-x-1/2 w-4 h-4 rounded-full bg-coral border-2 border-background flex items-center justify-center">
                        <span className="text-[9px] text-white font-bold">{idx + 1}</span>
                      </div>
                      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm flex items-start justify-between">
                        <div className="space-y-1">
                          <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                            {item.title}
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noreferrer" className="text-coral hover:underline">
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </h4>
                          {item.memo && <p className="text-xs text-muted-foreground leading-relaxed">{item.memo}</p>}
                        </div>
                        <button onClick={() => handleDeleteItem(item.id)} className="text-muted-foreground hover:text-destructive p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* FAB Add Item */}
            <button 
              onClick={() => setShowItemModal(true)}
              className="fixed bottom-6 right-5 w-14 h-14 bg-coral rounded-full flex items-center justify-center text-white shadow-lg hover:bg-coral/90 transition-all active:scale-95 z-40"
            >
              <Plus className="w-7 h-7" />
            </button>
          </>
        ) : (
          /* Checklist Section */
          <div className="p-5 space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="새 준비물 추가 (예: 기차표, 돗자리, 카고바지)"
                value={newChecklistName}
                onChange={(e) => setNewChecklistName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddChecklist()}
                className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-xs outline-none focus:border-coral"
              />
              <button
                onClick={handleAddChecklist}
                className="px-4 bg-coral text-white font-bold text-xs rounded-xl shadow-sm active:scale-95"
              >
                추가
              </button>
            </div>
            <div className="space-y-2">
              {checklists.map((item) => (
                <div
                  key={item.id}
                  className="bg-card border border-border p-3.5 rounded-2xl flex items-center justify-between text-xs font-semibold"
                >
                  <button
                    onClick={() => handleToggleChecklist(item)}
                    className="flex items-center gap-2 text-foreground text-left"
                  >
                    {item.completed ? (
                      <CheckSquare className="w-5 h-5 text-coral" />
                    ) : (
                      <Square className="w-5 h-5 text-muted-foreground" />
                    )}
                    <span className={item.completed ? 'line-through text-muted-foreground' : ''}>
                      {item.itemName}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDeleteChecklist(item.id)}
                    className="text-muted-foreground hover:text-destructive p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {checklists.length === 0 && (
                <div className="bg-card border border-dashed border-border/80 rounded-2xl p-6 text-center text-xs text-muted-foreground">
                  함께 준비할 짐이나 할 일을 작성해보세요.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Add Item Modal */}
        {showItemModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-5">
            <div className="bg-card border border-border w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 animate-in slide-in-from-bottom-4">
              <h2 className="text-lg font-bold text-foreground mb-4">{daysList[activeDayIndex]?.label} 일정 추가</h2>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-muted-foreground mb-1">상호명 또는 장소명 *</label>
                  <input
                    type="text"
                    placeholder="예: 오설록 티 뮤지엄"
                    value={newItem.title}
                    onChange={(e) => setNewItem(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 outline-none focus:border-coral"
                  />
                </div>
                <div>
                  <label className="block font-bold text-muted-foreground mb-1">링크 (선택)</label>
                  <input
                    type="url"
                    placeholder="https://"
                    value={newItem.url}
                    onChange={(e) => setNewItem(prev => ({ ...prev, url: e.target.value }))}
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 outline-none focus:border-coral"
                  />
                </div>
                <div>
                  <label className="block font-bold text-muted-foreground mb-1">간단 메모 (선택)</label>
                  <textarea
                    placeholder="예: 녹차 아이스크림 꼭 먹기"
                    value={newItem.memo}
                    onChange={(e) => setNewItem(prev => ({ ...prev, memo: e.target.value }))}
                    rows={2}
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 outline-none focus:border-coral resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowItemModal(false)}
                  className="flex-1 bg-muted text-foreground font-bold py-3 rounded-xl hover:bg-muted/80 text-xs"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveItem}
                  className="flex-1 bg-coral text-white font-bold py-3 rounded-xl hover:bg-coral/90 text-xs shadow-sm"
                >
                  추가
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
