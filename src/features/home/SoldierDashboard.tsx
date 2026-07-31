import React from 'react';
import { useStore } from '@/lib/store';
import {
  Sparkles,
  Heart,
  ChevronRight,
  MessageCircleHeart,
  Settings,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { generateDailySummary, generateEmotionFlowBriefing } from '@/lib/briefing';
import { toLocalDateString, localToday } from '@/lib/utils';
import { TodayLogWidget } from '@/components/widgets/TodayLogWidget';
import { isOwnRecord } from '@/lib/privacy';

export function SoldierDashboard() {
  const { state, setHighlightedRecordId } = useStore();
  const navigate = useNavigate();
  const { profile, records } = state;
  const partnerName = profile.couple.partnerName || '상대방';
  const viewer = { userId: profile.id, role: profile.role };

  // What the partner shared with me today.
  const todayStr = toLocalDateString(localToday());
  const sharedRecords = records.filter(
    (record) =>
      record.date === todayStr && !isOwnRecord(record, viewer) && !record.isPrivate,
  );

  const dailySummary = generateDailySummary(sharedRecords, partnerName);
  const emotionBriefing = generateEmotionFlowBriefing(sharedRecords);

  // My own records for today, so the count reflects what I actually wrote.
  const myTodayRecords = records.filter(
    (record) => record.date === todayStr && isOwnRecord(record, viewer),
  );

  // Describe what the partner actually shared. The previous version rendered a
  // progress bar from `sharedRecords.length * 25`, which looked like a measured
  // "energy level" but was only a record count in disguise.
  const moodLabel = sharedRecords.length === 0
    ? '오늘 공유된 순간이 아직 없어요'
    : sharedRecords.some(r => r.reaction === 'hard')
    ? '조금 힘든 일이 있었어요 🥹'
    : sharedRecords.some(r => r.reaction === 'good' || r.reaction === 'thought_of_you')
    ? '기분 좋은 순간을 남겼어요 😊'
    : '평온하게 하루를 보내고 있어요 ✨';

  const careHint = sharedRecords.some(r => r.reaction === 'hard')
    ? '오늘 힘든 순간이 있었으니 수고했다고 다정하게 말해주세요!'
    : sharedRecords.some(r => r.reaction === 'thought_of_you')
    ? '네 생각이 났다고 해요! 반갑고 따뜻하게 맞아주세요.'
    : sharedRecords.length > 0
    ? '오늘의 소소한 일상을 듣고 칭찬과 격려를 건네보세요.'
    : '전화할 때 따뜻한 목소리로 첫 인사를 건네주세요!';

  const handleNavigateToRecord = (recordId?: string) => {
    if (recordId) {
      setHighlightedRecordId(recordId);
    }
    navigate('/record');
  };

  const primaryItem = dailySummary.items[0];
  const primaryRecordId = primaryItem?.recordIds[0] || sharedRecords[0]?.id;

  return (
    <div className="pb-8">
      <header className="px-5 pt-10 pb-6 flex items-start justify-between sticky top-0 bg-background/90 backdrop-blur-xl z-40">
        <div>
          <span className="text-xs font-semibold tracking-wide text-coral mb-1 block">
            ♡ 곰신로그
          </span>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">
            안녕 {profile.myName} <span className="text-coral">♡</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {partnerName}님이 전해준 오늘을 천천히 살펴보세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          aria-label="설정"
          className="w-11 h-11 rounded-full border border-border bg-card text-muted-foreground flex items-center justify-center active:scale-95 transition"
        >
          <Settings size={20} />
        </button>
      </header>

      <div className="px-5 space-y-4 min-h-[500px]">
        <section className="rounded-3xl p-5 border border-coral/20 bg-gradient-to-br from-coral/15 via-card to-lilac/70 shadow-sm space-y-4 relative overflow-hidden">
          <div className="absolute -right-5 -bottom-6 opacity-10 text-coral">
            <Heart size={112} fill="currentColor" />
          </div>
          <div className="relative z-10 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-coral/15 text-coral flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-coral">오늘의 이야기</span>
            </div>
            <h2 className="text-lg font-extrabold leading-relaxed text-foreground break-keep">
              {dailySummary.opener ? (
                dailySummary.opener.text
              ) : (
                `${partnerName}님이 오늘 공유한 기록을 기다리고 있어요.`
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              공유된 기록만 요약하며, 상대방의 비공개 기록은 표시하지 않아요.
            </p>
          </div>

          {dailySummary.opener && (
            <button
              onClick={() => handleNavigateToRecord(dailySummary.opener?.recordIds[0])}
              className="mt-2 text-xs font-bold text-coral flex items-center gap-1 relative z-10"
            >
              관련 원문 보기 <ChevronRight size={14} />
            </button>
          )}
        </section>

        <div className="grid grid-cols-2 gap-3">
          <section className="bg-card rounded-3xl p-4 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-full bg-mint text-success flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </span>
              <h3 className="text-xs font-extrabold text-foreground">{partnerName}의 하루</h3>
            </div>
            <div className="space-y-2">
              <p className="text-2xl font-black text-foreground leading-none">
                {sharedRecords.length}
                <span className="text-xs font-bold text-muted-foreground ml-1">개 공유</span>
              </p>
              <p className="text-[11px] font-semibold text-muted-foreground leading-relaxed break-keep">
                {moodLabel}
              </p>
            </div>
          </section>

          <section className="bg-card rounded-3xl p-4 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-full bg-coral/15 text-coral flex items-center justify-center">
                <Heart className="w-4 h-4" />
              </span>
              <h3 className="text-xs font-extrabold text-foreground">다정한 한마디</h3>
            </div>
            <p className="text-[11px] font-semibold leading-relaxed text-muted-foreground break-keep">
              {careHint}
            </p>
          </section>
        </div>

        <button
          type="button"
          onClick={() => handleNavigateToRecord(primaryRecordId)}
          className="w-full text-left bg-card rounded-3xl p-5 shadow-sm border border-border space-y-3 active:scale-[0.98] transition"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-lilac text-coral flex items-center justify-center">
                <MessageCircleHeart className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-xs font-extrabold text-foreground">오늘의 한 줄 요약</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">기록에서 확인한 내용이에요</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>

          <p className="text-sm font-semibold leading-relaxed text-foreground break-keep">
            {emotionBriefing ? (
              emotionBriefing.flowText
            ) : primaryItem ? (
              primaryItem.text
            ) : sharedRecords.length > 0 ? (
              `"${sharedRecords[0].log || '공유된 기록이 있습니다.'}"`
            ) : (
              '아직 오늘 공유된 기록이 없습니다. 나중에 다시 확인해보세요!'
            )}
          </p>
        </button>

        {/*
          군화도 글과 사진·영상·음성 기록을 남길 수 있어야 합니다.
          이전에는 이 화면이 읽기 전용이어서 군화는 아무것도 작성할 수 없었습니다.
        */}
        <section className="bg-card rounded-3xl p-5 shadow-sm border border-border">
          <TodayLogWidget />
        </section>

        <div className="rounded-3xl border border-border bg-muted/40 p-4 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-extrabold text-foreground">내 복무 현황</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              전역일과 복무율을 확인하고 수정할 수 있어요
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/service')}
            className="text-xs font-bold text-coral bg-coral/10 px-3 py-2 rounded-xl active:scale-95 transition"
          >
            보기
          </button>
        </div>

        {myTodayRecords.length > 0 && (
          <p className="text-center text-[11px] text-muted-foreground">
            오늘 내가 남긴 기록 {myTodayRecords.length}개
          </p>
        )}
      </div>
    </div>
  );
}
