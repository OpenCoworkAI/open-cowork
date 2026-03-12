import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-store';
import { probeWithClaudeSdk } from '../claude/claude-sdk-one-shot';

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig,
): Promise<ApiTestResult> {
  // All providers now go through pi-ai — always use SDK probe
  return probeWithClaudeSdk(payload, config);
}
