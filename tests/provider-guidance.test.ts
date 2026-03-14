import { describe, expect, it } from 'vitest';
import {
  COMMON_PROVIDER_SETUPS,
  detectCommonProviderSetup,
  getFallbackOpenAISetup,
  isParsableBaseUrl,
  orderCommonProviderSetups,
  resolveProviderGuidanceErrorHint,
} from '../src/shared/api-provider-guidance';

describe('provider guidance helpers', () => {
  it('detects Kimi Coding and recommends Anthropic-compatible setup', () => {
    const setup = detectCommonProviderSetup('https://api.kimi.com/coding');
    expect(setup?.id).toBe('kimi-coding');
    expect(setup?.recommendedProtocol).toBe('anthropic');
  });

  it('detects DeepSeek and recommends OpenAI-compatible setup', () => {
    const setup = detectCommonProviderSetup('https://api.deepseek.com/v1');
    expect(setup?.id).toBe('deepseek');
    expect(setup?.recommendedProtocol).toBe('openai');
  });

  it('detects OpenRouter and prefers the dedicated provider tab', () => {
    const setup = detectCommonProviderSetup('https://openrouter.ai/api/v1');
    expect(setup?.id).toBe('openrouter');
    expect(setup?.preferProviderTab).toBe('openrouter');
    expect(detectCommonProviderSetup('https://openrouter.ai')?.id).toBe('openrouter');
  });

  it('detects Ollama only on the local default port and prefers the dedicated provider tab', () => {
    const setup = detectCommonProviderSetup('http://localhost:11434/v1');
    expect(setup?.id).toBe('ollama');
    expect(setup?.preferProviderTab).toBe('ollama');
    expect(detectCommonProviderSetup('http://localhost:3000/v1')).toBeNull();
  });

  it('keeps unknown hosts unmatched and exposes the generic OpenAI fallback separately', () => {
    expect(detectCommonProviderSetup('https://relay.example.internal/v1')).toBeNull();
    expect(getFallbackOpenAISetup().id).toBe('generic-openai');
    expect(isParsableBaseUrl('https://relay.example.internal/v1')).toBe(true);
    expect(isParsableBaseUrl('relay-example')).toBe(false);
  });

  it('moves the detected setup to the top of the common setup list', () => {
    const ordered = orderCommonProviderSetups('kimi-coding');
    expect(ordered[0]?.id).toBe('kimi-coding');
    expect(ordered).toHaveLength(COMMON_PROVIDER_SETUPS.length);
  });

  it('maps probe failures to friendly hint kinds', () => {
    const kimi = detectCommonProviderSetup('https://api.kimi.com/coding');
    expect(resolveProviderGuidanceErrorHint('empty_probe_response', kimi)).toBe(
      'emptyProbeDetected'
    );
    expect(resolveProviderGuidanceErrorHint('probe_response_mismatch:pong', kimi)).toBe(
      'probeMismatchDetected'
    );
    expect(resolveProviderGuidanceErrorHint('empty_probe_response', null)).toBe(
      'emptyProbeGeneric'
    );
  });
});
