import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/renderer/types';
import {
  FALLBACK_PROVIDER_PRESETS,
  buildApiConfigSnapshot,
  getModelInputGuidance,
  isCustomAnthropicLoopbackGateway,
  isCustomGeminiLoopbackGateway,
  profileKeyFromProvider,
  profileKeyToProvider,
} from '../src/renderer/hooks/useApiConfigState';

describe('api config state helpers', () => {
  it('maps provider/protocol to profile key and back', () => {
    expect(profileKeyFromProvider('openrouter')).toBe('openrouter');
    expect(profileKeyFromProvider('custom', 'openai')).toBe('custom:openai');
    expect(profileKeyFromProvider('custom', 'gemini')).toBe('custom:gemini');
    expect(profileKeyToProvider('custom:anthropic')).toEqual({
      provider: 'custom',
      customProtocol: 'anthropic',
    });
    expect(profileKeyToProvider('gemini')).toEqual({
      provider: 'gemini',
      customProtocol: 'gemini',
    });
  });

  it('loads existing profile values without overwriting them with defaults', () => {
    const config = {
      provider: 'custom',
      customProtocol: 'openai',
      activeProfileKey: 'custom:openai',
      apiKey: 'sk-active',
      baseUrl: 'https://custom-openai.example/v1',
      model: 'gpt-5.3-codex',
      profiles: {
        'custom:openai': {
          apiKey: 'sk-custom-openai',
          baseUrl: 'https://custom-openai.example/v1',
          model: 'gpt-5.3-codex',
        },
        'custom:anthropic': {
          apiKey: 'sk-custom-anthropic',
          baseUrl: 'https://custom-anthropic.example',
          model: 'glm-4.7',
        },
      },
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.activeProfileKey).toBe('custom:openai');
    expect(snapshot.profiles['custom:openai'].apiKey).toBe('sk-custom-openai');
    expect(snapshot.profiles['custom:openai'].baseUrl).toBe('https://custom-openai.example/v1');
    expect(snapshot.profiles['custom:anthropic'].apiKey).toBe('sk-custom-anthropic');
  });

  it('applies defaults only for missing profiles', () => {
    const config = {
      provider: 'openai',
      customProtocol: 'anthropic',
      activeProfileKey: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      profiles: {
        openai: {
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
        },
      },
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.profiles.openai.apiKey).toBe('sk-openai');
    expect(snapshot.profiles.openrouter.baseUrl).toBe(FALLBACK_PROVIDER_PRESETS.openrouter.baseUrl);
    expect(snapshot.profiles['custom:anthropic'].model).toBe(FALLBACK_PROVIDER_PRESETS.custom.models[0]?.id);
    expect(snapshot.profiles['custom:anthropic'].useCustomModel).toBe(true);
    expect(snapshot.profiles['custom:anthropic'].customModel).toBe('');
  });

  it('detects local custom anthropic loopback gateway url', () => {
    expect(isCustomAnthropicLoopbackGateway('http://127.0.0.1:8082')).toBe(true);
    expect(isCustomAnthropicLoopbackGateway('http://localhost:8082')).toBe(true);
    expect(isCustomAnthropicLoopbackGateway('http://[::1]:8082')).toBe(true);
    expect(isCustomAnthropicLoopbackGateway('http://0.0.0.0:8082')).toBe(true);
    expect(isCustomAnthropicLoopbackGateway('https://proxy.example.com')).toBe(false);
  });

  it('detects local custom gemini loopback gateway url', () => {
    expect(isCustomGeminiLoopbackGateway('http://127.0.0.1:8082')).toBe(true);
    expect(isCustomGeminiLoopbackGateway('http://localhost:8082')).toBe(true);
    expect(isCustomGeminiLoopbackGateway('http://[::1]:8082')).toBe(true);
    expect(isCustomGeminiLoopbackGateway('http://0.0.0.0:8082')).toBe(true);
    expect(isCustomGeminiLoopbackGateway('https://proxy.example.com')).toBe(false);
  });

  it('loads gemini provider and custom gemini profile values without fallback drift', () => {
    const config = {
      provider: 'custom',
      customProtocol: 'gemini',
      activeProfileKey: 'custom:gemini',
      apiKey: 'AIza-relay',
      baseUrl: 'https://gemini-proxy.example/v1',
      model: 'gemini/gemini-2.5-pro',
      profiles: {
        gemini: {
          apiKey: 'AIza-official',
          baseUrl: 'https://generativelanguage.googleapis.com',
          model: 'gemini/gemini-2.5-flash',
        },
        'custom:gemini': {
          apiKey: 'AIza-relay',
          baseUrl: 'https://gemini-proxy.example/v1',
          model: 'gemini/gemini-2.5-pro',
        },
      },
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.activeProfileKey).toBe('custom:gemini');
    expect(snapshot.profiles.gemini.apiKey).toBe('AIza-official');
    expect(snapshot.profiles['custom:gemini'].baseUrl).toBe('https://gemini-proxy.example/v1');
  });

  it('keeps pristine custom openai profile in manual input mode', () => {
    const config = {
      provider: 'custom',
      customProtocol: 'openai',
      activeProfileKey: 'custom:openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      profiles: {
        'custom:openai': {
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
        },
      },
      isConfigured: false,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.profiles['custom:openai'].useCustomModel).toBe(true);
    expect(snapshot.profiles['custom:openai'].customModel).toBe('');
    expect(snapshot.profiles['custom:openai'].model).toBe('gpt-5.4');
  });

  it('exposes updated preset lists and custom guidance', () => {
    expect(FALLBACK_PROVIDER_PRESETS.openai.models.map((item) => item.id)).toContain('gpt-5.4');
    expect(FALLBACK_PROVIDER_PRESETS.openai.models.map((item) => item.id)).toContain('gpt-5.3-codex');
    expect(FALLBACK_PROVIDER_PRESETS.openai.models.map((item) => item.id)).not.toContain('gpt-5.2');
    expect(FALLBACK_PROVIDER_PRESETS.anthropic.models.map((item) => item.id)).toContain('claude-sonnet-4-6');
    expect(FALLBACK_PROVIDER_PRESETS.gemini.models.map((item) => item.id)).toContain('gemini-3.1-pro-preview');
    expect(FALLBACK_PROVIDER_PRESETS.custom.models.map((item) => item.id)).toContain('kimi-thinking-preview');
    expect(FALLBACK_PROVIDER_PRESETS.custom.models.map((item) => item.id)).toContain('glm-5');
    expect(FALLBACK_PROVIDER_PRESETS.custom.models.map((item) => item.id)).toContain('MiniMax-M2.5');
    expect(FALLBACK_PROVIDER_PRESETS.custom.models.map((item) => item.id)).toContain('grok-code-fast-1');
    expect(FALLBACK_PROVIDER_PRESETS.custom.models.map((item) => item.id)).toContain('mistral-large-latest');

    expect(getModelInputGuidance('custom', 'openai').placeholder).toContain('deepseek-chat');
    expect(getModelInputGuidance('custom', 'openai').placeholder).toContain('kimi-thinking-preview');
    expect(getModelInputGuidance('custom', 'openai').hint).toContain('exact model ID');
  });
});
