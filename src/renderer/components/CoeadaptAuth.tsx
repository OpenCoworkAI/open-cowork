/**
 * CoeadaptAuth – Conditional Clerk auth wrapper
 *
 * When a valid Clerk publishable key is configured, this wraps the app in
 * ClerkProvider and initializes the Coeadapt API client with the Clerk JWT.
 *
 * In standalone mode (no key), it renders children directly with no auth.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, useAuth, SignIn } from '@clerk/clerk-react';
import { initCoeadaptApi } from '../lib/coeadapt-api';
import { useAppStore } from '../store';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// ─── Standalone mode detection ──────────────────────────────────────────────

function isStandaloneKey(key: string | undefined | null): boolean {
  if (!key) return true;
  if (key === 'pk_test_REPLACE_ME') return true;
  if (key.length < 10) return true;
  return false;
}

// ─── Inner components that initialize the API client ─────────────────────────

function StandaloneApiInitializer({ children }: { children: ReactNode }) {
  const { setCoeadaptConnected } = useAppStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        let apiUrl = 'http://localhost:3000'; // Default standalone backend
        if (isElectron) {
          const config = await window.electronAPI.coeadapt.getConfig();
          apiUrl = config.coeadaptApiUrl || apiUrl;
        }

        initCoeadaptApi(
          async () => {
            // Standalone mode: try for device token first
            if (isElectron) {
               return window.electronAPI.coeadapt.deviceToken.getRaw();
            }
            return null; // Not authenticated
          },
          apiUrl,
        );

        setCoeadaptConnected(true);
      } catch (err) {
        console.error('[CoeadaptAuth] Failed to initialize standalone API:', err);
      }
    })();
  }, [setCoeadaptConnected]);

  return <>{children}</>;
}


function ClerkApiInitializer({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth();
  const { setCoeadaptConnected } = useAppStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (!isSignedIn || initialized.current) return;
    initialized.current = true;

    // Initialize the API client with the Clerk token provider
    (async () => {
      try {
        let apiUrl = 'https://api.coeadapt.com';
        if (isElectron) {
          const config = await window.electronAPI.coeadapt.getConfig();
          apiUrl = config.coeadaptApiUrl || apiUrl;
        }

        initCoeadaptApi(
          async () => {
            try {
              return await getToken();
            } catch {
              // Fallback to device token
              if (isElectron) {
                return window.electronAPI.coeadapt.deviceToken.getRaw();
              }
              return null;
            }
          },
          apiUrl,
        );

        setCoeadaptConnected(true);

        // Generate device token for background use
        if (isElectron) {
          const jwt = await getToken();
          if (jwt) {
            await window.electronAPI.coeadapt.deviceToken.generate(jwt);
          }
        }
      } catch (err) {
        console.error('[CoeadaptAuth] Failed to initialize API client:', err);
      }
    })();
  }, [isSignedIn, getToken, setCoeadaptConnected]);

  // Reset on sign out
  useEffect(() => {
    if (!isSignedIn) {
      initialized.current = false;
      setCoeadaptConnected(false);
    }
  }, [isSignedIn, setCoeadaptConnected]);

  if (!isSignedIn) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <SignIn routing="hash" />
      </div>
    );
  }

  return <>{children}</>;
}

// ─── Main wrapper ───────────────────────────────────────────────────────────

interface CoeadaptAuthProps {
  clerkPublishableKey?: string;
  children: ReactNode;
}

export function CoeadaptAuth({ clerkPublishableKey, children }: CoeadaptAuthProps) {
  if (isStandaloneKey(clerkPublishableKey)) {
    // Standalone mode – no auth required but we must initialize API
    return <StandaloneApiInitializer>{children}</StandaloneApiInitializer>;
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey!}>
      <ClerkApiInitializer>{children}</ClerkApiInitializer>
    </ClerkProvider>
  );
}
