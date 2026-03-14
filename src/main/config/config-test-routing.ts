import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-store';
import { probeWithClaudeSdk } from '../claude/claude-sdk-one-shot';
import { testApiConnection } from './api-tester';
import { testOllamaConnection } from './ollama-api';

function supportsDirectLiveRequest(payload: ApiTestInput): boolean {
  return payload.provider !== 'gemini'
    && !(payload.provider === 'custom' && payload.customProtocol === 'gemini');
}

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig,
): Promise<ApiTestResult> {
  if (payload.provider === 'ollama') {
    return testOllamaConnection(payload);
  }
  if (payload.useLiveRequest && supportsDirectLiveRequest(payload)) {
    return testApiConnection(payload);
  }
  return probeWithClaudeSdk(payload, config);
}
