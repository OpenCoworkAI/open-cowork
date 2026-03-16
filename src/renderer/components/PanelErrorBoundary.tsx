import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface PanelErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  name: string;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
}

/**
 * Generic error boundary that catches render errors in a panel/section
 * and replaces it with a static fallback to prevent full-page white-screen.
 */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] Render error caught by boundary:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
