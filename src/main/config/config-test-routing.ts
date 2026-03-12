import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-store';
import { probeWithClaudeSdk } from '../claude/claude-sdk-one-shot';
import { testOllamaConnection } from './ollama-api';

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig,
): Promise<ApiTestResult> {
  if (payload.provider === 'ollama') {
    return testOllamaConnection(payload);
  }
  return probeWithClaudeSdk(payload, config);
}
