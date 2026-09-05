import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportBoundaryError } from '@/lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportBoundaryError(error, info);
    console.error('[gomsinlog] A render error reached the recovery boundary.');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="paper-texture-layer flex min-h-[100dvh] items-center justify-center px-4 text-center pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
        >
          <div className="ink-box w-full max-w-sm px-6 py-8">
            <AlertTriangle
              size={26}
              className="pen-icon mx-auto mb-4"
              style={{ color: 'var(--ink-accent)' }}
              aria-hidden="true"
            />
            <h1 className="mb-2 text-title" style={{ color: 'var(--ink)' }}>
              문제가 발생했어요
            </h1>
            <p className="mb-6 text-body" style={{ color: 'var(--ink-soft)' }}>
              앱을 다시 시작합니다
            </p>
            {/*
              A plain <button> on purpose. The boundary has already survived a
              render crash, so recovery depends only on this component, the icon
              package already used by the shell, and base CSS.
            */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="press-response ink-fill inline-flex min-h-11 items-center justify-center gap-2 px-5 text-label font-semibold"
            >
              <RefreshCw size={16} className="pen-icon" aria-hidden="true" />
              새로고침
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
