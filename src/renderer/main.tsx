import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import 'katex/dist/katex.min.css';
import './i18n/config'; // Initialize i18n
import {
  normalizeRendererLogValue,
  RendererDiagnosticsDeduper,
  shouldCaptureConsoleError,
} from './utils/renderer-diagnostics';

function writeRendererDiagnostic(kind: string, args: unknown[]): void {
  const logApi = window.electronAPI?.logs?.write;
  if (!logApi) {
    return;
  }

  const payload = {
    kind,
    href: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    args: args.map((arg) => normalizeRendererLogValue(arg)),
  };

  void logApi('error', '[RendererDiagnostic]', payload).catch(() => {
    // Ignore diagnostics forwarding failures to avoid feedback loops.
  });
}

function installRendererDiagnostics(): void {
  if (typeof window === 'undefined' || !window.electronAPI?.logs?.write) {
    return;
  }

  const diagnosticsWindow = window as Window & { __rendererDiagnosticsInstalled?: boolean };
  if (diagnosticsWindow.__rendererDiagnosticsInstalled) {
    return;
  }
  diagnosticsWindow.__rendererDiagnosticsInstalled = true;
  const deduper = new RendererDiagnosticsDeduper();

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    if (shouldCaptureConsoleError(args) && deduper.shouldReport(args)) {
      writeRendererDiagnostic('console.error', args);
    }
  };

  window.addEventListener('error', (event) => {
    const payload = [
      {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: normalizeRendererLogValue(event.error),
      },
    ];
    if (deduper.shouldReport(payload)) {
      writeRendererDiagnostic('window.error', payload);
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const payload = [event.reason];
    if (deduper.shouldReport(payload)) {
      writeRendererDiagnostic('window.unhandledrejection', payload);
    }
  });
}

installRendererDiagnostics();

// Note: StrictMode removed to prevent double-rendering issues with IPC
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
