import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-store';
import { probeWithClaudeSdk } from '../claude/claude-sdk-one-shot';

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig,
): Promise<ApiTestResult> {
  return probeWithClaudeSdk(payload, config);
}
