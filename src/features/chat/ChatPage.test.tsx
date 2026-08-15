import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  current: {
    authenticatedUser: { id: 'user-a' },
    profile: { couple: { coupleId: 'couple-a', connected: true, status: 'active' } },
  } as any,
}));
const chatMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  enqueue: vi.fn(),
  read: vi.fn(),
  apply: vi.fn(),
}));

vi.mock('@/lib/useStore', () => ({ useStore: () => ({ state: storeState.current }) }));
vi.mock('@/components/MobileShell', () => ({ MobileShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/chat', () => ({ prepareChatMessage: chatMocks.prepare }));
vi.mock('@/lib/chatOutbox', () => ({
  applyChatDeliveryOutcome: chatMocks.apply,
  createIndexedDbChatOutbox: vi.fn(() => null),
  enqueueChatMessage: chatMocks.enqueue,
  isChatRetryableReason: (reason: string) => reason === 'offline' || reason === 'unreachable',
  readQueuedChatMessage: chatMocks.read,
}));

import { ChatPage } from './ChatPage';

const COUPLE = 'couple-a';
const ME = 'user-a';
const PARTNER = 'user-b';

function message(messageId: string, ordinal: bigint, senderUserId: string, text: string) {
  return {
    kind: 'message' as const,
    messageId,
    coupleId: COUPLE,
    senderUserId,
    ordinal,
    createdAt: `2026-08-15T12:0${ordinal.toString()}:00.000Z`,
    content: { v: 1 as const, text, sentAt: `2026-08-15T12:0${ordinal.toString()}:00.000Z`, media: [] as [] },
    keyEpoch: 1n,
  };
}

function makeRepository(fetchResults: unknown[]) {
  let fetchIndex = 0;
  return {
    fetchMessages: vi.fn(async () => fetchResults[Math.min(fetchIndex++, fetchResults.length - 1)]),
    sendMessage: vi.fn(async () => ({ ok: true, value: { ordinal: 9n } })),
    retryPendingMessage: vi.fn(async () => ({ ok: true, value: { ordinal: 9n } })),
    deleteMessage: vi.fn(async () => ({ ok: true, value: null })),
  } as any;
}

const cryptoEnvironment = { epochsFor: vi.fn(), scopeKeyFor: vi.fn() } as any;
const persistence = {
  entries: new Map<string, any>(),
  all: vi.fn(async function all(this: typeof persistence) { return [...this.entries.values()]; }),
  put: vi.fn(async function put(this: typeof persistence, entry: any) { this.entries.set(entry.messageId, entry); }),
  remove: vi.fn(async function remove(this: typeof persistence, messageId: string) { this.entries.delete(messageId); }),
};

function renderChat(repository: any, options: { activeCouple?: boolean; crypto?: any; persistenceValue?: any } = {}) {
  return render(
    <MemoryRouter initialEntries={['/chat']}>
      <ChatPage
        repository={repository}
        persistence={options.persistenceValue === undefined ? persistence : options.persistenceValue}
        cryptoEnvironment={options.crypto === undefined ? cryptoEnvironment : options.crypto}
        localCacheKey={{} as CryptoKey}
        {...(options.activeCouple === undefined ? {} : { activeCouple: options.activeCouple })}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  storeState.current = {
    authenticatedUser: { id: ME },
    profile: { couple: { coupleId: COUPLE, connected: true, status: 'active' } },
  };
  chatMocks.prepare.mockReset().mockResolvedValue({
    ok: true,
    value: { messageId: 'message-new', coupleId: COUPLE, keyEpoch: 1n, ciphertext: new Uint8Array([1, 2, 3]) },
  });
  chatMocks.enqueue.mockReset().mockImplementation(async (target: any, input: any) => {
    const entry = { messageId: input.message.messageId, userId: input.userId, coupleId: input.message.coupleId, queuedAt: '2026-08-15T12:00:00Z', attempts: 0, sealedMessage: {} };
    await target.put(entry);
    return { ok: true, entry };
  });
  chatMocks.read.mockReset();
  chatMocks.apply.mockReset().mockResolvedValue('delivered');
  persistence.entries.clear();
  persistence.all.mockClear();
  persistence.put.mockClear();
  persistence.remove.mockClear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('ChatPage product flow', () => {
  it('renders partner and own messages in server ordinal order', async () => {
    const repository = makeRepository([{
      ok: true,
      value: { messages: [message('two', 2n, PARTNER, '나중 메시지'), message('one', 1n, ME, '먼저 메시지')], nextBeforeOrdinal: null },
    }]);
    renderChat(repository);
    await waitFor(() => expect(screen.getByText('나중 메시지')).toBeInTheDocument());
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-ordinal'))).toEqual(['1', '2']);
    expect(within(rows[0]).getByText('삭제')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('삭제')).toBeNull();
  });

  it('shows tombstone and unavailable ciphertext honestly without an empty bubble', async () => {
    const repository = makeRepository([{
      ok: true,
      value: {
        messages: [
          { kind: 'tombstone', messageId: 'deleted', coupleId: COUPLE, senderUserId: ME, ordinal: 1n, createdAt: '2026-08-15T12:01:00Z' },
          { kind: 'unavailable', messageId: 'locked', coupleId: COUPLE, senderUserId: PARTNER, ordinal: 2n, createdAt: '2026-08-15T12:02:00Z', reason: 'undecryptable' },
        ],
        nextBeforeOrdinal: null,
      },
    }]);
    renderChat(repository);
    expect(await screen.findByText('삭제된 메시지예요.')).toBeInTheDocument();
    expect(screen.getByText('이 기기에서 열 수 없는 메시지예요.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').some((row) => row.textContent === '')).toBe(false);
  });

  it('rejects whitespace and prevents an accidental double submit', async () => {
    const repository = makeRepository([{ ok: true, value: { messages: [], nextBeforeOrdinal: null } }]);
    renderChat(repository);
    await screen.findByText('아직 대화가 없어요');
    const input = screen.getByLabelText('메시지');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('메시지를 입력해 주세요.');

    fireEvent.change(input, { target: { value: '안전한 메시지' } });
    let resolveSend!: (value: unknown) => void;
    repository.sendMessage.mockReturnValueOnce(new Promise((resolve) => { resolveSend = resolve; }));
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(chatMocks.prepare).toHaveBeenCalledTimes(1));
    resolveSend({ ok: true, value: { ordinal: 3n } });
  });

  it('does not send without an active couple or a crypto runtime', async () => {
    const noCouple = makeRepository([{ ok: true, value: { messages: [], nextBeforeOrdinal: null } }]);
    renderChat(noCouple, { activeCouple: false });
    expect(await screen.findByText('커플 연결이 필요해요')).toBeInTheDocument();
    expect(screen.queryByLabelText('메시지')).toBeNull();
    expect(noCouple.sendMessage).not.toHaveBeenCalled();

    const noCrypto = makeRepository([{ ok: true, value: { messages: [], nextBeforeOrdinal: null } }]);
    renderChat(noCrypto, { crypto: null });
    expect(await screen.findByText('안전한 채팅을 준비해 주세요')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '기록 보호 설정으로' })).toHaveAttribute('href', '/settings');
    expect(noCrypto.sendMessage).not.toHaveBeenCalled();
  });

  it('clears the input only after server success and refreshes the conversation', async () => {
    const repository = makeRepository([
      { ok: true, value: { messages: [], nextBeforeOrdinal: null } },
      { ok: true, value: { messages: [message('message-new', 3n, ME, '전송된 메시지')], nextBeforeOrdinal: null } },
    ]);
    renderChat(repository);
    const input = await screen.findByLabelText('메시지');
    await userEvent.type(input, '전송된 메시지');
    await userEvent.click(screen.getByRole('button', { name: '메시지 보내기' }));
    await waitFor(() => expect(screen.getByText('전송된 메시지')).toBeInTheDocument());
    expect(input).toHaveValue('');
    expect(repository.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps a talk-about context in the encrypted preparation boundary, not the URL', async () => {
    const repository = makeRepository([{ ok: true, value: { messages: [], nextBeforeOrdinal: null } }]);
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ChatPage
          repository={repository}
          persistence={persistence}
          cryptoEnvironment={cryptoEnvironment}
          localCacheKey={{} as CryptoKey}
          initialContext={{ kind: 'talk_about', id: 'record-a' }}
        />
      </MemoryRouter>,
    );
    const input = await screen.findByLabelText('메시지');
    await userEvent.type(input, '이 기록에 대해 이야기하자');
    await userEvent.click(screen.getByRole('button', { name: '메시지 보내기' }));
    await waitFor(() => expect(chatMocks.prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      context: { kind: 'talk_about', id: 'record-a' },
    })));
    expect(window.location.search).toBe('');
  });

  it('persists retryable failure with the same messageId and retries that id', async () => {
    const repository = makeRepository([{ ok: true, value: { messages: [], nextBeforeOrdinal: null } }]);
    repository.sendMessage.mockResolvedValueOnce({ ok: false, reason: 'unreachable' });
    repository.retryPendingMessage.mockResolvedValueOnce({ ok: true, value: { ordinal: 4n } });
    renderChat(repository);
    const input = await screen.findByLabelText('메시지');
    await userEvent.type(input, '네트워크가 끊겨도 보존');
    await userEvent.click(screen.getByRole('button', { name: '메시지 보내기' }));
    expect(await screen.findByText('전송이 완료되지 않아 안전하게 임시 보관했어요.')).toBeInTheDocument();
    expect(chatMocks.enqueue).toHaveBeenCalledWith(persistence, expect.objectContaining({
      userId: ME,
      message: expect.objectContaining({ messageId: 'message-new', ciphertext: expect.any(Uint8Array) }),
    }));
    expect(chatMocks.enqueue.mock.calls[0][1].message).not.toHaveProperty('text');
    chatMocks.read.mockResolvedValue({ messageId: 'message-new', coupleId: COUPLE, keyEpoch: 1n, ciphertext: new Uint8Array([1, 2, 3]) });
    await userEvent.click(screen.getByRole('button', { name: '재시도' }));
    await waitFor(() => expect(repository.retryPendingMessage).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'message-new' })));
  });

  it('fails closed offline when the LCK or persistence is unavailable', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const repository = makeRepository([{ ok: true, value: { messages: [], nextBeforeOrdinal: null } }]);
    renderChat(repository, { persistenceValue: null, });
    const input = await screen.findByLabelText('메시지');
    await userEvent.type(input, '보호되지 않은 임시 저장 금지');
    await userEvent.click(screen.getByRole('button', { name: '메시지 보내기' }));
    expect(await screen.findByText('이 기기에서 메시지를 안전하게 임시 저장할 수 없어 전송하지 못했어요.')).toBeInTheDocument();
    expect(input).toHaveValue('보호되지 않은 임시 저장 금지');
    expect(repository.sendMessage).not.toHaveBeenCalled();
  });

  it('loads older messages by ordinal and deduplicates pages', async () => {
    const repository = makeRepository([
      { ok: true, value: { messages: [message('three', 3n, PARTNER, '셋')], nextBeforeOrdinal: 3n } },
      { ok: true, value: { messages: [message('three', 3n, PARTNER, '셋')], nextBeforeOrdinal: 3n } },
      { ok: true, value: { messages: [message('two', 2n, ME, '둘'), message('three', 3n, PARTNER, '셋')], nextBeforeOrdinal: null } },
    ]);
    renderChat(repository);
    await userEvent.click(await screen.findByRole('button', { name: '이전 메시지 보기' }));
    await waitFor(() => expect(screen.getByText('둘')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem').filter((row) => row.getAttribute('data-message-id') === 'three')).toHaveLength(1);
    expect(repository.fetchMessages).toHaveBeenCalledWith(expect.objectContaining({ beforeOrdinal: 3n }));
  });

  it('keeps decrypted chat isolated when the account or couple scope changes', async () => {
    const repository = makeRepository([
      { ok: true, value: { messages: [message('mine', 1n, ME, '계정 A의 대화')], nextBeforeOrdinal: null } },
      { ok: true, value: { messages: [message('mine', 1n, ME, '계정 A의 대화')], nextBeforeOrdinal: null } },
      { ok: true, value: { messages: [], nextBeforeOrdinal: null } },
    ]);
    const view = renderChat(repository);
    expect(await screen.findByText('계정 A의 대화')).toBeInTheDocument();
    storeState.current = {
      authenticatedUser: { id: 'user-b' },
      profile: { couple: { coupleId: 'couple-b', connected: true, status: 'active' } },
    };
    view.rerender(<MemoryRouter initialEntries={['/chat']}><ChatPage repository={repository} persistence={persistence} cryptoEnvironment={cryptoEnvironment} localCacheKey={{} as CryptoKey} /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText('계정 A의 대화')).toBeNull());
  });
});
