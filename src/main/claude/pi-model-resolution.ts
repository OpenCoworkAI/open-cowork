import { getModel, type Model } from '@mariozechner/pi-ai';

const COMMON_FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
const INVALID_REGISTRY_PROVIDERS = new Set(['', 'custom']);
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
}

export interface PiModelLookupCandidate {
  provider: string;
  model: string;
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

export function buildSyntheticPiModel(
  modelId: string,
  provider: string,
  protocol: string,
  baseUrl?: string,
  apiOverride?: string,
): Model<unknown> {
  const api = apiOverride || inferPiApi(protocol);
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl: baseUrl || '',
    reasoning: false,
    input: ['text', 'image'] as unknown as Model<unknown>['input'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  } as Model<unknown>;
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
  model: Model<unknown>,
  options: PiModelLookupOptions = {},
): Model<unknown> {
  let nextModel = model;
  const isCustomProvider = options.rawProvider === 'custom' || options.configProvider === 'custom';
  const modelHasBaseUrl = Boolean(nextModel.baseUrl);

  if (options.customBaseUrl && (isCustomProvider || !modelHasBaseUrl)) {
    nextModel = { ...nextModel, baseUrl: options.customBaseUrl } as typeof nextModel;
  }

  const effectiveProvider = options.rawProvider || options.configProvider;
  if (effectiveProvider === 'openrouter' && nextModel.api !== 'openai-completions') {
    nextModel = { ...nextModel, api: 'openai-completions' } as typeof nextModel;
  }

  return nextModel;
}

export function resolvePiRegistryModel(
  modelString: string,
  options: PiModelLookupOptions = {},
): Model<unknown> | undefined {
  for (const candidate of buildPiModelLookupCandidates(modelString, options)) {
    const model = getModel(candidate.provider as PiRegistryProvider, candidate.model);
    if (model) {
      return applyPiModelRuntimeOverrides(model, options);
    }
  }
  return undefined;
}
