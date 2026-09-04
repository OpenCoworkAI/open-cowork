import type { OAuthLoginCallbacks } from '@mariozechner/pi-ai';
import type { AuthStorage } from '@mariozechner/pi-coding-agent';
import { getSharedAuthStorage } from '../agent/shared-auth';

const PROVIDER_ID = 'openai-codex';
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const OPENAI_AUTH_HOST = 'auth.openai.com';

export type OpenAICodexAuthErrorCode =
  'cancelled' | 'timeout' | 'invalid_authorization_url' | 'browser_open_failed' | 'login_failed';

export interface OpenAICodexAuthStatus {
  authenticated: boolean;
  authenticating: boolean;
}

export interface OpenAICodexAuthActionResult {
  ok: boolean;
  status: OpenAICodexAuthStatus;
  error?: OpenAICodexAuthErrorCode;
}

type AuthStoragePort = Pick<AuthStorage, 'get' | 'hasAuth' | 'login' | 'logout' | 'reload'>;
type OpenExternal = (url: string) => Promise<void>;

export class OpenAICodexAuthError extends Error {
  constructor(
    readonly code: OpenAICodexAuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OpenAICodexAuthError';
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new OpenAICodexAuthError('cancelled', 'OpenAI Codex login was cancelled.');
}

function waitForAbort(signal: AbortSignal): Promise<string> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
  });
}

function assertAuthorizationUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new OpenAICodexAuthError(
      'invalid_authorization_url',
      'OpenAI returned an invalid authorization URL.'
    );
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== OPENAI_AUTH_HOST) {
    throw new OpenAICodexAuthError(
      'invalid_authorization_url',
      'OpenAI returned an unexpected authorization URL.'
    );
  }
}

export function toOpenAICodexAuthErrorCode(error: unknown): OpenAICodexAuthErrorCode {
  return error instanceof OpenAICodexAuthError ? error.code : 'login_failed';
}

export class OpenAICodexAuthService {
  private activeLogin: Promise<OpenAICodexAuthStatus> | null = null;
  private activeController: AbortController | null = null;

  constructor(
    private readonly storage: AuthStoragePort = getSharedAuthStorage(),
    private readonly loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS
  ) {}

  getStatus(): OpenAICodexAuthStatus {
    this.storage.reload();
    const credential = this.storage.get(PROVIDER_ID);
    return {
      authenticated: credential?.type === 'oauth' && this.storage.hasAuth(PROVIDER_ID),
      authenticating: this.activeLogin !== null,
    };
  }

  hasAuth(): boolean {
    return this.getStatus().authenticated;
  }

  async login(openExternal: OpenExternal): Promise<OpenAICodexAuthStatus> {
    if (this.activeLogin) {
      return this.activeLogin;
    }

    const controller = new AbortController();
    this.activeController = controller;
    const timeout = setTimeout(() => {
      controller.abort(
        new OpenAICodexAuthError('timeout', 'OpenAI Codex login timed out after five minutes.')
      );
    }, this.loginTimeoutMs);

    const callbacks: OAuthLoginCallbacks = {
      signal: controller.signal,
      onAuth: ({ url }) => {
        try {
          assertAuthorizationUrl(url);
        } catch (error) {
          controller.abort(error);
          return;
        }
        void openExternal(url).catch(() => {
          controller.abort(
            new OpenAICodexAuthError(
              'browser_open_failed',
              'Could not open the OpenAI authorization page.'
            )
          );
        });
      },
      onPrompt: async () => {
        throw new OpenAICodexAuthError(
          'login_failed',
          'The browser callback did not complete the OpenAI Codex login.'
        );
      },
      // pi races this promise against the localhost callback. Rejecting it on
      // abort makes pi cancel its callback wait and close the HTTP server.
      onManualCodeInput: () => waitForAbort(controller.signal),
    };

    const loginPromise = (async () => {
      await this.storage.login(PROVIDER_ID, callbacks);
      return { ...this.getStatus(), authenticating: false };
    })();
    this.activeLogin = loginPromise;

    try {
      return await loginPromise;
    } finally {
      clearTimeout(timeout);
      controller.abort();
      this.activeController = null;
      this.activeLogin = null;
    }
  }

  async cancelLogin(): Promise<OpenAICodexAuthStatus> {
    this.activeController?.abort(
      new OpenAICodexAuthError('cancelled', 'OpenAI Codex login was cancelled.')
    );
    try {
      await this.activeLogin;
    } catch {
      // Cancellation is the expected result.
    }
    return { ...this.getStatus(), authenticating: false };
  }

  async logout(): Promise<OpenAICodexAuthStatus> {
    await this.cancelLogin();
    this.storage.logout(PROVIDER_ID);
    return this.getStatus();
  }
}

export const openAICodexAuthService = new OpenAICodexAuthService();
