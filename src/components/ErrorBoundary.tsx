import { Component, type ReactNode } from 'react';
import i18n from '../i18n';

interface State {
  error: Error | null;
}

/**
 * Keeps one broken screen from blanking the whole app. Data is never at risk
 * here (all writes are transactional); this only protects the UI.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Screen crashed:', error);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // navigating to another screen clears the error
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mt-10 glass rounded-3xl p-5 text-center">
        <p className="mb-1 font-bold">{i18n.t('common.error')}</p>
        <p className="mb-4 text-xs text-ink-dim" dir="ltr">{this.state.error.message}</p>
        <button className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary" onClick={() => window.location.reload()}>
          {i18n.t('common.reload')}
        </button>
      </div>
    );
  }
}
