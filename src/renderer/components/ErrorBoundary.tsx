import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import i18n from '../i18n/config';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Root-level ErrorBoundary that catches any uncaught render errors in the
 * React tree and shows a user-friendly fallback page instead of a white screen.
 *
 * Uses i18n directly (not the useTranslation hook) because class components
 * cannot use React hooks.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
  }

  /** Reset the boundary so the subtree can attempt re-rendering. */
  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const t = (key: string) => i18n.t(key);

    return (
      <div className="h-full w-full min-h-0 flex flex-col items-center justify-center bg-background px-6 py-10">
        <div className="max-w-md w-full space-y-6 text-center">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-error/10 text-error">
              <AlertTriangle className="w-8 h-8" />
            </div>
          </div>

          {/* Heading & description */}
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-text-primary">
              {t('errorBoundary.title')}
            </h2>
            <p className="text-sm text-text-secondary">
              {t('errorBoundary.description')}
            </p>
          </div>

          {/* Error detail (collapsed, non-critical) */}
          {this.state.error && (
            <details className="text-left rounded-xl border border-border-subtle bg-surface-muted px-4 py-3">
              <summary className="cursor-pointer text-xs text-text-muted select-none">
                {t('errorBoundary.details')}
              </summary>
              <pre className="mt-2 text-xs text-error/80 whitespace-pre-wrap break-all font-mono">
                {this.state.error.message}
              </pre>
            </details>
          )}

          {/* Retry button */}
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 btn btn-primary px-5 py-2.5 rounded-2xl"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t('errorBoundary.retry')}</span>
          </button>
        </div>
      </div>
    );
  }
}
