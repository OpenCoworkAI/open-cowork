import OpenAI from 'openai';
import type { AppConfig, CustomProtocolType, ProviderType } from '../config/config-store';
import { configStore } from '../config/config-store';
import {
  normalizeOpenAICompatibleBaseUrl,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
} from '../config/auth-utils';
import { runPiAiOneShot } from '../claude/claude-sdk-one-shot';
import { logWarn } from '../utils/logger';

export interface MemoryCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface MemoryCompletionResponse {
  text: string;
}

export interface MemoryLLMClientLike {
  complete(request: MemoryCompletionRequest): Promise<MemoryCompletionResponse>;
  embed(text: string): Promise<number[]>;
}

interface MemoryModelConfig {
  inheritFromActive?: boolean;
  provider?: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

interface ResolvedMemoryModelConfig {
  provider: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
}

function normalizeModelConfig(
  appConfig: AppConfig,
  input: MemoryModelConfig | undefined,
  fallbackModel: string
): ResolvedMemoryModelConfig {
  const inherit = input?.inheritFromActive !== false;
  const activeProvider = appConfig.provider;
  const activeProtocol = appConfig.customProtocol;
  const activeBaseUrl = appConfig.baseUrl;
  const activeApiKey = appConfig.apiKey;
  const activeModel = appConfig.model;

  const provider = inherit ? activeProvider : input?.provider || activeProvider;
  const customProtocol = inherit ? activeProtocol : input?.customProtocol || activeProtocol;
  const apiKey = inherit ? activeApiKey : input?.apiKey || '';
  const baseUrl = inherit ? activeBaseUrl : input?.baseUrl || activeBaseUrl;
  const model = (input?.model || (inherit ? activeModel : '') || fallbackModel).trim();
  const timeoutMs = Math.max(5_000, input?.timeoutMs || 180_000);

  return {
    provider,
    customProtocol,
    apiKey,
    baseUrl,
    model,
    timeoutMs,
  };
}

function buildAppConfig(base: AppConfig, resolved: ResolvedMemoryModelConfig): AppConfig {
  return {
    ...base,
    provider: resolved.provider,
    customProtocol: resolved.customProtocol,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
  };
}

export class MemoryLLMClient implements MemoryLLMClientLike {
  constructor(private readonly getConfig: () => AppConfig = () => configStore.getAll()) {}

  async complete(request: MemoryCompletionRequest): Promise<MemoryCompletionResponse> {
    const appConfig = this.getConfig();
    const llmConfig = normalizeModelConfig(appConfig, appConfig.memoryRuntime?.llm, appConfig.model);
    const result = await runPiAiOneShot(
      request.userPrompt,
      request.systemPrompt,
      buildAppConfig(appConfig, llmConfig),
      {
        temperature: request.temperature ?? 0,
        maxTokens: request.maxTokens ?? 16_000,
      }
    );
    return { text: result.text };
  }

  async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }

    const appConfig = this.getConfig();
    if (!appConfig.memoryRuntime?.useEmbedding) {
      return [];
    }
    const embedConfig = normalizeModelConfig(
      appConfig,
      appConfig.memoryRuntime.embedding,
      'text-embedding-3-small'
    );

    const provider = embedConfig.provider;
    const protocol = embedConfig.customProtocol;
    const isOpenAiCompatible =
      provider === 'openai' ||
      provider === 'openrouter' ||
      provider === 'ollama' ||
      (provider === 'custom' && protocol === 'openai');

    if (!isOpenAiCompatible) {
      logWarn(
        '[MemoryLLMClient] Embedding requested for unsupported provider; returning empty embedding:',
        provider
      );
      return [];
    }

    const resolved =
      provider === 'ollama'
        ? resolveOllamaCredentials({
            provider,
            customProtocol: protocol,
            apiKey: embedConfig.apiKey,
            baseUrl: embedConfig.baseUrl,
          })
        : resolveOpenAICredentials({
            provider,
            customProtocol: protocol,
            apiKey: embedConfig.apiKey,
            baseUrl: embedConfig.baseUrl,
          });

    const client = new OpenAI({
      apiKey: resolved?.apiKey || embedConfig.apiKey,
      baseURL: resolved?.baseUrl || normalizeOpenAICompatibleBaseUrl(embedConfig.baseUrl),
      timeout: embedConfig.timeoutMs,
    });
    const response = await client.embeddings.create({
      model: embedConfig.model,
      input: trimmed,
    });
    return response.data[0]?.embedding || [];
  }
}
