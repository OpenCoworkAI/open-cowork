import type { AppConfig } from './config-store';

/**
 * Hash of the config fields that require reloading the in-process agent runner.
 * Changing only contextWindow or maxTokens must change this signature so an
 * already-running session manager picks up numeric-only overrides.
 */
export function buildAgentRuntimeSignature(config: AppConfig): string {
  return JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    enableThinking: config.enableThinking,
    memoryEnabled: config.memoryEnabled,
    memoryRuntime: config.memoryRuntime,
  });
}
