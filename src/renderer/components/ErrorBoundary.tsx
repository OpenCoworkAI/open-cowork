import { Component, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
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

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 border border-error/20 text-sm text-error">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{this.props.fallbackMessage || 'Something went wrong rendering this content.'}</span>
        </div>
      );
    }

    return this.props.children;
  }
}
