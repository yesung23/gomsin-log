import React from 'react';
import { useStore } from '@/lib/store';
import { MapPin, Briefcase, Gift, CalendarIcon, Info, Plane, Plus } from 'lucide-react';
import { daysBetweenLocal, localToday, formatLocalDate, toLocalDateString } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

export function UpcomingScheduleWidget() {
  const { state } = useStore();
  const navigate = useNavigate();
  const todayStr = toLocalDateString(localToday());
  
  const upcomingEvents = state.events
    .filter(e => e.startDate >= todayStr)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 3);

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'visit': return <MapPin className="w-4 h-4" />;
      case 'vacation': return <Briefcase className="w-4 h-4" />;
      case 'anniversary': return <Gift className="w-4 h-4" />;
      case 'trip': return <CalendarIcon className="w-4 h-4" />;
      default: return <Info className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-navy">다가오는 일정</h2>
        <button 
          onClick={() => navigate('/record')}
          className="text-xs text-coral font-bold flex items-center"
        >
          <Plus className="w-3 h-3 mr-0.5" />
          일정 추가
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 shadow-sm">
        {upcomingEvents.length === 0 ? (
          <div className="p-5 text-center text-xs text-gray-400">
            예정된 일정이 없습니다.
          </div>
        ) : (
          upcomingEvents.map(e => {
            const dDay = daysBetweenLocal(todayStr, e.startDate);
            return (
              <div key={e.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center">
                    {getEventIcon(e.eventType)}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">{e.title}</div>
                    <div className="text-[11px] text-gray-400">{formatLocalDate(e.startDate)}</div>
                  </div>
                </div>
                <span className="text-indigo-500 font-bold text-xs bg-indigo-50 px-2 py-1 rounded-md">
                  {dDay === 0 ? 'D-Day' : `D-${dDay}`}
                </span>
              </div>
            );
          })
        )}
      </div>

      <button 
        onClick={() => navigate('/trips')}
        className="mt-1 w-full bg-indigo-50 text-indigo-600 font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-transform text-sm flex items-center justify-center gap-2"
      >
        <Plane className="w-4 h-4" />
        여행 플래너
      </button>
    </div>
  );
}
