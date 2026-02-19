import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CoeadaptAuth } from './components/CoeadaptAuth';
import './styles/globals.css';
import 'katex/dist/katex.min.css';
import './i18n/config'; // Initialize i18n

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

/**
 * Root component that loads Coeadapt config before rendering.
 * If a Clerk key is configured, wraps the app in CoeadaptAuth.
 */
function Root() {
  const [clerkKey, setClerkKey] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (isElectron) {
        try {
          const config = await window.electronAPI.coeadapt.getConfig();
          setClerkKey(config.clerkPublishableKey || undefined);
        } catch {
          // Standalone mode
        }
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return null;

  return (
    <CoeadaptAuth clerkPublishableKey={clerkKey}>
      <App />
    </CoeadaptAuth>
  );
}

// Note: StrictMode removed to prevent double-rendering issues with IPC
ReactDOM.createRoot(document.getElementById('root')!).render(
  <Root />
);
