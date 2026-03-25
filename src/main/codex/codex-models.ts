import type { ProviderModelInfo } from '../../renderer/types';

const CODEX_MODELS_DOCS_URL = 'https://developers.openai.com/codex/models';
const CODEX_MODELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const FALLBACK_CODEX_MODELS: ProviderModelInfo[] = [
  { id: 'gpt-5.4', name: 'gpt-5.4' },
  { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' },
  { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' },
  { id: 'gpt-5.3-codex-spark', name: 'gpt-5.3-codex-spark' },
  { id: 'gpt-5.2-codex', name: 'gpt-5.2-codex' },
  { id: 'gpt-5.2', name: 'gpt-5.2' },
  { id: 'gpt-5.1-codex-max', name: 'gpt-5.1-codex-max' },
  { id: 'gpt-5.1', name: 'gpt-5.1' },
  { id: 'gpt-5.1-codex', name: 'gpt-5.1-codex' },
  { id: 'gpt-5-codex', name: 'gpt-5-codex' },
  { id: 'gpt-5-codex-mini', name: 'gpt-5-codex-mini' },
  { id: 'gpt-5', name: 'gpt-5' },
];

const FALLBACK_CODEX_MODEL_IDS = FALLBACK_CODEX_MODELS.map((item) => item.id);

let cachedCodexModels: ProviderModelInfo[] | null = null;
let cachedCodexModelsAt = 0;

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });
  return controller.signal;
}

export function getFallbackCodexModels(): ProviderModelInfo[] {
  return FALLBACK_CODEX_MODELS.map((item) => ({ ...item }));
}

export function extractCodexModelIds(source: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const commandPattern = /codex\s+-m\s+(gpt-[a-z0-9.-]+)/gi;
  const textPattern = /\b(gpt-(?:[a-z0-9]+(?:\.[a-z0-9]+)?(?:-[a-z0-9]+)*))\b/gi;

  const addId = (candidate: string) => {
    const normalized = candidate.trim().toLowerCase();
    if (!normalized.startsWith('gpt-') || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    ids.push(normalized);
  };

  for (const match of source.matchAll(commandPattern)) {
    addId(match[1] || '');
  }

  if (ids.length < 4) {
    for (const match of source.matchAll(textPattern)) {
      addId(match[1] || '');
    }
  }

  return ids;
}

function sortCodexModelIds(modelIds: string[]): string[] {
  const fallbackOrder = new Map(FALLBACK_CODEX_MODEL_IDS.map((id, index) => [id, index]));
  return [...modelIds].sort((left, right) => {
    const leftIndex = fallbackOrder.get(left);
    const rightIndex = fallbackOrder.get(right);

    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== undefined) {
      return -1;
    }
    if (rightIndex !== undefined) {
      return 1;
    }
    return left.localeCompare(right);
  });
}

async function fetchOfficialCodexModels(timeoutMs: number): Promise<ProviderModelInfo[]> {
  const response = await fetch(CODEX_MODELS_DOCS_URL, {
    headers: { Accept: 'text/html, text/plain;q=0.9, */*;q=0.8' },
    signal: createTimeoutSignal(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Codex models docs request failed with status ${response.status}`);
  }

  const body = await response.text();
  const extractedIds = sortCodexModelIds(extractCodexModelIds(body));
  if (extractedIds.length < 4) {
    throw new Error('Could not extract enough Codex model IDs from official docs');
  }

  return extractedIds.map((id) => ({ id, name: id }));
}

export async function listOfficialCodexModels(options?: {
  forceRefresh?: boolean;
  timeoutMs?: number;
}): Promise<ProviderModelInfo[]> {
  const forceRefresh = Boolean(options?.forceRefresh);
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const now = Date.now();

  if (!forceRefresh && cachedCodexModels && now - cachedCodexModelsAt < CODEX_MODELS_CACHE_TTL_MS) {
    return cachedCodexModels.map((item) => ({ ...item }));
  }

  try {
    const models = await fetchOfficialCodexModels(timeoutMs);
    cachedCodexModels = models;
    cachedCodexModelsAt = now;
    return models.map((item) => ({ ...item }));
  } catch {
    const fallback = getFallbackCodexModels();
    if (!cachedCodexModels) {
      cachedCodexModels = fallback;
      cachedCodexModelsAt = now;
    }
    return (cachedCodexModels || fallback).map((item) => ({ ...item }));
  }
}
