import { getModel, type Api, type Model } from '@mariozechner/pi-ai';
import { isOfficialOpenAIBaseUrl } from '../config/auth-utils';

const COMMON_FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
const INVALID_REGISTRY_PROVIDERS = new Set(['', 'custom']);
const REASONING_MODEL_PATTERN = /\bthinking\b|\breasoner\b|deepseek-r1|kimi-k2|qwen3(?:\.5)?(?=[:/-]|$)/i;
type PiRegistryProvider = Parameters<typeof getModel>[0];

export interface PiModelStringInput {
  provider?: string;
  customProtocol?: string;
  model?: string;
  defaultModel?: string;
}

export interface PiModelLookupOptions {
  configProvider?: string;
  rawProvider?: string;
  customBaseUrl?: string;
  customProtocol?: string;
}

export interface PiModelLookupCandidate {
  provider: string;
  model: string;
}

export interface SyntheticPiModelFallbackInput {
  rawModel?: string;
  resolvedModelString: string;
  rawProvider?: string;
  routeProtocol: string;
  baseUrl?: string;
}

export interface SyntheticPiModelFallback {
  provider: string;
  modelId: string;
}

export function resolvePiRouteProtocol(
  provider?: string,
  customProtocol?: string,
): string {
  if (provider === 'custom') {
    if (customProtocol === 'openai' || customProtocol === 'gemini') {
      return customProtocol;
    }
    return 'anthropic';
  }
  if (provider === 'ollama') return 'openai';
  if (provider === 'openai') return 'openai';
  if (provider === 'openrouter') return 'openai';
  if (provider === 'gemini') return 'gemini';
  return provider || 'anthropic';
}

function shouldDisableDeveloperRoleForEndpoint(
  model: Model<Api>,
  options: PiModelLookupOptions,
): boolean {
  if (model.api !== 'openai-completions' && model.api !== 'openai-responses') {
    return false;
  }

  const endpoint = options.customBaseUrl?.trim() || model.baseUrl?.trim();
  if (!endpoint || isOfficialOpenAIBaseUrl(endpoint)) {
    return false;
  }

  return true;
}

export function inferPiApi(protocol: string): string {
  switch (protocol) {
    case 'anthropic':
      return 'anthropic-messages';
    case 'gemini':
    case 'google':
      return 'google-generative-ai';
    case 'openai':
    default:
      return 'openai-completions';
  }
}

/**
 * Known context window / max output specs for common Ollama model families.
 * Used as a middle layer between user config overrides and the hardcoded default.
 */
const KNOWN_MODEL_SPECS: Record<string, { contextWindow: number; maxTokens: number }> = {
  'qwen3.5':      { contextWindow: 258048, maxTokens: 32768 },
  'qwen3':        { contextWindow: 40960,  maxTokens: 8192 },
  'qwen2.5':      { contextWindow: 131072, maxTokens: 8192 },
  'llama3':       { contextWindow: 131072, maxTokens: 4096 },
  'llama3.1':     { contextWindow: 131072, maxTokens: 4096 },
  'llama3.2':     { contextWindow: 131072, maxTokens: 4096 },
  'llama3.3':     { contextWindow: 131072, maxTokens: 4096 },
  'deepseek-r1':  { contextWindow: 65536,  maxTokens: 8192 },
  'deepseek-v3':  { contextWindow: 65536,  maxTokens: 8192 },
  'gemma2':       { contextWindow: 8192,   maxTokens: 4096 },
  'gemma3':       { contextWindow: 131072, maxTokens: 8192 },
  'phi3':         { contextWindow: 131072, maxTokens: 4096 },
  'phi4':         { contextWindow: 16384,  maxTokens: 4096 },
  'mistral':      { contextWindow: 32768,  maxTokens: 4096 },
  'mixtral':      { contextWindow: 32768,  maxTokens: 4096 },
  'codellama':    { contextWindow: 16384,  maxTokens: 4096 },
  'command-r':    { contextWindow: 131072, maxTokens: 4096 },
};

function lookupModelSpecs(modelId: string): { contextWindow: number; maxTokens: number } | undefined {
  const lower = modelId.toLowerCase();
  // Match by prefix: "qwen3.5:0.8b" → "qwen3.5", "deepseek-r1-distill" → "deepseek-r1"
  for (const [key, specs] of Object.entries(KNOWN_MODEL_SPECS)) {
    if (lower === key || lower.startsWith(key + ':') || lower.startsWith(key + '-')) {
      return specs;
    }
  }
  return undefined;
}

export function buildSyntheticPiModel(
  modelId: string,
  provider: string,
  protocol: string,
  baseUrl?: string,
  apiOverride?: string,
  reasoning?: boolean,
  contextWindow?: number,
  maxTokens?: number,
): Model<Api> {
  const api = apiOverride || inferPiApi(protocol);
  const autoReasoning = reasoning ?? REASONING_MODEL_PATTERN.test(modelId);
  const knownSpecs = lookupModelSpecs(modelId);
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl: baseUrl || '',
    reasoning: autoReasoning,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow || knownSpecs?.contextWindow || 128000,
    maxTokens: maxTokens || knownSpecs?.maxTokens || 16384,
  } as Model<Api>;
}

export function resolveSyntheticPiModelFallback(
  input: SyntheticPiModelFallbackInput,
): SyntheticPiModelFallback {
  const rawModel = input.rawModel?.trim() || '';
  const modelString = input.resolvedModelString.trim();
  const parts = modelString.split('/');
  const parsedProvider = parts.length >= 2 ? parts[0] : '';
  const strippedModelId = parts.length >= 2 ? parts.slice(1).join('/') : modelString;
  const baseUrl = input.baseUrl?.trim() || '';
  const preservesExplicitPrefixedId =
    rawModel.includes('/')
    && (
      input.rawProvider === 'openrouter'
      || input.rawProvider === 'custom'
      || (input.rawProvider === 'openai' && !!baseUrl && !isOfficialOpenAIBaseUrl(baseUrl))
    )
    && input.routeProtocol === 'openai';

  if (input.rawProvider === 'openrouter') {
    return {
      provider: 'openrouter',
      modelId: preservesExplicitPrefixedId ? modelString : strippedModelId,
    };
  }

  const fallbackProvider = input.rawProvider === 'custom' || input.rawProvider === 'ollama'
    ? (input.routeProtocol || 'anthropic')
    : (parsedProvider || input.rawProvider || input.routeProtocol || 'anthropic');

  return {
    provider: preservesExplicitPrefixedId ? (parsedProvider || fallbackProvider) : fallbackProvider,
    modelId: preservesExplicitPrefixedId ? modelString : strippedModelId,
  };
}

export function resolvePiModelString(input: PiModelStringInput): string {
  const model = input.model?.trim();
  if (!model) {
    return input.defaultModel || 'anthropic/claude-sonnet-4';
  }
  if (model.includes('/')) {
    return model;
  }
  const provider = input.provider || 'anthropic';
  const protocol = input.customProtocol || provider;
  return `${protocol}/${model}`;
}

function addLookupCandidate(
  candidates: PiModelLookupCandidate[],
  seen: Set<string>,
  provider: string | undefined,
  model: string | undefined,
): void {
  const normalizedProvider = provider?.trim() || '';
  const normalizedModel = model?.trim() || '';
  if (!normalizedProvider || !normalizedModel || INVALID_REGISTRY_PROVIDERS.has(normalizedProvider)) {
    return;
  }

  const key = `${normalizedProvider}\u0000${normalizedModel}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push({ provider: normalizedProvider, model: normalizedModel });
}

export function buildPiModelLookupCandidates(
  modelString: string,
  options: Pick<PiModelLookupOptions, 'configProvider' | 'rawProvider'> = {},
): PiModelLookupCandidate[] {
  const keyProvider = options.configProvider === 'custom'
    ? 'anthropic'
    : (options.configProvider || 'anthropic');
  const rawProvider = options.rawProvider?.trim() || '';
  const trimmedModel = modelString.trim();
  const parts = trimmedModel.split('/');
  const seen = new Set<string>();
  const candidates: PiModelLookupCandidate[] = [];

  if (parts.length >= 2) {
    const parsedProvider = parts[0];
    const parsedModelId = parts.slice(1).join('/');

    if (rawProvider && rawProvider !== keyProvider && rawProvider !== parsedProvider) {
      addLookupCandidate(candidates, seen, rawProvider, trimmedModel);
    }
    if (keyProvider !== parsedProvider) {
      addLookupCandidate(candidates, seen, keyProvider, trimmedModel);
    }
    addLookupCandidate(candidates, seen, parsedProvider, parsedModelId);
    for (const fallbackProvider of COMMON_FALLBACK_PROVIDERS) {
      addLookupCandidate(candidates, seen, fallbackProvider, parsedModelId);
    }
    return candidates;
  }

  addLookupCandidate(candidates, seen, keyProvider, trimmedModel);
  for (const fallbackProvider of COMMON_FALLBACK_PROVIDERS) {
    addLookupCandidate(candidates, seen, fallbackProvider, trimmedModel);
  }
  return candidates;
}

export function applyPiModelRuntimeOverrides(
  model: Model<Api>,
  options: PiModelLookupOptions = {},
): Model<Api> {
  let nextModel = model;
  const isCustomProvider = options.rawProvider === 'custom' || options.configProvider === 'custom';
  const shouldHonorConfiguredBaseUrl = options.rawProvider === 'openai' || isCustomProvider;
  const modelHasBaseUrl = Boolean(nextModel.baseUrl);

  if (options.customBaseUrl && (shouldHonorConfiguredBaseUrl || !modelHasBaseUrl)) {
    nextModel = { ...nextModel, baseUrl: options.customBaseUrl } as typeof nextModel;
  }

  const effectiveProvider = options.rawProvider || options.configProvider;
  if (
    options.customBaseUrl &&
    isCustomProvider &&
    nextModel.api === 'openai-responses'
  ) {
    // Most custom OpenAI-compatible relays only implement chat/completions.
    nextModel = { ...nextModel, api: 'openai-completions' } as typeof nextModel;
  }
  if (effectiveProvider === 'openrouter' && nextModel.api !== 'openai-completions') {
    nextModel = { ...nextModel, api: 'openai-completions' } as typeof nextModel;
  }
  if (shouldDisableDeveloperRoleForEndpoint(nextModel, options)) {
    nextModel = {
      ...nextModel,
      compat: {
        ...(nextModel.compat || {}),
        supportsDeveloperRole: false,
        supportsStore: false,
      },
    } as typeof nextModel;
  }

  if (
    options.rawProvider === 'ollama'
    && nextModel.reasoning
    && nextModel.api === 'openai-completions'
  ) {
    const currentCompat = (nextModel.compat || {}) as Record<string, unknown>;
    const currentReasoningEffortMap = (
      currentCompat.reasoningEffortMap && typeof currentCompat.reasoningEffortMap === 'object'
        ? currentCompat.reasoningEffortMap
        : {}
    ) as Record<string, string>;
    nextModel = {
      ...nextModel,
      compat: {
        ...currentCompat,
        supportsReasoningEffort: true,
        reasoningEffortMap: {
          ...currentReasoningEffortMap,
          off: 'none',
        },
      },
    } as typeof nextModel;
  }

  // Handle custom provider with explicit protocol override
  if (isCustomProvider && options.customProtocol) {
    const targetApi = inferPiApi(options.customProtocol);
    if (nextModel.api !== targetApi) {
      nextModel = { ...nextModel, api: targetApi } as typeof nextModel;
    }
  }

  return nextModel;
}

export function resolvePiRegistryModel(
  modelString: string,
  options: PiModelLookupOptions = {},
): Model<Api> | undefined {
  for (const candidate of buildPiModelLookupCandidates(modelString, options)) {
    const model = (getModel as any)(candidate.provider as PiRegistryProvider, candidate.model) as Model<Api> | undefined;
    if (model) {
      return applyPiModelRuntimeOverrides(model, options);
    }
  }
  return undefined;
}
