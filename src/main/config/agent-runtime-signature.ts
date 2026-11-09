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
    // Camada de acesso ao desktop: o modo muda **quais tools** a sessão
    // expõe, e a chave mestre de input físico muda o **gate** de autorização.
    // Entram na assinatura para que a mudança fique visível no fluxo de
    // reload do session-manager (o runner lê a config em tempo de execução).
    desktopAccessMode: config.desktopAccessMode ?? 'off',
    desktopPhysicalInputEnabled: config.desktopPhysicalInputEnabled ?? false,
  });
}
