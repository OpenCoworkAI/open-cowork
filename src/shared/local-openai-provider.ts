export type LocalOpenAIProvider = 'vllm' | 'lmstudio';

export function isLocalOpenAIProvider(provider: unknown): provider is LocalOpenAIProvider {
  return provider === 'vllm' || provider === 'lmstudio';
}

export const LOCAL_OPENAI_BASE_URLS: Record<LocalOpenAIProvider, string> = {
  vllm: 'http://localhost:8000/v1',
  lmstudio: 'http://localhost:1234/v1',
};
