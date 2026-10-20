import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/renderer/types';
import { COMMON_PROVIDER_SETUPS } from '../src/shared/api-provider-guidance';
import { MINIMAX_TEXT_MODELS } from '../src/shared/minimax';
import {
  FALLBACK_PROVIDER_PRESETS,
  buildApiConfigSnapshot,
  modelPresetForProfile,
} from '../src/renderer/hooks/useApiConfigState';
import { buildSyntheticPiModel } from '../src/main/agent/pi-model-resolution';
import {
  normalizeMiniMaxPayload,
  installMiniMaxPayloadHook,
} from '../src/main/agent/minimax-payload';

const setups = COMMON_PROVIDER_SETUPS.filter((setup) => setup.id.startsWith('minimax-'));

describe('MiniMax ordinary text setup', () => {
  it.each(setups)('offers Flash first for $id', (setup) => {
    expect(setup.exampleModel).toBe('MiniMax-M3.1-Flash');
    expect(
      modelPresetForProfile(
        `custom:${setup.recommendedProtocol}`,
        FALLBACK_PROVIDER_PRESETS,
        setup.recommendedBaseUrl
      ).models
    ).toEqual(MINIMAX_TEXT_MODELS);
  });

  it.each(['MiniMax-M2.7', 'MiniMax-M2.5', 'my-private-model', 'MiniMax-M3'])(
    'preserves saved %s',
    (model) => {
      const config = {
        provider: 'custom',
        customProtocol: 'anthropic',
        activeProfileKey: 'custom:anthropic',
        apiKey: '',
        baseUrl: 'https://api.minimax.io/anthropic',
        model,
        isConfigured: true,
        profiles: {
          'custom:anthropic': { apiKey: '', baseUrl: 'https://api.minimax.io/anthropic', model },
        },
      } as AppConfig;
      const profile = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS).profiles[
        'custom:anthropic'
      ];
      expect(profile.useCustomModel ? profile.customModel : profile.model).toBe(model);
    }
  );

  it('does not classify a relay or lookalike host as direct MiniMax', () => {
    for (const baseUrl of ['https://relay.example/v1', 'https://api.minimax.io.example/v1']) {
      expect(
        modelPresetForProfile('custom:openai', FALLBACK_PROVIDER_PRESETS, baseUrl).models
      ).not.toEqual(MINIMAX_TEXT_MODELS);
    }
  });

  it('sets direct Flash limits and retains explicit overrides', () => {
    expect(
      buildSyntheticPiModel(
        'MiniMax-M3.1-Flash',
        'anthropic',
        'anthropic',
        'https://api.minimax.io/anthropic'
      )
    ).toMatchObject({
      contextWindow: 1000000,
      maxTokens: 524288,
      reasoning: true,
      cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
    });
    expect(
      buildSyntheticPiModel(
        'MiniMax-M3.1-Flash',
        'anthropic',
        'anthropic',
        undefined,
        undefined,
        undefined,
        8192,
        1024
      )
    ).toMatchObject({ contextWindow: 8192, maxTokens: 1024 });
  });
});

describe('MiniMax Flash serialized payload contract', () => {
  it.each(['https://api.minimax.io', 'https://api.minimaxi.com'])(
    'normalizes direct protocols at %s',
    (base) => {
      for (const protocol of ['anthropic', 'openai']) {
        const model = buildSyntheticPiModel(
          'MiniMax-M3.1-Flash',
          protocol,
          protocol,
          `${base}/${protocol === 'openai' ? 'v1' : 'anthropic'}`
        );
        const messages = [
          { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'AA==' } }] },
        ];
        const payload = {
          messages,
          tools: [{ name: 'lookup' }],
          thinking: { type: 'disabled' },
          reasoning_effort: 'none',
          service_tier: 'priority',
          reasoning_split: false,
        };
        const result = normalizeMiniMaxPayload(payload, model) as Record<string, unknown>;
        expect(result.messages).toBe(messages);
        expect(result.tools).toBe(payload.tools);
        expect(result.service_tier).toBeUndefined();
        if (protocol === 'anthropic') {
          expect(result.thinking).toEqual({ type: 'adaptive' });
          expect(result.output_config).toEqual({ effort: 'max' });
        } else {
          expect(result.reasoning_effort).toBe('max');
          expect(result.reasoning_split).toBeUndefined();
        }
      }
    }
  );

  it('leaves M3, saved legacy models and relays untouched', () => {
    const payload = { thinking: { type: 'disabled' }, messages: [] };
    for (const id of ['MiniMax-M3', 'MiniMax-M2.7']) {
      expect(
        normalizeMiniMaxPayload(
          payload,
          buildSyntheticPiModel(id, 'anthropic', 'anthropic', 'https://api.minimax.io/anthropic')
        )
      ).toBe(payload);
    }
    expect(
      normalizeMiniMaxPayload(
        payload,
        buildSyntheticPiModel(
          'MiniMax-M3.1-Flash',
          'anthropic',
          'anthropic',
          'https://relay.example'
        )
      )
    ).toBe(payload);
  });

  it('composes the SDK hook and checks the current model on every request', async () => {
    const agent = {
      _onPayload: async (payload: unknown) => ({ ...(payload as object), extra: true }),
    };
    expect(installMiniMaxPayloadHook(agent)).toBe(true);
    const hook = agent._onPayload as (
      payload: unknown,
      model: ReturnType<typeof buildSyntheticPiModel>
    ) => Promise<Record<string, unknown>>;
    const model = buildSyntheticPiModel(
      'MiniMax-M3.1-Flash',
      'anthropic',
      'anthropic',
      'https://api.minimax.io/anthropic'
    );
    expect(await hook({}, model)).toMatchObject({ extra: true, thinking: { type: 'adaptive' } });
    expect(await hook({}, { ...model, id: 'MiniMax-M3' })).toEqual({ extra: true });
  });
});
