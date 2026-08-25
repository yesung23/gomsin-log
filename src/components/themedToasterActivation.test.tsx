import React, { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { toast } from 'sonner';
import { createDeferredFailureSink } from '@/lib/deepLinks';

vi.mock('@/lib/useStore', () => ({ useStore: () => ({ state: { theme: 'light' } }) }));

const { ThemedToaster } = await import('@/components/ThemedToaster');

describe('ThemedToaster activation ordering', () => {
  it('shows a failure that was reported before anything mounted in actual StrictMode', async () => {
    const sink = createDeferredFailureSink();
    sink.report('로그인을 마치지 못했어요. 다시 시도해 주세요.');

    render(
      <StrictMode>
        <ThemedToaster onReady={() => sink.activate((m) => toast.error(m))} />
      </StrictMode>,
    );

    expect(
      await screen.findByText('로그인을 마치지 못했어요. 다시 시도해 주세요.'),
    ).toBeTruthy();
  });

  it('shows a failure reported after mount in StrictMode', async () => {
    const sink = createDeferredFailureSink();
    render(
      <StrictMode>
        <ThemedToaster onReady={() => sink.activate((m) => toast.error(m))} />
      </StrictMode>,
    );

    await act(async () => {
      sink.report('나중에 생긴 오류');
    });

    expect(await screen.findByText('나중에 생긴 오류')).toBeTruthy();
  });

  it('does not show a queued message twice under StrictMode double-rendering', async () => {
    const sink = createDeferredFailureSink();
    sink.report('한 번만 보여야 해요');
    const activate = () => sink.activate((m) => toast.error(m));

    const { unmount } = render(
      <StrictMode>
        <ThemedToaster onReady={activate} />
      </StrictMode>,
    );
    await screen.findByText('한 번만 보여야 해요');

    expect(screen.getAllByText('한 번만 보여야 해요')).toHaveLength(1);
    unmount();
  });

  it('calls onReady after Sonner has subscribed in the second commit', () => {
    const sink = createDeferredFailureSink();
    const published: string[] = [];

    render(
      <StrictMode>
        <ThemedToaster
          onReady={() => {
            sink.activate((m) => {
              published.push(m);
              toast.error(m);
            });
            sink.report('during-ready');
          }}
        />
      </StrictMode>,
    );

    expect(published).toEqual(['during-ready']);
  });
});
