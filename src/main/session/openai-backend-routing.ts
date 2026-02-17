export type OpenAIBackendRoute = 'codex-cli' | 'responses-fallback';

export interface OpenAIBackendRouteInput {
  hasLocalCodexLogin: boolean;
  apiKey?: string;
}

export function selectOpenAIBackendRoute(input: OpenAIBackendRouteInput): OpenAIBackendRoute {
  if (input.hasLocalCodexLogin) {
    return 'codex-cli';
  }
  if (input.apiKey?.trim()) {
    return 'responses-fallback';
  }
  return 'codex-cli';
}
