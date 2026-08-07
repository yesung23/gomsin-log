import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

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
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-6 text-center"
          aria-live="assertive"
        >
          <h1 className="text-title text-coral-strong mb-2">
            문제가 발생했어요
          </h1>
          <p className="text-body text-muted-foreground mb-6">
            앱을 다시 시작합니다
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-coral-strong text-coral-strong-foreground text-label font-semibold shadow-sm active:scale-95 transition-transform"
          >
            새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
