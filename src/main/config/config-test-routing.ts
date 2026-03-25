import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-store';
import { probeWithClaudeSdk } from '../claude/claude-sdk-one-shot';
import { getCodexAuthStatus } from '../codex/codex-cli';

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig
): Promise<ApiTestResult> {
  if (payload.provider === 'codex_chatgpt') {
    const startedAt = Date.now();
    const status = await getCodexAuthStatus(payload.codexPath || config.codexPath);
    return {
      ok: status.ok && status.loggedIn,
      latencyMs: Date.now() - startedAt,
      errorType: status.ok && status.loggedIn ? undefined : 'unknown',
      details: status.message,
    };
  }

  return probeWithClaudeSdk(payload, config);
}
