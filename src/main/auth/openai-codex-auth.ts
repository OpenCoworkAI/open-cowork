import type { OAuthLoginCallbacks } from '@mariozechner/pi-ai';
import type { AuthStorage } from '@mariozechner/pi-coding-agent';
import { getSharedAuthStorage } from '../agent/shared-auth';

const PROVIDER_ID = 'openai-codex';
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const OPENAI_AUTH_ORIGIN = 'https://auth.openai.com';
const OPENAI_AUTH_PATH = '/oauth/authorize';
const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';

export type OpenAICodexAuthErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'invalid_authorization_url'
  | 'browser_open_failed'
  | 'login_failed'
  | 'logout_failed';

export interface OpenAICodexAuthStatus {
  authenticated: boolean;
  authenticating: boolean;
}

export interface OpenAICodexAuthActionResult {
  ok: boolean;
  status: OpenAICodexAuthStatus;
  error?: OpenAICodexAuthErrorCode;
}

type AuthStoragePort = Pick<
  AuthStorage,
  'drainErrors' | 'get' | 'hasAuth' | 'login' | 'logout' | 'reload'
>;
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
  const state = parsed.searchParams.get('state') || '';
  const codeChallenge = parsed.searchParams.get('code_challenge') || '';
  const hasSingleValue = (name: string) => parsed.searchParams.getAll(name).length === 1;
  const hasExpectedContract =
    parsed.origin === OPENAI_AUTH_ORIGIN &&
    parsed.pathname === OPENAI_AUTH_PATH &&
    parsed.username === '' &&
    parsed.password === '' &&
    hasSingleValue('response_type') &&
    hasSingleValue('client_id') &&
    hasSingleValue('redirect_uri') &&
    hasSingleValue('code_challenge') &&
    hasSingleValue('code_challenge_method') &&
    hasSingleValue('state') &&
    parsed.searchParams.get('response_type') === 'code' &&
    parsed.searchParams.get('client_id') === OPENAI_CODEX_CLIENT_ID &&
    parsed.searchParams.get('redirect_uri') === OPENAI_CODEX_REDIRECT_URI &&
    parsed.searchParams.get('code_challenge_method') === 'S256' &&
    /^[a-f0-9]{32}$/.test(state) &&
    /^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge);

  if (!hasExpectedContract) {
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
  private manualCodeInput: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(
    private readonly storage: AuthStoragePort = getSharedAuthStorage(),
    private readonly loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS
  ) {}

  private readStatus(): OpenAICodexAuthStatus {
    const credential = this.storage.get(PROVIDER_ID);
    return {
      authenticated: credential?.type === 'oauth' && this.storage.hasAuth(PROVIDER_ID),
      authenticating: this.activeLogin !== null,
    };
  }

  private verifyMutation(
    expectedAuthenticated: boolean,
    errorCode: 'login_failed' | 'logout_failed'
  ): OpenAICodexAuthStatus {
    this.storage.reload();
    const errors = this.storage.drainErrors();
    const status = { ...this.readStatus(), authenticating: false };
    if (errors.length > 0 || status.authenticated !== expectedAuthenticated) {
      throw new OpenAICodexAuthError(
        errorCode,
        expectedAuthenticated
          ? 'ChatGPT credentials could not be saved.'
          : 'ChatGPT credentials could not be removed.'
      );
    }
    return status;
  }

  private waitForManualCode(signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortReason(signal));
        return;
      }

      const pending = {
        resolve: (value: string) => {
          signal.removeEventListener('abort', onAbort);
          if (this.manualCodeInput === pending) this.manualCodeInput = null;
          resolve(value);
        },
        reject: (error: Error) => {
          signal.removeEventListener('abort', onAbort);
          if (this.manualCodeInput === pending) this.manualCodeInput = null;
          reject(error);
        },
      };
      const onAbort = () => pending.reject(abortReason(signal));
      this.manualCodeInput = pending;
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  getStatus(): OpenAICodexAuthStatus {
    this.storage.reload();
    return this.readStatus();
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
      onManualCodeInput: () => this.waitForManualCode(controller.signal),
    };

    const loginPromise = (async () => {
      // Ignore errors from earlier, unrelated storage operations. Mutation
      // verification below only evaluates errors caused by this login.
      this.storage.drainErrors();
      await this.storage.login(PROVIDER_ID, callbacks);
      return this.verifyMutation(true, 'login_failed');
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

  submitManualCode(value: string): OpenAICodexAuthStatus {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 16_384 || !this.activeLogin || !this.manualCodeInput) {
      throw new OpenAICodexAuthError(
        'login_failed',
        'No OpenAI Codex login is waiting for an authorization code.'
      );
    }
    this.manualCodeInput.resolve(normalized);
    return this.readStatus();
  }

  async logout(): Promise<OpenAICodexAuthStatus> {
    await this.cancelLogin();
    this.storage.drainErrors();
    this.storage.logout(PROVIDER_ID);
    return this.verifyMutation(false, 'logout_failed');
  }
}

export async function runOpenAICodexLoginAction(
  service: OpenAICodexAuthService,
  openExternal: OpenExternal
): Promise<OpenAICodexAuthActionResult> {
  try {
    const status = await service.login(openExternal);
    return status.authenticated
      ? { ok: true, status }
      : { ok: false, status, error: 'login_failed' };
  } catch (error) {
    return { ok: false, status: service.getStatus(), error: toOpenAICodexAuthErrorCode(error) };
  }
}

export async function runOpenAICodexLogoutAction(
  service: OpenAICodexAuthService
): Promise<OpenAICodexAuthActionResult> {
  try {
    return { ok: true, status: await service.logout() };
  } catch (error) {
    const code = toOpenAICodexAuthErrorCode(error);
    return {
      ok: false,
      status: service.getStatus(),
      error: code === 'login_failed' ? 'logout_failed' : code,
    };
  }
}

export const openAICodexAuthService = new OpenAICodexAuthService();
