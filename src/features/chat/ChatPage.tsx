import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, MessageCircle, RefreshCw, Send, Trash2 } from 'lucide-react';
import { MobileShell } from '@/components/MobileShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStore } from '@/lib/useStore';
import { getRecordCryptoEnvironment } from '@/lib/records';
import { getOutboxLocalCacheKey } from '@/lib/outbox';
import {
  createChatRepository,
  prepareChatMessage,
  type ChatContext,
  type ChatFetchedMessage,
  type ChatMessageDraft,
  type ChatMessageContent,
  type PreparedChatMessage,
  type ChatRepository,
  type DecryptedChatMessage,
} from '@/lib/chat';
import {
  applyChatDeliveryOutcome,
  createIndexedDbChatOutbox,
  enqueueChatMessage,
  isChatRetryableReason,
  readQueuedChatMessage,
  type ChatOutboxPersistence,
  type QueuedChatMessage,
} from '@/lib/chatOutbox';
import type { ChatCryptoEnvironment } from '@/app/chat/contentCrypto';
import { classifyServerError, serverErrorMessage, type ServerErrorKind } from '@/lib/serverErrors';

type ChatPageProps = {
  /** Test seam and typed application boundary; production uses the existing runtime. */
  repository?: ChatRepository;
  persistence?: ChatOutboxPersistence | null;
  cryptoEnvironment?: ChatCryptoEnvironment | null;
  localCacheKey?: CryptoKey | null;
  userId?: string;
  coupleId?: string;
  activeCouple?: boolean;
  /** Context remains inside the encrypted chat document; it is never put in the URL. */
  initialContext?: ChatContext;
};

type PendingVisibleMessage = {
  kind: 'pending';
  messageId: string;
  coupleId: string;
  senderUserId: string;
  ordinal: null;
  createdAt: string;
  content: ChatMessageContent;
};

type VisibleMessage = ChatFetchedMessage | PendingVisibleMessage;
type LoadState = 'loading' | 'ready' | 'error';

const PAGE_SIZE = 50;
const PROTECTION_COPY = '이 기기에서 안전한 채팅을 사용하려면 기록 보호 설정을 먼저 완료해 주세요.';
const OUTBOX_COPY = '이 기기에서 메시지를 안전하게 임시 저장할 수 없어 전송하지 못했어요.';
const QUEUED_COPY = '전송이 완료되지 않아 안전하게 임시 보관했어요.';

function operationMessage(reason: string): string {
  if (reason === 'no_active_epoch' || reason === 'key_unavailable') return PROTECTION_COPY;
  if (reason === 'undecryptable') return '이 기기에서 메시지를 열 수 없어요. 보호 설정을 확인해 주세요.';
  if (reason === 'local_cache_key_unavailable') return OUTBOX_COPY;
  const known: ServerErrorKind[] = ['auth_expired', 'forbidden', 'not_found', 'offline', 'unreachable', 'server', 'unknown'];
  return known.includes(reason as ServerErrorKind)
    ? serverErrorMessage(reason as ServerErrorKind)
    : '채팅을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

function compareVisibleMessages(a: VisibleMessage, b: VisibleMessage): number {
  if (a.ordinal === null && b.ordinal === null) return a.createdAt.localeCompare(b.createdAt);
  if (a.ordinal === null) return 1;
  if (b.ordinal === null) return -1;
  return a.ordinal < b.ordinal ? -1 : a.ordinal > b.ordinal ? 1 : 0;
}

function mergeMessages(current: VisibleMessage[], incoming: ChatFetchedMessage[]): VisibleMessage[] {
  const byId = new Map(current.map((message) => [message.messageId, message]));
  for (const message of incoming) byId.set(message.messageId, message);
  return [...byId.values()].sort(compareVisibleMessages);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function outcomeForFailure(reason: string): { ok: false; reason: string; message: string } {
  return { ok: false, reason, message: operationMessage(reason) };
}

function messageText(message: VisibleMessage): string | null {
  return message.kind === 'message' || message.kind === 'pending' ? message.content.text : null;
}

function contextFromNavigation(value: unknown): ChatContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as { kind?: unknown; id?: unknown };
  if ((candidate.kind !== 'daily_record' && candidate.kind !== 'talk_about') || typeof candidate.id !== 'string') return undefined;
  return { kind: candidate.kind, id: candidate.id };
}

export function ChatPage(props: ChatPageProps = {}) {
  const { state } = useStore();
  const location = useLocation();
  const resolvedUserId = props.userId ?? state.authenticatedUser?.id ?? '';
  const resolvedCoupleId = props.coupleId ?? state.profile.couple.coupleId ?? '';
  const resolvedActiveCouple = props.activeCouple ?? Boolean(
    resolvedUserId
    && resolvedCoupleId
    && state.profile.couple.connected
    && state.profile.couple.status === 'active',
  );
  const cryptoEnvironment = props.cryptoEnvironment !== undefined
    ? props.cryptoEnvironment
    : getRecordCryptoEnvironment();
  const localCacheKey = props.localCacheKey !== undefined
    ? props.localCacheKey
    : getOutboxLocalCacheKey();
  const repository = useMemo(() => {
    if (props.repository) return props.repository;
    if (!cryptoEnvironment) return null;
    try {
      return createChatRepository(cryptoEnvironment);
    } catch {
      return null;
    }
  }, [cryptoEnvironment, props.repository]);
  const persistence = useMemo(
    () => props.persistence !== undefined ? props.persistence : createIndexedDbChatOutbox(),
    [props.persistence],
  );
  const navigationContext = useMemo(
    () => contextFromNavigation((location.state as { chatContext?: unknown } | null)?.chatContext),
    [location.state],
  );
  const [pendingContext, setPendingContext] = useState<ChatContext | undefined>(props.initialContext ?? navigationContext);
  const scopeKey = `${resolvedUserId}:${resolvedCoupleId}`;
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<VisibleMessage[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendPhase, setSendPhase] = useState<'idle' | 'sending'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [retryMessageId, setRetryMessageId] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [beforeOrdinal, setBeforeOrdinal] = useState<bigint | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const generationRef = useRef(0);
  const sendingRef = useRef(false);
  const flushingRef = useRef(false);

  const refreshQueueCount = useCallback(async () => {
    if (!persistence || !resolvedUserId) {
      setQueuedCount(0);
      return;
    }
    const entries = await persistence.all();
    setQueuedCount(entries.filter((entry) => entry.userId === resolvedUserId && entry.coupleId === resolvedCoupleId).length);
  }, [persistence, resolvedCoupleId, resolvedUserId]);

  const loadLatest = useCallback(async (initial = false) => {
    if (!resolvedActiveCouple || !repository || !resolvedCoupleId) return;
    const generation = ++generationRef.current;
    if (initial) setLoadState('loading');
    let result;
    try {
      result = await repository.fetchMessages({ coupleId: resolvedCoupleId, limit: PAGE_SIZE });
    } catch (error) {
      if (generation !== generationRef.current) return;
      setLoadState('error');
      setLoadError(operationMessage(classifyServerError(error).kind));
      return;
    }
    if (generation !== generationRef.current) return;
    if (!result.ok) {
      setLoadState('error');
      setLoadError(operationMessage(result.reason));
      return;
    }
    setMessages([...result.value.messages].sort(compareVisibleMessages));
    setBeforeOrdinal(result.value.nextBeforeOrdinal);
    setHasOlder(result.value.nextBeforeOrdinal !== null);
    setLoadError(null);
    setLoadState('ready');
  }, [repository, resolvedActiveCouple, resolvedCoupleId]);

  const loadOlder = useCallback(async () => {
    if (!repository || !resolvedActiveCouple || !resolvedCoupleId || beforeOrdinal === null) return;
    setLoadError(null);
    let result;
    try {
      result = await repository.fetchMessages({
        coupleId: resolvedCoupleId,
        beforeOrdinal,
        limit: PAGE_SIZE,
      });
    } catch (error) {
      setLoadError(operationMessage(classifyServerError(error).kind));
      return;
    }
    if (!result.ok) {
      setLoadError(operationMessage(result.reason));
      return;
    }
    setMessages((current) => mergeMessages(current, result.value.messages));
    setBeforeOrdinal(result.value.nextBeforeOrdinal);
    setHasOlder(result.value.nextBeforeOrdinal !== null);
  }, [beforeOrdinal, repository, resolvedActiveCouple, resolvedCoupleId]);

  const flushPending = useCallback(async () => {
    if (flushingRef.current || !repository || !persistence || !localCacheKey || !resolvedUserId || !resolvedCoupleId) return;
    flushingRef.current = true;
    try {
      const entries = await persistence.all();
      const pending = entries
        .filter((entry) => entry.userId === resolvedUserId && entry.coupleId === resolvedCoupleId && !entry.blocked)
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
      for (const entry of pending) {
        try {
          const prepared = await readQueuedChatMessage(entry, localCacheKey);
          const result = await repository.retryPendingMessage(prepared);
          if (result.ok) {
            await applyChatDeliveryOutcome(persistence, entry, { ok: true });
          } else {
            await applyChatDeliveryOutcome(persistence, entry, outcomeForFailure(result.reason));
          }
        } catch {
          await applyChatDeliveryOutcome(persistence, entry, outcomeForFailure('unknown'));
        }
      }
    } finally {
      flushingRef.current = false;
      await refreshQueueCount();
    }
  }, [localCacheKey, persistence, refreshQueueCount, repository, resolvedCoupleId, resolvedUserId]);

  const retryQueued = useCallback(async (messageId?: string) => {
    if (!repository || !persistence || !localCacheKey || !resolvedUserId || !resolvedCoupleId) {
      setSendError(OUTBOX_COPY);
      return;
    }
    setSendPhase('sending');
    setSendError(null);
    const entries = (await persistence.all())
      .filter((entry) => entry.userId === resolvedUserId && entry.coupleId === resolvedCoupleId)
      .filter((entry) => !messageId || entry.messageId === messageId);
    let delivered = false;
    for (const rawEntry of entries) {
      const entry: QueuedChatMessage = { ...rawEntry, attempts: 0 };
      delete entry.blocked;
      await persistence.put(entry);
      try {
        const prepared = await readQueuedChatMessage(entry, localCacheKey);
        const result = await repository.retryPendingMessage(prepared);
        if (result.ok) {
          await applyChatDeliveryOutcome(persistence, entry, { ok: true });
          delivered = true;
          setMessages((current) => current.filter((item) => item.messageId !== entry.messageId));
          setRetryMessageId((current) => current === entry.messageId ? null : current);
        } else {
          await applyChatDeliveryOutcome(persistence, entry, outcomeForFailure(result.reason));
          setSendError(operationMessage(result.reason));
        }
      } catch {
        await applyChatDeliveryOutcome(persistence, entry, outcomeForFailure('unknown'));
        setSendError(operationMessage('unknown'));
      }
    }
    await refreshQueueCount();
    setSendPhase('idle');
    if (delivered) await loadLatest();
  }, [loadLatest, localCacheKey, persistence, refreshQueueCount, repository, resolvedCoupleId, resolvedUserId]);

  useEffect(() => {
    let mounted = true;
    ++generationRef.current;
    setDraft('');
    setMessages([]);
    setLoadError(null);
    setSendError(null);
    setRetryMessageId(null);
    setPendingContext(props.initialContext ?? navigationContext);
    setBeforeOrdinal(null);
    setHasOlder(false);
    setLoadState('loading');
    void (async () => {
      if (!resolvedActiveCouple || !cryptoEnvironment || !repository) return;
      await loadLatest(true);
      if (mounted) {
        await flushPending();
        await loadLatest();
      }
    })();
    void refreshQueueCount();
    return () => {
      mounted = false;
      generationRef.current += 1;
    };
  }, [cryptoEnvironment, flushPending, loadLatest, navigationContext, props.initialContext, refreshQueueCount, repository, resolvedActiveCouple, scopeKey]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void flushPending();
        void loadLatest();
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [flushPending, loadLatest]);

  const handleSend = async () => {
    if (sendingRef.current || sendPhase === 'sending') return;
    const text = draft.trim();
    if (!text) {
      setSendError('메시지를 입력해 주세요.');
      return;
    }
    if (!resolvedActiveCouple || !resolvedCoupleId) {
      setSendError('활성 커플 공간이 없어 메시지를 보낼 수 없어요.');
      return;
    }
    if (!cryptoEnvironment) {
      setSendError(PROTECTION_COPY);
      return;
    }
    if (!repository) {
      setSendError('채팅을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    sendingRef.current = true;
    setSendPhase('sending');
    setSendError(null);
    let preparedForRetry: PreparedChatMessage | null = null;
    const draftInput: ChatMessageDraft = {
      coupleId: resolvedCoupleId,
      text,
      sentAt: new Date().toISOString(),
      ...(pendingContext ? { context: pendingContext } : {}),
    };
    try {
      const preparedResult = await prepareChatMessage(cryptoEnvironment, draftInput);
      if (!preparedResult.ok) {
        setSendError(operationMessage(preparedResult.reason));
        return;
      }
      const prepared = preparedResult.value;
      preparedForRetry = prepared;
      const pendingVisual: PendingVisibleMessage = {
        kind: 'pending',
        messageId: prepared.messageId,
        coupleId: resolvedCoupleId,
        senderUserId: resolvedUserId,
        ordinal: null,
        createdAt: draftInput.sentAt,
        content: { v: 1, text, sentAt: draftInput.sentAt, media: [] },
      };
      if (isOffline()) {
        if (!persistence) {
          setSendError(OUTBOX_COPY);
          return;
        }
        const queued = await enqueueChatMessage(persistence, {
          localCacheKey: localCacheKey ?? null,
          userId: resolvedUserId,
          message: prepared,
        });
        if (!queued.ok) {
          setSendError(OUTBOX_COPY);
          return;
        }
        setMessages((current) => mergeMessages([...current, pendingVisual], []));
        setDraft('');
        setPendingContext(undefined);
        setRetryMessageId(prepared.messageId);
        setSendError(QUEUED_COPY);
        await refreshQueueCount();
        return;
      }
      const result = await repository.sendMessage(prepared);
      if (result.ok) {
        setDraft('');
        setPendingContext(undefined);
        setMessages((current) => current.filter((item) => item.messageId !== prepared.messageId));
        setRetryMessageId(null);
        await loadLatest();
        return;
      }
      if (isChatRetryableReason(result.reason)) {
        if (!persistence) {
          setSendError(OUTBOX_COPY);
          return;
        }
        const queued = await enqueueChatMessage(persistence, {
          localCacheKey: localCacheKey ?? null,
          userId: resolvedUserId,
          message: prepared,
        });
        if (queued.ok) {
          setMessages((current) => mergeMessages([...current, pendingVisual], []));
          setDraft('');
          setPendingContext(undefined);
          setRetryMessageId(prepared.messageId);
          setSendError(QUEUED_COPY);
          await refreshQueueCount();
        } else {
          setSendError(OUTBOX_COPY);
        }
      } else {
        setSendError(operationMessage(result.reason));
      }
    } catch (error) {
      const classified = classifyServerError(error);
      if (preparedForRetry && isChatRetryableReason(classified.kind) && persistence) {
        const queued = await enqueueChatMessage(persistence, {
          localCacheKey: localCacheKey ?? null,
          userId: resolvedUserId,
          message: preparedForRetry,
        });
        if (queued.ok) {
          setDraft('');
          setPendingContext(undefined);
          setRetryMessageId(preparedForRetry.messageId);
          setSendError(QUEUED_COPY);
          await refreshQueueCount();
        } else {
          setSendError(OUTBOX_COPY);
        }
      } else {
        setSendError(operationMessage(classified.kind));
      }
    } finally {
      sendingRef.current = false;
      setSendPhase('idle');
    }
  };

  const handleDelete = async (message: DecryptedChatMessage) => {
    if (!repository || !resolvedActiveCouple || message.senderUserId !== resolvedUserId) return;
    setSendError(null);
    let result;
    try {
      result = await repository.deleteMessage({ coupleId: resolvedCoupleId, messageId: message.messageId });
    } catch (error) {
      setSendError(operationMessage(classifyServerError(error).kind));
      return;
    }
    if (!result.ok) {
      setSendError(operationMessage(result.reason));
      return;
    }
    await loadLatest();
  };

  const screenState = !resolvedActiveCouple
    ? 'NO_ACTIVE_COUPLE'
    : !cryptoEnvironment
      ? 'PROTECTION_REQUIRED'
      : !repository
        ? 'UNAVAILABLE_MESSAGE'
        : sendPhase === 'sending'
          ? 'SENDING'
          : loadState === 'loading'
            ? 'LOADING'
            : loadState === 'error' && messages.length === 0
              ? 'ERROR'
              : sendError
                ? 'RETRYABLE_FAILURE'
                : messages.length === 0
                  ? 'EMPTY'
                  : 'READY';

  return (
    <MobileShell>
      <div className="px-4 pt-4 pb-6 space-y-4" data-testid="chat-page" data-chat-state={screenState}>
        <header className="flex items-center gap-2">
          <Link to="/home" aria-label="홈으로" className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-control text-muted-foreground">
            <ArrowLeft size={20} aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-heading text-foreground">채팅</h1>
            <p className="text-caption text-muted-foreground">놓친 하루를 이어서 이야기해요.</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            aria-label="채팅 새로고침"
            onClick={() => { void loadLatest(); void flushPending(); }}
            disabled={screenState === 'LOADING' || screenState === 'SENDING'}
          >
            <RefreshCw size={16} aria-hidden="true" />
            새로고침
          </Button>
        </header>

        {screenState === 'NO_ACTIVE_COUPLE' ? (
          <Card><EmptyState title="커플 연결이 필요해요" description="활성 커플 공간이 준비되면 채팅을 시작할 수 있어요." action={<Link className="text-label font-semibold text-coral-strong underline" to="/settings">커플 설정으로</Link>} /></Card>
        ) : null}
        {screenState === 'PROTECTION_REQUIRED' ? (
          <Card><EmptyState title="안전한 채팅을 준비해 주세요" description={PROTECTION_COPY} action={<Link className="text-label font-semibold text-coral-strong underline" to="/settings">기록 보호 설정으로</Link>} /></Card>
        ) : null}
        {screenState === 'UNAVAILABLE_MESSAGE' ? (
          <Card><EmptyState title="채팅을 사용할 수 없어요" description="잠시 후 다시 시도해 주세요." action={<Button size="sm" onClick={() => void loadLatest()}>다시 시도</Button>} /></Card>
        ) : null}
        {screenState === 'LOADING' ? (
          <Card><div className="space-y-3" aria-label="채팅 불러오는 중"><div className="h-4 w-24 rounded bg-muted animate-pulse" /><div className="h-16 rounded-surface bg-muted animate-pulse" /><div className="h-16 rounded-surface bg-muted animate-pulse ml-8" /></div></Card>
        ) : null}
        {screenState === 'ERROR' ? (
          <Card><EmptyState title="채팅을 불러오지 못했어요" description={loadError ?? '잠시 후 다시 시도해 주세요.'} action={<Button size="sm" onClick={() => void loadLatest()}>다시 시도</Button>} /></Card>
        ) : null}

        {screenState !== 'NO_ACTIVE_COUPLE' && screenState !== 'PROTECTION_REQUIRED' && screenState !== 'UNAVAILABLE_MESSAGE' && screenState !== 'LOADING' && screenState !== 'ERROR' ? (
          <>
            {hasOlder ? (
              <div className="flex justify-center">
                <Button size="sm" variant="ghost" onClick={() => void loadOlder()}>이전 메시지 보기</Button>
              </div>
            ) : null}
            {messages.length === 0 ? (
              <Card><EmptyState icon={<MessageCircle size={22} className="text-coral" />} title="아직 대화가 없어요" description="오늘의 기록을 바탕으로 가볍게 이야기를 시작해 보세요." /></Card>
            ) : (
              <ol className="space-y-2" aria-label="채팅 메시지 목록">
                {messages.map((message) => {
                  const own = message.senderUserId === resolvedUserId;
                  const text = messageText(message);
                  const isDeletable = message.kind === 'message' && own;
                  return (
                    <li key={message.messageId} data-message-id={message.messageId} data-ordinal={message.ordinal === null ? 'pending' : message.ordinal.toString()} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] ${own ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                        {message.kind === 'tombstone' ? (
                          <p className="rounded-surface border border-border px-3 py-2 text-caption text-muted-foreground italic">삭제된 메시지예요.</p>
                        ) : message.kind === 'unavailable' ? (
                          <p className="rounded-surface border border-border px-3 py-2 text-caption text-muted-foreground italic">이 기기에서 열 수 없는 메시지예요.</p>
                        ) : (
                          <p className={`rounded-surface px-3 py-2 text-body whitespace-pre-wrap break-words ${own ? 'bg-coral-fill text-coral-fill-foreground' : 'bg-card border border-border text-foreground'} ${message.kind === 'pending' ? 'opacity-70' : ''}`}>
                            {text}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-caption text-muted-foreground">
                          <time dateTime={message.kind === 'message' || message.kind === 'pending' ? message.content.sentAt : message.createdAt}>
                            {formatTime(message.kind === 'message' || message.kind === 'pending' ? message.content.sentAt : message.createdAt)}
                          </time>
                          {message.kind === 'pending' ? <span>전송 대기 중</span> : null}
                          {isDeletable ? (
                            <button type="button" className="min-h-11 inline-flex items-center gap-1 underline" onClick={() => void handleDelete(message)}>
                              <Trash2 size={13} aria-hidden="true" /> 삭제
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {queuedCount > 0 ? (
              <Card className="border-warning bg-warning-surface">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-caption text-foreground">안전하게 임시 보관한 메시지 {queuedCount}개가 있어요.</p>
                  <Button size="sm" onClick={() => void retryQueued()}>다시 보내기</Button>
                </div>
              </Card>
            ) : null}
            {loadError ? <p role="alert" className="text-caption text-destructive">{loadError}</p> : null}
            {sendError ? (
              <div role="alert" className="flex items-center justify-between gap-3 rounded-surface border border-destructive/30 bg-card px-3 py-2">
                <p className="text-caption text-destructive break-keep">{sendError}</p>
                {retryMessageId ? <Button size="sm" variant="outline" onClick={() => void retryQueued(retryMessageId)}>재시도</Button> : null}
              </div>
            ) : null}
            <form
              className="sticky bottom-0 bg-background/95 backdrop-blur-sm pt-2 pb-1 flex items-end gap-2"
              onSubmit={(event) => { event.preventDefault(); void handleSend(); }}
            >
              <label className="sr-only" htmlFor="chat-message-input">메시지</label>
              <textarea
                id="chat-message-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="메시지를 입력해 주세요"
                rows={1}
                className="min-h-11 max-h-32 flex-1 resize-y rounded-control border border-border bg-card px-3 py-2.5 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-coral"
                disabled={screenState === 'SENDING'}
              />
              <Button type="submit" variant="primary" size="md" aria-label="메시지 보내기" disabled={screenState === 'SENDING' || !draft.trim()}>
                <Send size={17} aria-hidden="true" />
                보내기
              </Button>
            </form>
          </>
        ) : null}
      </div>
    </MobileShell>
  );
}
