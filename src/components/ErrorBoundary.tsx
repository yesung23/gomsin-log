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

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    console.error('[gomsinlog] A render error reached the recovery boundary.');
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
          {/*
            A plain <button> on purpose, unlike every other primary CTA in the app.

            This is the boundary that catches a render crash. Whatever it draws has
            already survived the failure below it, so the one control that gets the
            user out should depend on as little as possible -- importing a component
            here to gain a shared class list would put a second thing between the
            user and a reload.

            The geometry is copied from `Button` `md` rather than shared: 44px tall,
            `rounded-control`, the measured `--coral-fill` pair. `press-response`
            comes from the base layer, which is CSS and cannot throw.
          */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="press-response min-h-11 px-5 rounded-control bg-coral-fill text-coral-fill-foreground text-label font-semibold"
          >
            새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
